import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodeGraphProviderUnavailableError,
  REQUIRED_CODEGRAPH_VERSION,
  assertRepositoryCodeFactsReady,
  inspectRepositoryCodeFacts,
  projectionCodeGraphStatusIssues,
  type CodeGraphProjectionStatusV1
} from "../src/index";
import { fakeReadProvider } from "./read-provider-fixture";

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
  test("reports a provider that cannot load as unavailable without inventing values", () => {
    withRoot((root) => {
      const provider = new Proxy(fakeReadProvider(root), { get: (target, key) => {
        if (key === "version") throw new CodeGraphProviderUnavailableError("CodeGraph platform manifest is unreadable");
        return Reflect.get(target, key);
      } });
      const facts = inspectRepositoryCodeFacts(root, { provider });
      expect(facts).toEqual({
        schemaVersion: "archcontext.repository-code-facts/v1", state: "unavailable", requiredVersion: REQUIRED_CODEGRAPH_VERSION,
        reasonCode: "codegraph-unavailable", message: "CodeGraph platform manifest is unreadable"
      });
      expect(() => assertRepositoryCodeFactsReady(root, { provider })).toThrow(expect.objectContaining({ code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "code-facts-unavailable", action: "inspect-diagnostics" }));
    });
  });

  test("reports a missing index from the provider version alone and opens nothing", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root);
      rmSync(join(root, ".codegraph"), { recursive: true });
      expect(inspectRepositoryCodeFacts(root, { provider })).toEqual({
        schemaVersion: "archcontext.repository-code-facts/v1", state: "index-missing", indexPresent: false,
        requiredVersion: REQUIRED_CODEGRAPH_VERSION, codeGraphVersion: REQUIRED_CODEGRAPH_VERSION, issues: []
      });
      expect(provider.calls.open).toBe(0);
      expect(() => assertRepositoryCodeFactsReady(root, { provider })).toThrow(expect.objectContaining({ code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "index-missing" }));
    });
  });

  test("reports a ready index from one read-only session and closes it", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root);
      expect(inspectRepositoryCodeFacts(root, { provider })).toEqual({
        schemaVersion: "archcontext.repository-code-facts/v1",
        state: "ready",
        indexPresent: true,
        requiredVersion: REQUIRED_CODEGRAPH_VERSION,
        codeGraphVersion: REQUIRED_CODEGRAPH_VERSION,
        indexBuiltWithVersion: REQUIRED_CODEGRAPH_VERSION,
        extractionVersion: { builtWith: 7, current: 7 },
        indexState: "complete",
        reindexRecommended: false,
        pendingRefs: 0,
        pendingChanges: { added: 0, modified: 0, removed: 0 },
        issues: []
      });
      expect(provider.calls).toMatchObject({ open: 1, close: 1, scan: 1 });
    });
  });

  test("an open that fails is index-open-failed, and the gate refuses it with the C2 reason", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, { openFails: true });
      const facts = inspectRepositoryCodeFacts(root, { provider });
      expect(facts).toMatchObject({ state: "unavailable", reasonCode: "index-open-failed" });
      expect(JSON.stringify(facts)).not.toContain("private raw provider error");
      expect(() => assertRepositoryCodeFactsReady(root, { provider })).toThrow(expect.objectContaining({
        code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "index-open-failed", action: "inspect-diagnostics", retryable: false
      }));
    });
  });

  test("a read that fails after the open is index-open-failed and still closes the handle", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, { readFails: true });
      expect(inspectRepositoryCodeFacts(root, { provider })).toMatchObject({ state: "unavailable", reasonCode: "index-open-failed" });
      expect(provider.calls).toMatchObject({ open: 1, close: 1 });
    });
  });

  test("a symbolic-link .codegraph is index-open-failed without an open", () => {
    withRoot((root) => {
      withRoot((other) => {
        const provider = fakeReadProvider(other);
        symlinkSync(join(other, ".codegraph"), join(root, ".codegraph"), "junction");
        expect(inspectRepositoryCodeFacts(root, { provider })).toMatchObject({ state: "unavailable", reasonCode: "index-open-failed" });
        expect(provider.calls.open).toBe(0);
      });
    });
  });

  test("a .codegraph directory without a database is not initialized", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root);
      rmSync(join(root, ".codegraph", "codegraph.db"));
      const facts = inspectRepositoryCodeFacts(root, { provider });
      expect(facts).toMatchObject({ state: "not-ready", indexPresent: true, pendingChanges: null });
      expect("issues" in facts && facts.issues.map(issue => issue.code)).toEqual(["not-initialized", "pending-source-changes"]);
      expect(provider.calls.open).toBe(0);
      expect(() => assertRepositoryCodeFactsReady(root, { provider })).toThrow(expect.objectContaining({ code: "AC_CODE_FACTS_NOT_READY" }));
    });
  });

  test.each([
    ["bundle version", { version: "0.0.1" }, ["version-mismatch"], "install-compatible-codegraph"],
    ["index build version", { builtWithVersion: "1.6.1" }, ["version-mismatch"], "codegraph-index"],
    ["unknown build version", { builtWithVersion: null }, ["version-mismatch"], "codegraph-index"],
    ["partial index", { state: "partial" }, ["index-incomplete"], "codegraph-index"],
    ["pending references", { pendingRefs: 3 }, ["index-incomplete"], "codegraph-index"],
    ["stale extraction", { builtWithExtractionVersion: 6 }, ["extraction-version-mismatch"], "codegraph-index"],
    ["another project root", { projectPath: "/elsewhere/repository" }, ["project-path-mismatch"], "codegraph-index"]
  ] as const)("an incompatible index (%s) is not ready, and the gate refuses it", (_name, facts, codes, action) => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, facts);
      const inspected = inspectRepositoryCodeFacts(root, { provider });
      expect(inspected).toMatchObject({ state: "not-ready", reindexRecommended: true });
      expect("issues" in inspected && inspected.issues.map(issue => issue.code)).toEqual([...codes]);
      expect(() => assertRepositoryCodeFactsReady(root, { provider })).toThrow(expect.objectContaining({
        code: "AC_CODE_FACTS_NOT_READY", reasonCode: "code-facts-not-ready", action, details: { issues: "issues" in inspected ? inspected.issues : [] }
      }));
    });
  });

  test("pending source changes make the doctor not ready, while the gate reads compatibility only and passes", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, { pending: { added: 1, modified: 2, removed: 3 } });
      const facts = inspectRepositoryCodeFacts(root, { provider });
      expect(facts).toMatchObject({ state: "not-ready", reindexRecommended: false, pendingChanges: { added: 1, modified: 2, removed: 3 } });
      expect("issues" in facts && facts.issues.map(issue => issue.code)).toEqual(["pending-source-changes"]);
      const scans = provider.calls.scan;
      const hashes = provider.calls.hash;
      expect(() => assertRepositoryCodeFactsReady(root, { provider })).not.toThrow();
      // The gate reads no source file: no enumeration, no hash.
      expect(provider.calls.scan).toBe(scans);
      expect(provider.calls.hash).toBe(hashes);
    });
  });

  test("issue messages are the closed vocabulary, never provider output", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, { version: "/private/version-output token=secret" });
      const facts = inspectRepositoryCodeFacts(root, { provider });
      expect("issues" in facts && facts.issues).toEqual([{ code: "version-mismatch", message: "CodeGraph repository status version mismatch" }]);
    });
  });
});
