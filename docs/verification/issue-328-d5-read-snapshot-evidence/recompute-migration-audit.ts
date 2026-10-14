import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

if (process.argv.length !== 5) {
  throw new Error("usage: recompute-migration-audit.ts <engine-git-root> <consumer-git-root> <external-output>");
}
const [engineRoot, consumerRoot, outputRoot] = process.argv.slice(2).map(path => realpathSync(resolve(path)));
function contains(root: string, child: string): boolean {
  const path = relative(root, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep));
}
if (contains(engineRoot, outputRoot) || contains(consumerRoot, outputRoot)) {
  throw new Error("output directory must be outside both source repositories");
}
// Process-only Git settings: immutable blob reads and disposable reconstruction, no user hooks/filters.
process.env.GIT_OPTIONAL_LOCKS = "0";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
const { digestJson } = await import(join(engineRoot, "packages/contracts/src/schema.ts"));
const { architectureDebtReportIssues } = await import(join(engineRoot, "packages/contracts/src/architecture-debt.ts"));
const { listGitVisibleFiles } = await import(join(engineRoot, "packages/local-runtime/git-adapter/src/index.ts"));
const { scanDocumentRegions } = await import(join(engineRoot, "packages/core/projection-engine/src/document-regions.ts"));
const { exportNativeContext } = await import(join(engineRoot, "packages/local-runtime/model-store-yaml/src/native-context.ts"));
const evidenceRoot = import.meta.dir;
const manifest = JSON.parse(readFileSync(join(evidenceRoot, "migration-provenance.json"), "utf8"));
const summary = JSON.parse(readFileSync(resolve(evidenceRoot, manifest.benchmarkSummary), "utf8"));
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function requireEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(label + " mismatch");
}
function git(root: string, args: string[], input?: string): Buffer {
  return execFileSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root, input, maxBuffer: 512 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
  });
}
type Blob = { bytes: Buffer; mode: string };
function blobsAt(root: string, ref: string): Map<string, Blob> {
  const entries = git(root, ["ls-tree", "-rz", ref]).toString("utf8").split("\0").filter(Boolean).map(row => {
    const tab = row.indexOf("\t");
    const [mode, type, oid] = row.slice(0, tab).split(" ");
    const path = row.slice(tab + 1);
    if (type !== "blob" || !["100644", "100755"].includes(mode!) || isAbsolute(path) || path.split("/").includes("..")) {
      throw new Error("unsupported fixture entry: " + path);
    }
    return { path, mode: mode!, oid: oid! };
  });
  const batch = git(root, ["cat-file", "--batch"], entries.map(entry => entry.oid).join("\n") + "\n");
  const result = new Map<string, Blob>();
  let offset = 0;
  for (const entry of entries) {
    const end = batch.indexOf(10, offset);
    const [oid, type, lengthText] = batch.subarray(offset, end).toString("ascii").split(" ");
    const length = Number(lengthText);
    if (end < offset || oid !== entry.oid || type !== "blob" || !Number.isSafeInteger(length) || length < 0) {
      throw new Error("invalid Git blob header");
    }
    offset = end + 1;
    const bytes = batch.subarray(offset, offset + length);
    offset += length;
    if (bytes.length !== length || batch[offset++] !== 10) throw new Error("invalid Git blob framing");
    result.set(entry.path, { bytes, mode: entry.mode });
  }
  if (offset !== batch.length) throw new Error("unexpected Git blob tail");
  return result;
}
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function filesRoot(files: Map<string, Blob>): string {
  return digestJson([...files].sort(([a], [b]) => byteOrder(a, b)).map(([path, file]) => ({ path, hash: hash(file.bytes), bytes: file.bytes.length })));
}
function worktreeBlobs(root: string): Map<string, Blob> {
  return new Map(listGitVisibleFiles(root).map((path: string) => [path, { bytes: readFileSync(join(root, path)), mode: "" }]));
}
function inputFingerprint(files: Map<string, Blob>): string {
  // Preserve the original producer's localeCompare ordering, distinct from audit root ordering.
  return digestJson([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, file]) => ({ path, hash: hash(file.bytes) })));
}
const patch = readFileSync(join(evidenceRoot, manifest.patch.file));
requireEqual([hash(patch), patch.length], [manifest.patch.sha256, manifest.patch.bytes], "migration patch");
for (const [section, expected] of Object.entries(manifest.recordedSectionDigests)) {
  requireEqual(digestJson(summary[section]), expected, "recorded section " + section);
}
requireEqual(Object.keys(summary.reports).sort(), ["control/edit", "control/full", "representative/edit", "representative/full"], "report pool");
for (const [name, report] of Object.entries(summary.reports)) {
  requireEqual(architectureDebtReportIssues(report as any), [], "whole report " + name);
}

const scratch = mkdtempSync(join(outputRoot, "d5-reconstruction-"));
function reconstruct(sourceRoot: string, ref: string, label: string): { root: string; before: Map<string, Blob> } {
  const root = join(scratch, label);
  git(outputRoot, ["clone", "--shared", "--no-checkout", "--", sourceRoot, root]);
  git(root, ["update-ref", "--no-deref", "HEAD", ref]);
  git(root, ["read-tree", ref]);
  const before = blobsAt(sourceRoot, ref);
  for (const [path, file] of before) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
    chmodSync(target, file.mode === "100755" ? 0o755 : 0o644);
  }
  return { root, before };
}
const rep = manifest.representative;
const representative = reconstruct(consumerRoot, rep.sourceSha, "representative");
requireEqual(git(consumerRoot, ["rev-parse", rep.sourceSha + "^{tree}"]).toString().trim(), rep.sourceTree, "representative Git tree");
requireEqual(filesRoot(representative.before), rep.roots.beforeFiles, "before file root");
git(representative.root, ["apply", "--whitespace=nowarn", "--", join(evidenceRoot, manifest.patch.file)]);
const after = worktreeBlobs(representative.root);
requireEqual(after.size, representative.before.size, "tracked file count");
requireEqual(filesRoot(after), rep.roots.afterFiles, "after file root");
const changed = [...representative.before].filter(([path, file]) => !after.has(path) || !file.bytes.equals(after.get(path)!.bytes)).map(([path]) => path).sort(byteOrder);
if (changed.some(path => !path.startsWith("docs/architecture/"))) throw new Error("non-architecture file changed");
requireEqual(digestJson(changed), rep.roots.changedPaths, "changed path root");
const modelFiles = (files: Map<string, Blob>) => new Map([...files].filter(([path]) => path.startsWith(".archcontext/")));
requireEqual(filesRoot(modelFiles(representative.before)), rep.roots.modelFiles, "before model root");
requireEqual(filesRoot(modelFiles(after)), rep.roots.modelFiles, "after model root");
const oldManifest = JSON.parse(representative.before.get("docs/architecture/.projection-manifest.json")!.bytes.toString("utf8"));
const mixed = oldManifest.targets.filter((target: any) => target.ownership === "mixed");
const humanRows = mixed.map((target: any) => {
  function human(bytes: Buffer) {
    const scan = scanDocumentRegions(bytes.toString("utf8"), { generatedBodyLiterals: false });
    if (scan.diagnostics.length || scan.generatedRegions.some((region: any) => !region.closed)) {
      throw new Error("ambiguous regions: " + target.path);
    }
    return {
      targets: scan.generatedRegions.map((region: any) => region.targetId),
      regions: scan.humanRegions.map((region: any) => bytes.subarray(region.startByte, region.endByte)),
    };
  }
  const beforeHuman = human(representative.before.get(target.path)!.bytes);
  const afterHuman = human(after.get(target.path)!.bytes);
  requireEqual(afterHuman.targets, beforeHuman.targets, "generated region structure " + target.path);
  requireEqual(afterHuman.regions.length, beforeHuman.regions.length, "human region count " + target.path);
  const regions = beforeHuman.regions.map((bytes: Buffer, index: number) => {
    if (!bytes.equals(afterHuman.regions[index]!)) throw new Error("human bytes changed: " + target.path);
    return { hash: hash(bytes), bytes: bytes.length };
  });
  return { path: target.path, targetId: target.targetId, regions };
}).sort((a: any, b: any) => byteOrder(a.path, b.path));
requireEqual(digestJson(humanRows), rep.roots.humanRegions, "human region root");
const counts = {
  trackedFiles: after.size,
  changedFiles: changed.length,
  unchangedFiles: after.size - changed.length,
  modelFiles: modelFiles(after).size,
  nonArchitectureFiles: [...after.keys()].filter(path => !path.startsWith("docs/architecture/")).length,
  mixedDocuments: mixed.length,
  humanRegions: humanRows.reduce((count: number, row: any) => count + row.regions.length, 0),
  generatedWholeFiles: oldManifest.targets.filter((target: any) => target.ownership === "generated").length,
};
requireEqual(counts, rep.counts, "migration counts");
const beforeExport = exportNativeContext(representative.root, { source: "ref", ref: rep.sourceSha });
const afterExport = exportNativeContext(representative.root, { source: "worktree" });
for (const [key, expected] of Object.entries(rep.nativeBusinessDigests)) {
  requireEqual(beforeExport[key], afterExport[key], "native payload " + key);
  requireEqual(digestJson(afterExport[key]), expected, "native digest " + key);
}
const control = reconstruct(engineRoot, manifest.control.sourceSha, "control");
requireEqual(git(engineRoot, ["rev-parse", manifest.control.sourceSha + "^{tree}"]).toString().trim(), manifest.control.sourceTree, "control Git tree");
const controlFiles = worktreeBlobs(control.root);
requireEqual(controlFiles.size, manifest.control.trackedFiles, "control file count");
requireEqual(filesRoot(controlFiles), manifest.control.filesRoot, "control file root");
const fingerprints = { representative: inputFingerprint(after), control: inputFingerprint(controlFiles) };
requireEqual(fingerprints.representative, rep.inputFingerprint, "representative input fingerprint");
requireEqual(fingerprints.control, manifest.control.inputFingerprint, "control input fingerprint");

requireEqual(summary.runs.map((run: any) => run.phase), ["before", "after"], "sample phases");
let sampleCount = 0;
for (const run of summary.runs) {
  const engineSha = run.phase === "before" ? "a697adad7bf686f309405d7a9feef8173d8140a5" : "dabf86ab93cfea3566df0a994754086d5104e4a6";
  requireEqual(run.engine.sha, engineSha, "run engine");
  requireEqual(run.samples.length, 16, "samples per phase");
  for (const subject of summary.subjects) {
    const fixture = subject.name === "representative" ? rep : manifest.control;
    requireEqual([subject.repoSha, subject.repoTree, subject.inputFingerprint], [fixture.sourceSha, fixture.sourceTree, fingerprints[subject.name]], "subject binding");
    for (const kind of ["edit", "full"]) {
      const samples = run.samples.filter((sample: any) => sample.subject === subject.name && sample.kind === kind);
      requireEqual(samples.map((sample: any) => sample.index), kind === "edit" ? [1, 2, 3, 4, 5] : [1, 2, 3], "sample sequence");
      for (const sample of samples) {
        const label = [run.phase, subject.name, kind, sample.index].join("/");
        requireEqual([sample.engineSha, sample.repoSha, sample.inputFingerprint], [engineSha, fixture.sourceSha, fingerprints[subject.name]], label + " binding");
        requireEqual(sample.changedPaths, kind === "edit" ? subject.paths : [], label + " changed paths");
        if (!/^[1-9][0-9]*$/.test(sample.elapsedNs)) throw new Error(label + " invalid elapsedNs");
        const ns = BigInt(sample.elapsedNs);
        requireEqual(sample.elapsedMs, Number(ns) / 1e6, label + " ns/ms");
        requireEqual(sample.below3000ms, ns < 3000000000n, label + " threshold flag");
        if (run.phase === "after" && subject.name === "representative" && kind === "edit" && ns >= 3000000000n) throw new Error(label + " exceeds budget");
        requireEqual([sample.exitCode, sample.parity, sample.valid, sample.bytesUnchanged, sample.stderr], [0, true, true, true, ""], label + " assertions");
        if (kind === "edit") requireEqual(sample.envelopeOk, true, label + " envelope");
        const reportRef = subject.name + "/" + kind;
        const report = summary.reports[reportRef];
        requireEqual([sample.reportRef, sample.reportDigest, sample.coverage], [reportRef, report.digest, report.coverage], label + " report");
        sampleCount++;
      }
    }
  }
}
requireEqual(sampleCount, 32, "total samples");
const result = {
  schemaVersion: "archcontext.d5-reconstruction-verification/v2",
  counts, fingerprints, controlFiles: controlFiles.size, samples: sampleCount, wholeReports: 4,
  fixedGitAndPatchReconstructed: true, humanBytesEqual: true, nativePayloadsEqual: true,
  recordedSectionsUnchanged: true, allSampleAssertionsVerified: true,
  limitation: "Recorded timings and CodeGraph coverage were not remeasured; per-file rows are reconstructed in memory, not republished.",
};
writeFileSync(join(outputRoot, "verification-result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
