import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REFACTOR_REQUEST_SCHEMA_VERSION,
  moduleStatisticsSnapshotInvariantIssues,
  type JsonEnvelope,
  type ModuleStatisticsSnapshotV1,
  type RefactorAssessmentV1
} from "@archcontext/contracts";
import { CODEGRAPH_IMPORT_NODE_READ_LIMIT, CodeGraphAdapter, codeGraphCliInvocation } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { createStartedDaemon } from "../src/index";
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
  snapshot: ModuleStatisticsSnapshotV1;
  assessment: RefactorAssessmentV1;
  proposedRecommendations: unknown[];
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
