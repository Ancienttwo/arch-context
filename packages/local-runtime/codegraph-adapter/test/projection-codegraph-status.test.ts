import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REQUIRED_CODEGRAPH_VERSION,
  inspectRepositoryCodeFacts,
  projectionCodeGraphStatusIssues,
  type CodeGraphProjectionStatusV1
} from "../src/index";

function freshStatus(root: string, overrides: Partial<CodeGraphProjectionStatusV1> = {}): CodeGraphProjectionStatusV1 {
  return {
    initialized: true,
    version: REQUIRED_CODEGRAPH_VERSION,
    projectPath: root,
    lastIndexed: "2026-01-01T00:00:00.000Z",
    pendingChanges: { added: 0, modified: 0, removed: 0 },
    worktreeMismatch: null,
    index: {
      builtWithVersion: REQUIRED_CODEGRAPH_VERSION,
      builtWithExtractionVersion: 7,
      currentExtractionVersion: 7,
      reindexRecommended: false,
      state: "complete",
      pendingRefs: 0
    },
    ...overrides
  };
}

function withRoot<T>(run: (root: string) => T): T {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-codegraph-status-")));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("projectionCodeGraphStatusIssues", () => {
  test("a fresh complete index has no issues", () => {
    withRoot((root) => {
      expect(projectionCodeGraphStatusIssues(freshStatus(root), root, "pre-sync")).toEqual([]);
    });
  });

  test("an uninitialized index returns only that issue, with the phase in the message", () => {
    withRoot((root) => {
      expect(projectionCodeGraphStatusIssues(freshStatus(root, { initialized: false }), root, "pre-sync")).toEqual([
        { code: "not-initialized", message: "CodeGraph pre-sync status is not initialized" }
      ]);
    });
  });

  test("version mismatch is reported for the tool and for the index build", () => {
    withRoot((root) => {
      expect(projectionCodeGraphStatusIssues(freshStatus(root, { version: "0.0.1" }), root, "post-sync"))
        .toEqual([{ code: "version-mismatch", message: "CodeGraph post-sync status version mismatch" }]);
      const status = freshStatus(root);
      status.index = { ...status.index, builtWithVersion: "0.0.1" };
      expect(projectionCodeGraphStatusIssues(status, root, "post-sync").map((issue) => issue.code)).toEqual(["version-mismatch"]);
    });
  });

  test("project path mismatch and an unresolvable project path are issues", () => {
    withRoot((root) => {
      withRoot((other) => {
        expect(projectionCodeGraphStatusIssues(freshStatus(root, { projectPath: other }), root, "pre-sync").map((issue) => issue.code))
          .toEqual(["project-path-mismatch"]);
      });
      expect(projectionCodeGraphStatusIssues(freshStatus(root, { projectPath: join(root, "missing") }), root, "pre-sync").map((issue) => issue.code))
        .toEqual(["project-path-mismatch"]);
    });
  });

  test("an incomplete, pending-ref or reindex-recommended index is not complete and compatible", () => {
    withRoot((root) => {
      for (const index of [
        { state: "building" },
        { pendingRefs: 3 },
        { reindexRecommended: true }
      ]) {
        const status = freshStatus(root);
        status.index = { ...status.index, ...index };
        expect(projectionCodeGraphStatusIssues(status, root, "post-query")).toEqual([
          { code: "index-incomplete", message: "CodeGraph post-query index is not complete and compatible" }
        ]);
      }
      expect(projectionCodeGraphStatusIssues(freshStatus(root, { index: undefined }), root, "post-query").map((issue) => issue.code))
        .toEqual(["version-mismatch", "index-incomplete"]);
    });
  });

  test("an extraction version that differs from the current one is stale", () => {
    withRoot((root) => {
      const status = freshStatus(root);
      status.index = { ...status.index, builtWithExtractionVersion: 6 };
      expect(projectionCodeGraphStatusIssues(status, root, "pre-sync")).toEqual([
        { code: "extraction-version-mismatch", message: "CodeGraph pre-sync extraction version mismatch" }
      ]);
    });
  });

  test("a worktree mismatch is an issue and an absent field is not silently fresh", () => {
    withRoot((root) => {
      expect(projectionCodeGraphStatusIssues(freshStatus(root, { worktreeMismatch: { expected: "a" } }), root, "pre-sync"))
        .toEqual([{ code: "worktree-mismatch", message: "CodeGraph pre-sync worktree mismatch" }]);
      const absent = freshStatus(root);
      delete (absent as { worktreeMismatch?: unknown }).worktreeMismatch;
      expect(projectionCodeGraphStatusIssues(absent, root, "pre-sync").map((issue) => issue.code)).toEqual(["worktree-mismatch"]);
    });
  });
});

describe("inspectRepositoryCodeFacts", () => {
  function fakeCodeGraph(root: string, options: { version?: string; status?: unknown; statusExit?: number; recordTo?: string }): string {
    const path = join(root, "fake-codegraph.js");
    writeFileSync(path, [
      `const { appendFileSync } = require("node:fs");`,
      `const args = process.argv.slice(2);`,
      options.recordTo ? `appendFileSync(${JSON.stringify(options.recordTo)}, args[0] + "\\n");` : "",
      `if (args[0] === "--version") { console.log(${JSON.stringify(options.version ?? REQUIRED_CODEGRAPH_VERSION)}); process.exit(0); }`,
      `if (args[0] === "status") { ${options.statusExit ? `console.error("boom"); process.exit(${options.statusExit});` : `console.log(JSON.stringify(${JSON.stringify(options.status)})); process.exit(0);`} }`,
      `process.exit(9);`
    ].join("\n"), "utf8");
    return path;
  }

  test("reports an unavailable CodeGraph without throwing or inventing values", () => {
    withRoot((root) => {
      const facts = inspectRepositoryCodeFacts(root, { binary: join(root, "does-not-exist") });
      expect(facts.state).toBe("unavailable");
      expect(facts).toMatchObject({ schemaVersion: "archcontext.repository-code-facts/v1", reasonCode: "codegraph-unavailable", requiredVersion: REQUIRED_CODEGRAPH_VERSION });
      expect("indexPresent" in facts).toBe(false);
      expect("codeGraphVersion" in facts).toBe(false);
    });
  });

  test("reports a missing index from --version alone and never calls status or sync", () => {
    withRoot((root) => {
      const log = join(root, "calls.log");
      const binary = fakeCodeGraph(root, { recordTo: log });
      const facts = inspectRepositoryCodeFacts(root, { binary });
      expect(facts).toMatchObject({ state: "index-missing", indexPresent: false, codeGraphVersion: REQUIRED_CODEGRAPH_VERSION, issues: [] });
      expect(require("node:fs").readFileSync(log, "utf8")).toBe("--version\n");
    });
  });

  test("reports a ready index and calls only --version and status", () => {
    withRoot((root) => {
      mkdirSync(join(root, ".codegraph"));
      const log = join(root, "calls.log");
      const binary = fakeCodeGraph(root, { status: freshStatus(root), recordTo: log });
      const facts = inspectRepositoryCodeFacts(root, { binary });
      expect(facts).toMatchObject({
        state: "ready",
        indexPresent: true,
        codeGraphVersion: REQUIRED_CODEGRAPH_VERSION,
        extractionVersion: { builtWith: 7, current: 7 },
        pendingChanges: { added: 0, modified: 0, removed: 0 },
        issues: []
      });
      expect(require("node:fs").readFileSync(log, "utf8")).toBe("--version\nstatus\n");
    });
  });

  test("reports stale extraction and pending source changes as issues", () => {
    withRoot((root) => {
      mkdirSync(join(root, ".codegraph"));
      const status = freshStatus(root, { pendingChanges: { added: 1, modified: 2, removed: 0 } });
      status.index = { ...status.index, builtWithExtractionVersion: 6 };
      const facts = inspectRepositoryCodeFacts(root, { binary: fakeCodeGraph(root, { status }) });
      expect(facts).toMatchObject({
        state: "not-ready",
        extractionVersion: { builtWith: 6, current: 7 },
        pendingChanges: { added: 1, modified: 2, removed: 0 }
      });
      expect("issues" in facts && facts.issues.map((issue) => issue.code)).toEqual(["extraction-version-mismatch", "pending-source-changes"]);
    });
  });

  test("a binary of another version is a version-mismatch issue", () => {
    withRoot((root) => {
      const facts = inspectRepositoryCodeFacts(root, { binary: fakeCodeGraph(root, { version: "0.0.1" }) });
      expect(facts).toMatchObject({ state: "index-missing", codeGraphVersion: "0.0.1" });
      expect("issues" in facts && facts.issues.map((issue) => issue.code)).toEqual(["version-mismatch"]);
    });
  });

  test("a failing or invalid status is unavailable", () => {
    withRoot((root) => {
      mkdirSync(join(root, ".codegraph"));
      expect(inspectRepositoryCodeFacts(root, { binary: fakeCodeGraph(root, { statusExit: 3 }) }).state).toBe("unavailable");
    });
  });

  test("an existing index whose status JSON is not an object is unavailable, not index-missing", () => {
    withRoot((root) => {
      mkdirSync(join(root, ".codegraph"));
      const facts = inspectRepositoryCodeFacts(root, { binary: fakeCodeGraph(root, { status: null }) });
      expect(facts).toMatchObject({ state: "unavailable", reasonCode: "codegraph-unavailable", requiredVersion: REQUIRED_CODEGRAPH_VERSION });
      expect("indexPresent" in facts).toBe(false);
    });
  });
});
