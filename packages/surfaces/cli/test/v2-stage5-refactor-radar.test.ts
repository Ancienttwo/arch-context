import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REFACTOR_DECISION_SCHEMA_VERSION, serializeRefactorDecision, stableYaml, type RefactorDecisionV1, type RefactorScanV2, type RefactorSimulationResultV1, type RefactorVerifyV2 } from "@archcontext/contracts";
import { codeGraphCliInvocation } from "@archcontext/local-runtime/codegraph-adapter";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { runCli } from "../src/main";

const TEMP_DIRS: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Stage5 Test", "-c", "user.email=stage5@example.test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
}

function indexCodeGraph(root: string): void {
  const inv = codeGraphCliInvocation("codegraph", root);
  execFileSync(inv.command, [...inv.argsPrefix, "init", root], {
    cwd: root,
    env: { ...process.env, DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function syncCodeGraph(root: string): void {
  const inv = codeGraphCliInvocation("codegraph", root);
  execFileSync(inv.command, [...inv.argsPrefix, "sync", root], {
    cwd: root,
    env: { ...process.env, DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function capabilityYaml(id: string, include: string[], extra: Record<string, unknown> = {}): string {
  return stableYaml({
    schemaVersion: "archcontext.node/v2",
    id,
    kind: "capability",
    name: id,
    status: "active",
    summary: `Owns ${include.join(", ")}.`,
    source: { include, ...extra }
  });
}

function createCycleAndKillFixture(commitCount = 5): string {
  const root = makeTempDir("archctx-stage5-");
  mkdirSync(join(root, "src/a"), { recursive: true });
  mkdirSync(join(root, "src/b"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), ".codegraph/\n", "utf8");
  writeFileSync(join(root, "src/a/entry.ts"), 'import { helper } from "../b/internal";\nexport function runA() { return helper(); }\n', "utf8");
  writeFileSync(join(root, "src/b/index.ts"), 'import { runA } from "../a/entry";\nexport function entryB() { return runA(); }\n', "utf8");
  writeFileSync(join(root, "src/b/internal.ts"), "export function secretHelper() { return 42; }\nexport function helper() { return secretHelper(); }\n", "utf8");

  initializeArchContextModel(root, "Stage 5 App");
  const nodes = join(root, ".archcontext/model/nodes");
  rmSync(join(nodes, "capability.architecture.context.yaml"), { force: true });
  writeFileSync(join(nodes, "capability.a.yaml"), capabilityYaml("capability.a", ["src/a/**"]), "utf8");
  writeFileSync(
    join(nodes, "capability.b.yaml"),
    capabilityYaml("capability.b", ["src/b/**"], {
      entrypoints: [{
        id: "entrypoint.b",
        path: "src/b/index.ts",
        symbols: [{
          name: "entryB",
          sinks: [{ id: "sink.b.internal", path: "src/b/internal.ts", symbol: "helper" }]
        }]
      }]
    }),
    "utf8"
  );
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "initial cycle + bypass");
  for (let i = 1; i < commitCount; i += 1) {
    writeFileSync(join(root, "src/a/entry.ts"), `import { helper } from "../b/internal";\nexport function runA() { return helper() + ${i}; }\n`, "utf8");
    writeFileSync(join(root, "src/b/internal.ts"), `export function secretHelper() { return ${42 + i}; }\nexport function helper() { return secretHelper(); }\n`, "utf8");
    git(root, "add", "src/a/entry.ts", "src/b/internal.ts");
    git(root, "commit", "-qm", `cochange-${i}`);
  }
  indexCodeGraph(root);
  return root;
}

describe("v2 Stage 5 pure-Git refactor radar (#636, #637, #638, #643)", () => {
  test("full pure-Git scan -> decide accept -> fix -> verify <id> -> decide resolve loop with path#symbol killList", async () => {
    const prevState = process.env.ARCHCONTEXT_STATE_DIR;
    const stateDir = makeTempDir("archctx-stage5-nostate-");
    process.env.ARCHCONTEXT_STATE_DIR = stateDir;
    try {
      const root = createCycleAndKillFixture(2);
      const scanEnv = await runCli("scan", ["--json"], root);
      expect(scanEnv.ok, JSON.stringify(scanEnv)).toBe(true);
      const scan = scanEnv.data as RefactorScanV2;
      expect(publishedSchemaIssues("runtime/refactor-scan-v2.schema.json", scan)).toEqual([]);

      const bypass = scan.findings.find((f) => f.detector === "entrypoint-bypass");
      expect(bypass).toBeDefined();
      expect(scan.findings.some((f) => f.detector === "component-cycle")).toBe(true);

      // No SQLite state or daemon files created.
      expect(existsSync(join(stateDir, "archcontext.sqlite"))).toBe(false);

      // Accept with path#symbol killList
      const acceptedEnv = await runCli("decide", [
        "accept",
        bypass!.recommendationId,
        "--kill-symbol",
        "src/b/internal.ts#secretHelper",
        "--reason",
        "Remove bypass and legacy helper"
      ], root);
      expect(acceptedEnv.ok, JSON.stringify(acceptedEnv)).toBe(true);
      const decisionFile = join(root, `.archcontext/refactor-decisions/${bypass!.recommendationId}.json`);
      expect(existsSync(decisionFile)).toBe(true);

      // Unfiltered decide list returns all statuses (#643 Comment 2)
      const listAll = await runCli("decide", ["list", "--json"], root);
      expect(listAll.ok).toBe(true);
      expect((listAll.data as { status: string; decisions: unknown[]; openFindings: unknown[] }).status).toBe("all");
      expect((listAll.data as { decisions: unknown[] }).decisions).toHaveLength(1);

      // Before fix: symbol still present & metric unsatisfied
      const beforeVerifyEnv = await runCli("verify", [bypass!.recommendationId, "--json"], root);
      expect(beforeVerifyEnv.ok, JSON.stringify(beforeVerifyEnv)).toBe(true);
      const beforeVerify = beforeVerifyEnv.data as RefactorVerifyV2;
      expect(publishedSchemaIssues("runtime/refactor-verify-v2.schema.json", beforeVerify)).toEqual([]);
      expect(beforeVerify.disposition).toBe("unresolved");
      expect(beforeVerify.killListChecks).toEqual([
        { kind: "symbol", target: "src/b/internal.ts#secretHelper", required: true, status: "still-present" }
      ]);

      // Fix bypass and remove secretHelper, leaving index unsynced first -> P2 #1 uncheckable => stale
      writeFileSync(join(root, "src/a/entry.ts"), 'import { entryB } from "../b/index";\nexport function runA(n = 0) { return n > 0 ? 1 : entryB(); }\n', "utf8");
      writeFileSync(join(root, "src/b/internal.ts"), "export function helper() { return 1; }\n", "utf8");
      git(root, "add", "src/a/entry.ts", "src/b/internal.ts");
      git(root, "commit", "-qm", "remove bypass and secretHelper before sync");

      const staleVerify = (await runCli("verify", [bypass!.recommendationId, "--json"], root)).data as RefactorVerifyV2;
      expect(staleVerify.disposition).toBe("stale");
      expect(staleVerify.killListChecks[0]?.status).toBe("uncheckable");

      // After codegraph sync: symbol absent & metric satisfied -> resolved!
      syncCodeGraph(root);
      const afterVerifyEnv = await runCli("verify", [bypass!.recommendationId, "--json"], root);
      expect(afterVerifyEnv.ok, JSON.stringify(afterVerifyEnv)).toBe(true);
      const afterVerify = afterVerifyEnv.data as RefactorVerifyV2;
      expect(afterVerify.disposition).toBe("resolved");
      expect(afterVerify.killListChecks).toEqual([
        { kind: "symbol", target: "src/b/internal.ts#secretHelper", required: true, status: "removed" }
      ]);

      // Commit resolve receipt via decide resolve
      const resolvedEnv = await runCli("decide", [
        "resolve",
        bypass!.recommendationId,
        "--resolution-digest",
        afterVerify.resolutionDigest,
        "--reason",
        "Verified bypass and secretHelper removal"
      ], root);
      expect(resolvedEnv.ok, JSON.stringify(resolvedEnv)).toBe(true);

      // Clean-clone acceptor (#643 Comment 1): reintroduce secretHelper + bypass AFTER decision says resolved!
      writeFileSync(join(root, "src/a/entry.ts"), 'import { helper } from "../b/internal";\nexport function runA() { return helper(); }\n', "utf8");
      writeFileSync(join(root, "src/b/internal.ts"), "export function secretHelper() { return 42; }\nexport function helper() { return secretHelper(); }\n", "utf8");
      git(root, "add", "src/a/entry.ts", "src/b/internal.ts");
      git(root, "commit", "-qm", "regress after resolved receipt");
      syncCodeGraph(root);

      const recheck = (await runCli("verify", [bypass!.recommendationId, "--json"], root)).data as RefactorVerifyV2;
      expect(recheck.disposition).toBe("unresolved");
      expect(recheck.historicalReceipt?.status).toBe("resolved");
      expect(recheck.killListChecks[0]?.status).toBe("still-present");

      // Missing baseline metadata -> stale with baseline-metadata-missing (#643 Comment 1)
      const strippedId = "recommendation.1111222233334444";
      const parsedDecision = JSON.parse(execFileSync("cat", [decisionFile], { encoding: "utf8" })) as RefactorDecisionV1;
      const missingMeta: RefactorDecisionV1 = {
        schemaVersion: REFACTOR_DECISION_SCHEMA_VERSION,
        namespace: parsedDecision.namespace,
        recommendationId: parsedDecision.recommendationId,
        fingerprint: parsedDecision.fingerprint,
        fingerprintSchemaVersion: parsedDecision.fingerprintSchemaVersion,
        category: parsedDecision.category,
        kind: parsedDecision.kind,
        subject: parsedDecision.subject,
        affectedNodeIds: parsedDecision.affectedNodeIds,
        affectedNodeCount: parsedDecision.affectedNodeCount,
        regressesFrom: parsedDecision.regressesFrom,
        status: "resolved",
        observationMetrics: null,
        reason: "Legacy resolved file without baseline outcomes",
        actor: parsedDecision.actor,
        decidedAt: parsedDecision.decidedAt,
        provenance: parsedDecision.provenance
      };
      void strippedId;
      writeFileSync(decisionFile, serializeRefactorDecision(missingMeta), "utf8");
      const missingMetaVerify = (await runCli("verify", [bypass!.recommendationId, "--json"], root)).data as RefactorVerifyV2;
      expect(missingMetaVerify.disposition).toBe("stale");
      expect(missingMetaVerify.blockingReasons).toContain("baseline-metadata-missing");
    } finally {
      if (prevState === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
      else process.env.ARCHCONTEXT_STATE_DIR = prevState;
    }
  }, 120_000);

  test("refactor simulate distinguishes whole-file moves from unmeasured symbol subsets (#638, P2 #3)", async () => {
    const root = createCycleAndKillFixture(2);

    const wholeFile = await runCli("refactor", [
      "simulate",
      "--move",
      "src/b/index.ts:capability.a",
      "--target",
      "pair:capability.a|capability.b",
      "--json"
    ], root);
    expect(wholeFile.ok, JSON.stringify(wholeFile)).toBe(true);
    const simWhole = wholeFile.data as RefactorSimulationResultV1;
    expect(publishedSchemaIssues("runtime/refactor-simulate.schema.json", simWhole)).toEqual([]);
    expect(simWhole.measurementStatus).toBe("measured");
    expect(simWhole.metricsDelta.after?.crossModuleCycleCount).toBe(0);
    expect(simWhole.resolvedCycles).toContain("capability.a<->capability.b");
    expect(simWhole.cutCandidates.some((c) => c.strategy === "extract-shared-leaf" && c.measured === false && c.breaksPair === null)).toBe(true);
    expect(simWhole.cutCandidates.some((c) => c.strategy === "invert-interface" && c.measured === false && c.breaksPair === null)).toBe(true);

    const subset = await runCli("refactor", [
      "simulate",
      "--move",
      "src/b/index.ts:capability.a:entryB",
      "--target",
      "pair:capability.a|capability.b",
      "--json"
    ], root);
    expect(subset.ok, JSON.stringify(subset)).toBe(true);
    const simSubset = subset.data as RefactorSimulationResultV1;
    expect(simSubset.measurementStatus).toBe("unmeasured");
    expect(simSubset.unmeasuredReasons).toContain("symbol-subset-rewrite-unmodeled");
    expect(simSubset.metricsDelta.after).toBeNull();
    expect(simSubset.metricsDelta.delta).toBeNull();
  }, 120_000);

  test("co-change-coupling fails closed in shallow clones (#637 P2 #2) and sparse-checkout reads match full checkout without worktree writes (#643 #5)", async () => {
    const origin = createCycleAndKillFixture(5);
    const shallow = makeTempDir("archctx-stage5-shallow-");
    execFileSync("git", ["clone", "--depth=1", `file://${origin}`, shallow], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    indexCodeGraph(shallow);

    const shallowScan = (await runCli("scan", ["--json"], shallow)).data as RefactorScanV2;
    expect(shallowScan.coverage.gitHistory).toBe("shallow");
    expect(shallowScan.findings.some((f) => f.detector === "co-change-coupling")).toBe(false);

    // On full history, co-change-coupling IS emitted -> reject & commit decision at HEAD
    const fullScan = (await runCli("scan", ["--json"], origin)).data as RefactorScanV2;
    const coChange = fullScan.findings.find((f) => f.detector === "co-change-coupling");
    expect(coChange).toBeDefined();

    const rejectedCo = await runCli("decide", ["reject", coChange!.recommendationId, "--reason", "Track co-change pair"], origin);
    expect(rejectedCo.ok, JSON.stringify(rejectedCo)).toBe(true);
    git(origin, "add", ".archcontext/refactor-decisions");
    git(origin, "commit", "-qm", "commit co-change rejected decision");

    // Clone origin at exact same SHA and configure sparse checkout excluding only .archcontext/refactor-decisions/
    const sparse = makeTempDir("archctx-stage5-sparse-");
    execFileSync("git", ["clone", `file://${origin}`, sparse], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    git(sparse, "sparse-checkout", "set", "--no-cone", "/*", "!/.archcontext/refactor-decisions/");
    expect(existsSync(join(sparse, ".archcontext/manifest.yaml"))).toBe(true);
    expect(existsSync(join(sparse, ".archcontext/refactor-decisions"))).toBe(false);
    indexCodeGraph(sparse);

    // Both full and sparse checkouts at the same HEAD return the identical rejected decision without writing sparse worktree
    const fullRejected = await runCli("decide", ["list", "--status", "rejected", "--json"], origin);
    const sparseRejected = await runCli("decide", ["list", "--status", "rejected", "--json"], sparse);
    expect(fullRejected.ok, JSON.stringify(fullRejected)).toBe(true);
    expect(sparseRejected.ok, JSON.stringify(sparseRejected)).toBe(true);
    expect((sparseRejected.data as { decisions: RefactorDecisionV1[] }).decisions)
      .toEqual((fullRejected.data as { decisions: RefactorDecisionV1[] }).decisions);

    const sparseAll = await runCli("decide", ["list", "--json"], sparse);
    expect(sparseAll.ok, JSON.stringify(sparseAll)).toBe(true);
    expect((sparseAll.data as { decisions: RefactorDecisionV1[] }).decisions.some((d) => d.recommendationId === coChange!.recommendationId)).toBe(true);
    expect(existsSync(join(sparse, ".archcontext/refactor-decisions"))).toBe(false);

    // Refuses writing into sparse-hidden decision path without mutating checkout!
    const refusedWrite = await runCli("decide", ["defer", coChange!.recommendationId, "--reason", "Try sparse write"], sparse);
    expect(refusedWrite.ok).toBe(false);
    expect((refusedWrite as { error: { reasonCode: string } }).error.reasonCode).toBe("refactor-decision-sparse-write-refused");
    expect(existsSync(join(sparse, ".archcontext/refactor-decisions"))).toBe(false);
  }, 120_000);

  test("co-change-coupling sliding-window decay without structural closure returns stale (#637 P2 #2)", async () => {
    const root = makeTempDir("archctx-stage5-cochange-decay-");
    mkdirSync(join(root, "src/a"), { recursive: true });
    mkdirSync(join(root, "src/b"), { recursive: true });
    mkdirSync(join(root, "src/u"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), ".codegraph/\n", "utf8");
    writeFileSync(join(root, "src/a/a.ts"), "export function aFn() { return 1; }\n", "utf8");
    writeFileSync(join(root, "src/b/b.ts"), "export function bFn() { return 2; }\n", "utf8");
    writeFileSync(join(root, "src/u/unrelated.ts"), "export function uFn() { return 0; }\n", "utf8");

    initializeArchContextModel(root, "Stage 5 CoChange App");
    const nodes = join(root, ".archcontext/model/nodes");
    rmSync(join(nodes, "capability.architecture.context.yaml"), { force: true });
    writeFileSync(join(nodes, "capability.a.yaml"), capabilityYaml("capability.a", ["src/a/**"]), "utf8");
    writeFileSync(join(nodes, "capability.b.yaml"), capabilityYaml("capability.b", ["src/b/**"]), "utf8");
    writeFileSync(join(nodes, "capability.u.yaml"), capabilityYaml("capability.u", ["src/u/**"]), "utf8");
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "init statically unlinked cochange repo");
    for (let i = 1; i <= 5; i += 1) {
      writeFileSync(join(root, "src/a/a.ts"), `export function aFn() { return ${i + 10}; }\n`, "utf8");
      writeFileSync(join(root, "src/b/b.ts"), `export function bFn() { return ${(i + 10) * 2}; }\n`, "utf8");
      git(root, "add", "src/a/a.ts", "src/b/b.ts");
      git(root, "commit", "-qm", `cochange-${i}`);
    }
    indexCodeGraph(root);

    const initialScan = (await runCli("scan", ["--json"], root)).data as RefactorScanV2;
    const coChange = initialScan.findings.find((f) => f.detector === "co-change-coupling");
    expect(coChange).toBeDefined();

    const accepted = await runCli("decide", ["accept", coChange!.recommendationId, "--reason", "Decouple co-change"], root);
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
    git(root, "add", ".archcontext/refactor-decisions");
    git(root, "commit", "-qm", "accept co-change decision");

    // Push 205 unrelated commits modifying only src/u/unrelated.ts so the 200-commit co-change window decays cleanly
    const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD");
    const baseSha = git(root, "rev-parse", "HEAD");
    const stream: string[] = [];
    for (let i = 1; i <= 205; i += 1) {
      const msg = `unrelated-${i}\n`;
      const content = `export function uFn() { return ${i}; }\n`;
      stream.push(`commit refs/heads/${branch}\n`);
      stream.push(`mark :${i}\n`);
      stream.push(`committer Stage5 Test <stage5@example.test> ${1700000000 + i} +0000\n`);
      stream.push(`data ${Buffer.byteLength(msg)}\n${msg}`);
      if (i === 1) stream.push(`from ${baseSha}\n`);
      stream.push("M 100644 inline src/u/unrelated.ts\n");
      stream.push(`data ${Buffer.byteLength(content)}\n${content}`);
    }
    const importRes = spawnSync("git", ["fast-import", "--quiet"], {
      cwd: root,
      input: stream.join(""),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    expect(importRes.status, importRes.stderr).toBe(0);
    git(root, "reset", "--hard", `refs/heads/${branch}`);
    syncCodeGraph(root);

    const decayVerifyEnv = await runCli("verify", [coChange!.recommendationId, "--json"], root);
    expect(decayVerifyEnv.ok, JSON.stringify(decayVerifyEnv)).toBe(true);
    const decayVerify = decayVerifyEnv.data as RefactorVerifyV2;
    expect(decayVerify.disposition).toBe("stale");
    expect(decayVerify.blockingReasons).toContain("co-change-window-decay-without-structural-closure");
  }, 120_000);
});
