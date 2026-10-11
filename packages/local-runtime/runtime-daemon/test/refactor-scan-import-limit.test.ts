import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REFACTOR_REQUEST_SCHEMA_VERSION,
  REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
  moduleStatisticsSnapshotInvariantIssues,
  type JsonEnvelope,
  type ModuleStatisticsSnapshotV1,
  type RefactorAssessmentV1,
  type RefactorResolutionEvidenceV1
} from "@archcontext/contracts";
import { CODEGRAPH_IMPORT_NODE_READ_LIMIT, CodeGraphAdapter, codeGraphCliInvocation } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { createStartedDaemon } from "../src/index";
import { REPOSITORY_REFACTOR_REQUEST, refactorRequestId, repositoryRefactorRequest } from "../src/refactor-scan";
import { baselineImportNodeLimit } from "../src/refactor-verify";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";

const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-refactor-import-limit-state-"));
process.env.ARCHCONTEXT_STATE_DIR = STATE_ROOT;

const OWNER_NODE_ID = "module.import-limit-fixture";
// 52 files x 100 imports: more import nodes than the former fixed 5000-node read.
const FILE_COUNT = 52;
const IMPORTS_PER_FILE = 100;
const IMPORT_NODE_COUNT = FILE_COUNT * IMPORTS_PER_FILE;

let root = "";

/**
 * A committed repository indexed by the real CodeGraph CLI, with more import nodes than one
 * fixed 5000-node read. Every import resolves to a tracked file, so a complete read leaves no gap.
 */
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "archctx-refactor-import-limit-"));
  mkdirSync(join(root, "src"), { recursive: true });
  for (let file = 0; file < FILE_COUNT; file += 1) {
    const lines: string[] = [];
    for (let line = 0; line < IMPORTS_PER_FILE; line += 1) {
      const target = (file + 1 + (line % (FILE_COUNT - 1))) % FILE_COUNT;
      lines.push(`import { value${target} as imported${line} } from "./file-${target}";`);
    }
    lines.push(`export const value${file} = ${file};`);
    writeFileSync(join(root, `src/file-${file}.ts`), `${lines.join("\n")}\n`, "utf8");
  }
  initializeArchContextModel(root, "Import Limit App");
  writeFileSync(
    join(root, ".archcontext/model/nodes", `${OWNER_NODE_ID}.yaml`),
    [
      `id: "${OWNER_NODE_ID}"`,
      'kind: "module"',
      'name: "Import Limit Fixture"',
      'schemaVersion: "archcontext.node/v2"',
      "source:",
      "  include:",
      '    - "src/**"',
      'status: "active"',
      'summary: "Owns the fixture source tree."',
      ""
    ].join("\n"),
    "utf8"
  );
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  const invocation = codeGraphCliInvocation("codegraph", root);
  execFileSync(invocation.command, [...invocation.argsPrefix, "init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}, 300_000);

afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  for (const path of [root, STATE_ROOT]) if (path) rmSync(path, { recursive: true, force: true });
});

function startDaemon() {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
}

function scanData(envelope: JsonEnvelope): {
  requestId: string;
  worktree: { worktreeDigest: string };
  snapshot: ModuleStatisticsSnapshotV1;
  assessment: RefactorAssessmentV1;
  proposedRecommendations: { recommendationId: string }[];
} {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  expect(publishedSchemaIssues("runtime/runtime-refactor-scan.schema.json", envelope.data)).toEqual([]);
  return envelope.data as never;
}

describe("refactor scan over an index with more than 5000 import nodes", () => {
  test("a complete index gives complete code facts with the measured count", async () => {
    const daemon = await startDaemon();
    try {
      const { snapshot } = scanData(await daemon.refactorScan(root));
      expect(moduleStatisticsSnapshotInvariantIssues(snapshot)).toEqual([]);
      expect(snapshot.codeFacts).toMatchObject({
        coverage: "complete",
        truncated: false,
        edgeLimit: CODEGRAPH_IMPORT_NODE_READ_LIMIT,
        importNodeCount: IMPORT_NODE_COUNT
      });
      expect(snapshot.codeFacts.reasonCodes).not.toContain("code-facts-truncated");
      expect(snapshot.codeFacts.reasonCodes).not.toContain("code-facts-import-limit");
      expect(snapshot.repositorySummary.unresolvedImportCount).toBe(0);
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("a request limit below the index size reports code-facts-import-limit with the count and the limit", async () => {
    const daemon = await startDaemon();
    try {
      const request = { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "repository" as const }, importNodeLimit: 1000 };
      const data = scanData(await daemon.refactorScan(root, { request }));
      expect(moduleStatisticsSnapshotInvariantIssues(data.snapshot)).toEqual([]);
      // The index is complete, so the read is a configured prefix, not a truncated one.
      expect(data.snapshot.codeFacts).toMatchObject({
        coverage: "partial",
        truncated: false,
        edgeLimit: 1000,
        importNodeCount: IMPORT_NODE_COUNT
      });
      expect(data.snapshot.codeFacts.reasonCodes).toContain("code-facts-import-limit");
      expect(data.snapshot.codeFacts.reasonCodes).not.toContain("code-facts-truncated");

      const gap = data.assessment.observations.find((observation) => observation.kind === "evidence-gap")!;
      expect(gap.metrics).toMatchObject({ edgeLimit: 1000, importNodeCount: IMPORT_NODE_COUNT });
      expect(gap.evidence).toMatchObject({ kind: "evidence-gap", coverage: "partial" });
      expect((gap.evidence as { reasonCodes: string[] }).reasonCodes).not.toContain("code-facts-truncated");

      // The action names the limit flag, and says a new index does not help.
      const text = JSON.stringify(data.proposedRecommendations);
      expect(text).toContain("--import-node-limit");
      expect(text).toContain("a new CodeGraph index does not change this");
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("a request limit that is not a positive integer is refused before any read", async () => {
    const daemon = await startDaemon();
    try {
      const request = { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "repository" as const }, importNodeLimit: 0 };
      const envelope = await daemon.refactorScan(root, { request });
      expect(envelope.ok).toBe(false);
      expect((envelope as { error?: { code: string; message: string } }).error).toMatchObject({
        code: "AC_SCHEMA_INVALID",
        message: expect.stringContaining("importNodeLimit must be a positive integer")
      });
    } finally {
      await daemon.stop();
    }
  });
});

/** The candidate only a scan cut by the import limit raises: the evidence gap that names the limit. */
function importLimitCandidateId(data: ReturnType<typeof scanData>): string {
  const candidates = data.proposedRecommendations.filter((candidate) => JSON.stringify(candidate).includes("code-facts-import-limit"));
  expect(candidates).toHaveLength(1);
  return candidates[0]!.recommendationId;
}

function errorOf(envelope: JsonEnvelope): { code: string; message: string; reasonCode?: string } {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(false);
  return (envelope as unknown as { error: { code: string; message: string; reasonCode?: string } }).error;
}

const LIMIT = 1000;
const limitedRequest = { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "repository" as const }, importNodeLimit: LIMIT };

describe("a scan candidate found with a custom import node limit", () => {
  test("the re-measure request is the scan request, so the requestId is the same", async () => {
    expect(repositoryRefactorRequest(undefined)).toBe(REPOSITORY_REFACTOR_REQUEST);
    const daemon = await startDaemon();
    try {
      const limited = scanData(await daemon.refactorScan(root, { request: limitedRequest }));
      expect(refactorRequestId(repositoryRefactorRequest(LIMIT))).toBe(limited.requestId);
      const defaulted = scanData(await daemon.refactorScan(root));
      expect(refactorRequestId(repositoryRefactorRequest(undefined))).toBe(defaulted.requestId);
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("recommendations show finds the candidate only with the scan limit", async () => {
    const daemon = await startDaemon();
    try {
      const limited = scanData(await daemon.refactorScan(root, { request: limitedRequest }));
      const recommendationId = importLimitCandidateId(limited);
      // The default read is complete here, so the default scan has no such candidate.
      const defaulted = scanData(await daemon.refactorScan(root));
      expect(defaulted.proposedRecommendations.map((candidate) => candidate.recommendationId)).not.toContain(recommendationId);

      expect(errorOf(await daemon.recommendations(root, { command: "show", recommendationId }))).toMatchObject({
        code: "AC_REFACTOR_STALE",
        reasonCode: "recommendation-not-found"
      });

      const shown = await daemon.recommendations(root, { command: "show", recommendationId, importNodeLimit: LIMIT });
      expect(shown.ok, JSON.stringify(shown)).toBe(true);
      expect(publishedSchemaIssues("runtime/runtime-recommendation-show.schema.json", shown.data)).toEqual([]);
      const data = shown.data as { source: string; baseline: { snapshotDigest: string } };
      expect(data.source).toBe("scan-candidate");
      expect(data.baseline.snapshotDigest).toBe(limited.snapshot.snapshotDigest);
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("a decision records the candidate only with the scan limit, and records that scan's assessment", async () => {
    const daemon = await startDaemon();
    try {
      const limited = scanData(await daemon.refactorScan(root, { request: limitedRequest }));
      const recommendationId = importLimitCandidateId(limited);
      const decide = (importNodeLimit?: number) => daemon.recommendations(root, {
        command: "defer",
        recommendationId,
        reason: "Measured with the scan limit.",
        ...(importNodeLimit === undefined ? {} : { importNodeLimit })
      });

      expect(errorOf(await decide())).toMatchObject({ code: "AC_REFACTOR_STALE", reasonCode: "recommendation-not-found" });

      const decided = await decide(LIMIT);
      expect(decided.ok, JSON.stringify(decided)).toBe(true);
      const implicitRecord = (decided.data as { implicitRecord: { assessmentDigest: string; recommendationIds: string[] } }).implicitRecord;
      expect(implicitRecord.assessmentDigest).toBe(limited.assessment.assessmentDigest);
      expect(implicitRecord.recommendationIds).toContain(recommendationId);
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("an import node limit that is not a positive integer is refused for every command", async () => {
    const daemon = await startDaemon();
    try {
      for (const command of ["show", "defer", "metrics"] as const) {
        const envelope = await daemon.recommendations(root, { command, recommendationId: "recommendation.any", reason: "r", importNodeLimit: 0 });
        expect(errorOf(envelope), command).toMatchObject({
          code: "AC_SCHEMA_INVALID",
          message: expect.stringContaining("importNodeLimit must be a positive integer")
        });
      }
      const verify = await daemon.refactorVerify(root, {
        schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
        recommendationId: "recommendation.any",
        importNodeLimit: 1.5
      });
      expect(errorOf(verify)).toMatchObject({ code: "AC_SCHEMA_INVALID", message: expect.stringContaining("importNodeLimit must be a positive integer") });
    } finally {
      await daemon.stop();
    }
  });

  test("refactor verify measures with the baseline limit, or with the request limit", async () => {
    const daemon = await startDaemon();
    try {
      const limited = scanData(await daemon.refactorScan(root, { request: limitedRequest }));
      const recommendationId = importLimitCandidateId(limited);
      const recorded = await daemon.refactorRecord(root, {
        assessmentDigest: limited.assessment.assessmentDigest,
        expectedWorktreeDigest: limited.worktree.worktreeDigest
      });
      expect(recorded.ok, JSON.stringify(recorded)).toBe(true);
      const verify = async (importNodeLimit?: number) => {
        const envelope = await daemon.refactorVerify(root, {
          schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
          recommendationId,
          ...(importNodeLimit === undefined ? {} : { importNodeLimit })
        });
        expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
        return (envelope.data as unknown as { evidence: RefactorResolutionEvidenceV1 }).evidence;
      };

      // Same HEAD and the baseline's limit: AFTER is the BEFORE measurement.
      const sameLimit = await verify();
      expect(sameLimit.beforeSnapshotDigest).toBe(limited.snapshot.snapshotDigest);
      expect(sameLimit.afterSnapshotDigest).toBe(limited.snapshot.snapshotDigest);

      // A request limit replaces the baseline's.
      const wider = scanData(await daemon.refactorScan(root, { request: { ...limitedRequest, importNodeLimit: IMPORT_NODE_COUNT + 1 } }));
      expect(wider.snapshot.codeFacts.coverage).toBe("complete");
      const widerLimit = await verify(IMPORT_NODE_COUNT + 1);
      expect(widerLimit.afterSnapshotDigest).toBe(wider.snapshot.snapshotDigest);
    } finally {
      await daemon.stop();
    }
  }, 180_000);
});

describe("baselineImportNodeLimit", () => {
  const snapshot = (codeFacts: Partial<ModuleStatisticsSnapshotV1["codeFacts"]>) =>
    ({ codeFacts: { edgeLimit: LIMIT, importNodeCount: IMPORT_NODE_COUNT, ...codeFacts } }) as unknown as ModuleStatisticsSnapshotV1;

  test("gives the recorded limit of a baseline that has an import node count", () => {
    expect(baselineImportNodeLimit(snapshot({}))).toBe(LIMIT);
    expect(baselineImportNodeLimit(snapshot({ importNodeCount: null }))).toBe(LIMIT);
  });

  test("gives the default for no baseline, the default limit, no limit, or a baseline from before the count", () => {
    expect(baselineImportNodeLimit(undefined)).toBeUndefined();
    expect(baselineImportNodeLimit(snapshot({ edgeLimit: CODEGRAPH_IMPORT_NODE_READ_LIMIT }))).toBeUndefined();
    expect(baselineImportNodeLimit(snapshot({ edgeLimit: null }))).toBeUndefined();
    const legacy = { codeFacts: { edgeLimit: 5000 } } as unknown as ModuleStatisticsSnapshotV1;
    expect(baselineImportNodeLimit(legacy)).toBeUndefined();
  });
});
