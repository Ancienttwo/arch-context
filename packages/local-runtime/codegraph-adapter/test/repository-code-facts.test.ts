import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodeGraphProviderUnavailableError,
  REQUIRED_CODEGRAPH_VERSION,
  assertRepositoryCodeFactsReady,
  inspectRepositoryCodeFacts
} from "../src/index";
import { CODE_FACTS_ISSUE_MESSAGES } from "@archcontext/contracts";
import { fakeReadProvider } from "./read-provider-fixture";

function withRoot<T>(run: (root: string) => T): T {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-codegraph-status-")));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("compatibility issues of an open index", () => {
  // Each row is one index fact away from a ready index, read through one read-only session.
  for (const [name, facts, codes] of [
    ["a loaded provider of another version", { version: "0.0.1" }, ["version-mismatch"]],
    ["an index built by another version", { builtWithVersion: "0.0.1" }, ["version-mismatch"]],
    ["an index with no build version", { builtWithVersion: null }, ["version-mismatch"]],
    ["an index of another project", { projectPath: "elsewhere" }, ["project-path-mismatch"]],
    ["an index whose project path does not resolve", { projectPath: "missing" }, ["project-path-mismatch"]],
    ["an index still building", { state: "building" }, ["index-incomplete"]],
    ["an index with no state", { state: null }, ["index-incomplete"]],
    ["an index with pending references", { pendingRefs: 3 }, ["index-incomplete"]],
    ["an index the provider would rebuild", { reindexRecommended: true }, ["index-incomplete"]],
    ["an index of an older extraction version", { builtWithExtractionVersion: 6 }, ["extraction-version-mismatch"]]
  ] as const) test(`${name} is not ready`, () => {
    withRoot((root) => {
      mkdirSync(join(root, "elsewhere"));
      const projectPath = "projectPath" in facts ? { projectPath: join(root, facts.projectPath) } : {};
      const inspected = inspectRepositoryCodeFacts(root, { provider: fakeReadProvider(root, { ...facts, ...projectPath }) });
      expect(inspected).toMatchObject({ state: "not-ready", issues: codes.map((code) => ({ code, message: CODE_FACTS_ISSUE_MESSAGES[code] })) });
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

  test("a read that fails during the open is index-open-failed and closes the handle", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, { readFails: true });
      expect(inspectRepositoryCodeFacts(root, { provider })).toMatchObject({ state: "unavailable", reasonCode: "index-open-failed" });
      expect(provider.calls).toMatchObject({ open: 1, close: 1 });
    });
  });

  test("a read that fails after the open is index-open-failed and still closes the handle", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, { readFailsAfterOpen: true });
      const facts = inspectRepositoryCodeFacts(root, { provider });
      expect(facts).toMatchObject({ state: "unavailable", reasonCode: "index-open-failed" });
      expect(JSON.stringify(facts)).not.toContain("private raw provider error");
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

  test("a .codegraph directory without a database is index-missing, as the snapshot path reports it", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root);
      rmSync(join(root, ".codegraph", "codegraph.db"));
      expect(inspectRepositoryCodeFacts(root, { provider })).toMatchObject({ state: "index-missing", indexPresent: false, issues: [] });
      expect(provider.calls.open).toBe(0);
      expect(() => assertRepositoryCodeFactsReady(root, { provider })).toThrow(expect.objectContaining({ code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "index-missing" }));
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
