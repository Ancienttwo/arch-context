#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { architectureDebtReportIssues, digestJson, type Json } from "@archcontext/contracts";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import { inspectRepositoryCodeFacts, openCodeGraphSymbolReader } from "@archcontext/local-runtime/codegraph-adapter";
import { readArchitectureDebt, readCompleteTaskArchitectureDebt } from "../packages/local-runtime/runtime-daemon/src/architecture-debt";
import { benchmarkByteWitness, FIXTURE_VOLATILE_CONTENT } from "./architecture-debt-benchmark-inputs";

const engineRoot = resolve(flag("--engine-root") || resolve(import.meta.dir, ".."));
const phase = flag("--phase");
const output = flag("--output");
const fixtureLock = JSON.parse(readFileSync(flag("--fixture-lock"), "utf8"));
if (!["before", "after"].includes(phase) || !output) throw new Error("requires --phase before|after --output <new file>");
if (existsSync(output)) throw new Error("refusing to overwrite an existing sample record");
const protocol = {
  version: 1, editTimeSamplesPerSubjectPerPhase: 5, fullDebtSamplesPerSubjectPerPhase: 3,
  thresholdNs: "3000000000", acceptance: "every final representative edit-time sample is strictly below threshold",
  processCold: "independent direct-spawn Bun process; no warmup/discard or selective retries",
  osFileCache: "not flushed; fixture/index preparation, metadata hashing and preflight reads can warm OS file cache",
  timing: "direct spawn through process exit and stdout/stderr drain; Bun startup, CLI module loading/transpilation, native loading, Git/CodeGraph child work and JSON output are included",
  excluded: "manager startup, fixture/index preparation, byte snapshots, preflight evidence capture and manager JSON parsing",
  noWrite: "fresh recursive enumeration of complete fixture (including Git metadata, ignored/untracked paths and empty directories) and complete runtime state; bytes/modes/link targets compared. Only CodeGraph SQLite SHM content lock/read marks are excluded; its path/type/mode still compared. Timestamps are not logical-content evidence. Test output is outside both roots.",
  volatileContentPaths: FIXTURE_VOLATILE_CONTENT,
  discoveryLimit: "call-local reuse is not an atomic snapshot and does not fix edits during the invocation"
};
const subjects = [
  { name: "representative", root: "/private/tmp/archcontext-d5-bench-repo-harness", repoSha: "90cd97fb84fb92e242c70f8f7f1a6eb4411d9a49",
    paths: ["acceptance-receipt.ts", "capability-config.ts", "capability-resolver.ts", "change-assessment.ts", "check-skill-version.ts"].map(p => "assets/templates/helpers/" + p) },
  { name: "control", root: "/private/tmp/archcontext-d5-bench-arch-context", repoSha: "a697adad7bf686f309405d7a9feef8173d8140a5",
    paths: ["packages/contracts/src/architecture-debt.ts", "packages/core/review-engine/src/architecture-debt.ts", "packages/local-runtime/runtime-daemon/src/architecture-debt.ts", "packages/local-runtime/runtime-daemon/src/practice-checkpoint.ts", "packages/surfaces/cli/src/main.ts"] }
];
const env = { ...process.env, DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1", CODEGRAPH_INSTALL_DIR: "/tmp/archcontext-d5-codegraph-user",
  ARCHCONTEXT_EGRESS_MODE: "local-only", PATH: join(engineRoot, "node_modules/.bin") + ":" + (process.env.PATH ?? "") };
Object.assign(process.env, env);
const engineSha = git(engineRoot, "rev-parse", "HEAD");
const sourceFiles = git(engineRoot, "ls-files", "-z", "--", "packages").split("\0").filter(p => p.includes("/src/") || /\/package.json$/.test(p));
for (const path of sourceFiles) {
  if (git(engineRoot, "hash-object", path) !== git(engineRoot, "rev-parse", "HEAD:" + path)) throw new Error("uncommitted product source: " + path);
}
const record: any = { protocol, phase, startedAt: new Date().toISOString(), fixtureLock,
  benchmarkHarness: { sha256: hashFile(import.meta.filename), byteWitnessSha256: hashFile(join(import.meta.dir, "architecture-debt-benchmark-inputs.ts")) }, engine: { sha: engineSha,
  lockSha256: hashFile(join(engineRoot, "bun.lock")),
  productFingerprint: digestJson(sourceFiles.map(path => ({ path, hash: hashFile(join(engineRoot, path)) })) as unknown as Json),
  entry: join(engineRoot, "packages/surfaces/cli/src/main.ts") },
  environment: { bun: Bun.version, node: execFileSync("node", ["--version"], { encoding: "utf8" }).trim(),
    platform: process.platform, arch: process.arch,
    os: execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim(),
    osBuild: execFileSync("sw_vers", ["-buildVersion"], { encoding: "utf8" }).trim(), codeGraph: "1.6.1" },
  subjects: [], samples: [] };
save();
for (const subject of subjects) {
  if (git(subject.root, "rev-parse", "HEAD") !== subject.repoSha) throw new Error("subject SHA changed");
  for (const path of subject.paths) if (!existsSync(join(subject.root, path))) throw new Error("frozen changed path missing: " + path);
  const state = "/tmp/archcontext-d5-bench-state-" + subject.name;
  mkdirSync(state, { recursive: true }); if (!existsSync(join(state, "sentinel"))) writeFileSync(join(state, "sentinel"), "D5 preserve\n");
  const holder = new Database(join(subject.root, ".codegraph/codegraph.db"));
  holder.query("SELECT count(*) FROM sqlite_master").get();
  try {
    const available = openCodeGraphSymbolReader(subject.root);
    if (available.availability !== "ready") throw new Error("representative symbol coverage unavailable: " + available.reasonCode);
    available.reader.close();
    const codeFacts = inspectRepositoryCodeFacts(subject.root);
    if (codeFacts.state !== "ready") throw new Error("complete index not ready: " + JSON.stringify(codeFacts));
    const visible = listGitVisibleFiles(subject.root);
    const baseBytes = benchmarkByteWitness(subject.root, state);
    const inputFingerprint = digestJson(visible.map(path => ({ path, hash: hashFile(join(subject.root, path)) })) as unknown as Json);
    const locked = fixtureLock.subjects.find((entry: { name: string }) => entry.name === subject.name);
    if (!locked || locked.inputFingerprint !== inputFingerprint) throw new Error("frozen fixture input fingerprint mismatch");
    const model = loadNativeModelFromArchContext(subject.root);
    const expectedEdit = readArchitectureDebt(subject.root, { changedPaths: subject.paths });
    const expectedFull = readCompleteTaskArchitectureDebt(subject.root);
    if (benchmarkByteWitness(subject.root, state) !== baseBytes) throw new Error("preflight read wrote durable bytes");
    const descriptor = { ...subject, fixtureIdentity: locked.identity, repoTree: git(subject.root, "rev-parse", "HEAD^{tree}"), repositoryFingerprint: repositoryFingerprint(subject.root),
      inputFingerprint, byteWitnessFingerprint: digestJson(JSON.parse(baseBytes)), fileCount: visible.length, model: { nodes: model.nodes.length, relations: model.relations.length, flows: model.flows?.length ?? 0 },
      codeFacts, preflight: { edit: expectedEdit, full: expectedFull }, actualCoverageBeforeTiming: { edit: expectedEdit.checks, full: expectedFull.checks } };
    record.subjects.push(descriptor); save();
    for (const [kind, count, expected] of [["edit", 5, expectedEdit], ["full", 3, expectedFull]] as const) {
      for (let index = 1; index <= count; index++) {
        if (benchmarkByteWitness(subject.root, state) !== baseBytes) throw new Error("subject changed before sample");
        const argv = kind === "edit"
          ? [process.execPath, record.engine.entry, "checkpoint", "--json", ...subject.paths.flatMap(path => ["--changed-path", path])]
          : [process.execPath, "--eval", "import {readCompleteTaskArchitectureDebt} from " + JSON.stringify(join(engineRoot, "packages/local-runtime/runtime-daemon/src/architecture-debt.ts")) + "; process.stdout.write(JSON.stringify(readCompleteTaskArchitectureDebt(process.cwd())));"];
        const start = process.hrtime.bigint();
        const child = Bun.spawn(argv, { cwd: subject.root, env: { ...env, ARCHCONTEXT_STATE_DIR: state }, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        const elapsedNs = process.hrtime.bigint() - start;
        let result: any; let report: any; let parseError: string | undefined;
        try { result = JSON.parse(stdout); report = kind === "edit" ? result.data : result; } catch (e) { parseError = String(e); }
        const bytesUnchanged = benchmarkByteWitness(subject.root, state) === baseBytes;
        const parity = report !== undefined && JSON.stringify(report) === JSON.stringify(expected);
        const valid = report !== undefined && architectureDebtReportIssues(report).length === 0;
        const sample = { subject: subject.name, kind, index, engineSha, repoSha: subject.repoSha, inputFingerprint, changedPaths: kind === "edit" ? subject.paths : [],
          argv, elapsedNs: elapsedNs.toString(), elapsedMs: Number(elapsedNs) / 1e6, below3000ms: elapsedNs < 3_000_000_000n,
          exitCode, envelopeOk: kind === "edit" ? result?.ok : undefined, parity, valid, bytesUnchanged, report, stderr,
          ...(parseError ? { parseError, stdout } : {}) };
        record.samples.push(sample); save();
        console.log(JSON.stringify({ phase, subject: subject.name, kind, index, elapsedMs: sample.elapsedMs, below3000ms: sample.below3000ms,
          digest: report?.digest, coverage: report?.coverage, parity, bytesUnchanged, exitCode }));
        if (exitCode !== 0 || (kind === "edit" && !result?.ok) || !parity || !valid || !bytesUnchanged) throw new Error("invalid sample retained; stop without reducing scope");
      }
    }
  } finally { holder.close(); }
}
record.completedAt = new Date().toISOString();
record.finalRepresentativeBudgetPassed = record.samples.filter((s: any) => s.subject === "representative" && s.kind === "edit").every((s: any) => s.below3000ms);
save();

function flag(name: string): string { const i = process.argv.indexOf(name); return i < 0 ? "" : process.argv[i + 1] ?? ""; }
function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function hashFile(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function save() { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(record, null, 2) + "\n"); }

