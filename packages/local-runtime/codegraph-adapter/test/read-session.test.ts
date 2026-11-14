import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEGRAPH_PROVIDER_INTERNAL_EXPORTS,
  REQUIRED_CODEGRAPH_VERSION,
  assertRepositoryCodeFactsReady,
  inspectRepositoryCodeFacts,
  openCodeGraphReadSession,
  pinnedCodeGraphProvider,
  withCodeGraphReadSession,
  type CodeGraphReadProvider
} from "../src/index";
import { codeGraphBundle } from "../src/read-session";
import { withReadyCodeGraphIndex } from "../src/ready-index-read";
import { fakeReadProvider } from "./read-provider-fixture";
import { gitSpy } from "./git-spy";
import { indexCodeGraphFixture } from "./real-index";

function withRoot<T>(run: (root: string) => T): T {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-read-session-")));
  try { return run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("openCodeGraphReadSession", () => {
  test("no .codegraph is index-missing and opens nothing", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root);
      rmSync(join(root, ".codegraph"), { recursive: true });
      expect(openCodeGraphReadSession(root, { provider })).toEqual({ state: "index-missing" });
      expect(provider.calls.open).toBe(0);
    });
  });

  test("a .codegraph without a database is index-missing and opens nothing", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root);
      rmSync(join(root, ".codegraph", "codegraph.db"));
      expect(openCodeGraphReadSession(root, { provider })).toEqual({ state: "index-missing" });
      expect(provider.calls.open).toBe(0);
    });
  });

  test("a dangling .codegraph link is index-open-failed, not index-missing", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(join(root, "elsewhere"));
      symlinkSync(join(root, "absent"), join(root, ".codegraph"), "junction");
      expect(openCodeGraphReadSession(root, { provider })).toEqual({ state: "index-open-failed" });
      expect(provider.calls.open).toBe(0);
    });
  });

  test("a live build lock is build-in-progress and opens nothing", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root);
      writeFileSync(join(root, ".codegraph", "codegraph.lock"), String(process.pid));
      expect(openCodeGraphReadSession(root, { provider })).toEqual({ state: "build-in-progress" });
      expect(provider.calls.open).toBe(0);
    });
  });

  test("a linked .codegraph is index-open-failed and opens nothing", () => {
    withRoot((root) => {
      withRoot((other) => {
        const provider = fakeReadProvider(other);
        symlinkSync(join(other, ".codegraph"), join(root, ".codegraph"), "junction");
        expect(openCodeGraphReadSession(root, { provider })).toEqual({ state: "index-open-failed" });
        expect(provider.calls.open).toBe(0);
      });
    });
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("an unreadable .codegraph or database is index-open-failed, not index-missing", () => {
    withRoot((root) => {
      const project = join(root, "project");
      const provider = fakeReadProvider(project);
      const indexDir = join(project, ".codegraph");
      try {
        // The database check: .codegraph exists, but codegraph.db cannot be stat'ed.
        chmodSync(indexDir, 0o000);
        expect(openCodeGraphReadSession(project, { provider })).toEqual({ state: "index-open-failed" });
        chmodSync(indexDir, 0o755);
        // The .codegraph check: the project directory cannot be searched.
        chmodSync(project, 0o000);
        expect(openCodeGraphReadSession(project, { provider })).toEqual({ state: "index-open-failed" });
      } finally {
        chmodSync(project, 0o755);
        chmodSync(indexDir, 0o755);
      }
      expect(provider.calls.open).toBe(0);
    });
  });

  test("a read-only open that throws is index-open-failed", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, { openFails: true });
      expect(openCodeGraphReadSession(root, { provider })).toEqual({ state: "index-open-failed" });
      expect(provider.calls.open).toBe(1);
    });
  });

  test("compatibility() and revision() report the handle's facts and the loaded version", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, { version: "9.9.9", builtWithVersion: null, builtWithExtractionVersion: 6, currentExtractionVersion: 7, state: null, pendingRefs: 2, reindexRecommended: true, lastIndexedAt: null });
      withCodeGraphReadSession(root, (opened) => {
        if (opened.state !== "open") throw new Error(opened.state);
        expect(opened.session.version()).toBe("9.9.9");
        expect(opened.session.compatibility()).toEqual({
          version: "9.9.9", projectPath: root, lastIndexed: null, builtWithVersion: null,
          builtWithExtractionVersion: 6, currentExtractionVersion: 7, reindexRecommended: true, state: null, pendingRefs: 2
        });
        expect(opened.session.revision()).toEqual({ lastIndexedAt: Date.UTC(2026, 0, 1), fileCount: 1 });
      }, { provider });
    });
  });

  test("a revision that moves between reads is not one index state: not ready, retryable, never a pass (G4)", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, { revisionMoves: true });
      withCodeGraphReadSession(root, (opened) => {
        if (opened.state !== "open") throw new Error(opened.state);
        opened.session.compatibility();
        expect(opened.session.unchangedSinceOpen()).toBe(false);
      }, { provider });
      expect(inspectRepositoryCodeFacts(root, { provider })).toMatchObject({
        state: "not-ready", indexState: null, pendingChanges: null, issues: [{ code: "index-incomplete" }]
      });
      expect(() => assertRepositoryCodeFactsReady(root, { provider })).toThrow(expect.objectContaining({
        code: "AC_CODE_FACTS_NOT_READY", reasonCode: "code-facts-not-ready", retryable: true
      }));
      expect(provider.calls.open).toBe(provider.calls.close);
      // A moving index whose provider also has the wrong version cannot be fixed by a retry.
      const mismatched = fakeReadProvider(root, { revisionMoves: true, version: "0.0.1" });
      expect(() => assertRepositoryCodeFactsReady(root, { provider: mismatched })).toThrow(expect.objectContaining({
        code: "AC_CODE_FACTS_NOT_READY", action: "install-compatible-codegraph", retryable: false
      }));
    });
  });

  test("freshness() is CodeGraph's change test, computed once per session", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root, { pending: { added: 2, modified: 1, removed: 3 } });
      withCodeGraphReadSession(root, (opened) => {
        if (opened.state !== "open") throw new Error(opened.state);
        expect(opened.session.freshness()).toEqual({ added: 2, modified: 1, removed: 3 });
        expect(opened.session.freshness()).toEqual({ added: 2, modified: 1, removed: 3 });
      }, { provider });
      expect(provider.calls.scan).toBe(1);
      // Only files in both the index and the enumeration are hashed: fresh.ts and the modified one.
      expect(provider.calls.hash).toBe(2);
    });
  });

  test("a source that cannot be read is not attested: it counts as modified", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root);
      const unreadable = { ...provider, changeHash: () => { throw new Error("EACCES"); } };
      withCodeGraphReadSession(root, (opened) => {
        if (opened.state !== "open") throw new Error(opened.state);
        expect(opened.session.freshness()).toEqual({ added: 0, modified: 1, removed: 0 });
      }, { provider: unreadable });
    });
  });

  test("the session closes when the read returns and when it throws, and refuses use after close", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root);
      let kept: ReturnType<typeof openCodeGraphReadSession> | undefined;
      withCodeGraphReadSession(root, (opened) => { kept = opened; }, { provider });
      expect(provider.calls.close).toBe(1);
      if (kept?.state !== "open") throw new Error("not open");
      const session = kept.session;
      expect(() => session.compatibility()).toThrow("closed");
      expect(() => session.graph).toThrow("closed");
      session.close();
      expect(provider.calls.close).toBe(1);
      expect(() => withCodeGraphReadSession(root, () => { throw new Error("read failed"); }, { provider })).toThrow("read failed");
      expect(provider.calls.close).toBe(2);
    });
  });
});

describe("pinned provider bump guard (ADR-0058 Decision 7)", () => {
  const types: Record<string, "function" | "number"> = {
    scanDirectory: "function", hashContent: "function", readBoundedSourceSync: "function", oversizeStamp: "function", EXTRACTION_VERSION: "number"
  };

  test("the provider-internal modules and exports are exactly the pinned table", () => {
    expect(CODEGRAPH_PROVIDER_INTERNAL_EXPORTS).toEqual({
      "extraction/index.js": ["scanDirectory", "hashContent"],
      "file-limits.js": ["readBoundedSourceSync", "oversizeStamp"],
      "extraction/extraction-version.js": ["EXTRACTION_VERSION"]
    });
  });

  test("the pinned bundle ships every listed module path and export", () => {
    const { dist } = codeGraphBundle();
    const load = createRequire(import.meta.url);
    for (const [module, names] of Object.entries(CODEGRAPH_PROVIDER_INTERNAL_EXPORTS)) {
      const loaded = load(join(dist, module)) as Record<string, unknown>;
      for (const name of names) expect({ module, name, type: typeof loaded[name] }).toEqual({ module, name, type: types[name] });
    }
  });

  test("the loaded bundle is the pinned version", () => {
    const provider = pinnedCodeGraphProvider();
    expect(provider.version).toBe(REQUIRED_CODEGRAPH_VERSION);
    expect(Number.isInteger(provider.extractionVersion)).toBe(true);
  });
});

/**
 * A real index read in this process through the pinned provider: no holder process, so the open
 * also proves the read-only open works after the writer removed its sidecars.
 */
describe("read session over a real index", () => {
  let root = "";
  const oversize = "src/big.ts";

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-read-session-real-")));
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), ".codegraph/\n");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/a.ts"), 'import { b } from "./b";\nexport function a() { return b(); }\n');
    writeFileSync(join(root, "src/b.ts"), "export function b() { return 1; }\n");
    // Above CodeGraph's source size limit: the index keeps a size stamp, not a text hash.
    writeFileSync(join(root, oversize), `export const big = "${"x".repeat(1024 * 1024 + 16)}";\n`);
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", `core.hooksPath=${join(root, ".git/no-hooks")}`, "commit", "-qm", "fixture"], { cwd: root });
    indexCodeGraphFixture(root);
  }, 120_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

  test("a fresh index is ready; the read changes neither the database nor .git/index, and runs no git status or diff", () => {
    const gitIndex = join(root, ".git", "index");
    const database = join(root, ".codegraph", "codegraph.db");
    const before = { gitIndex: statSync(gitIndex).mtimeMs, database: digest(database) };
    const spy = process.platform === "win32" ? undefined : gitSpy();
    let commands: string[] = [];
    // The read is in-process, so the spy goes on this process's PATH for its duration.
    const path = process.env.PATH;
    if (spy) process.env.PATH = spy.env.PATH;
    try {
      expect(inspectRepositoryCodeFacts(root)).toMatchObject({
        state: "ready", codeGraphVersion: REQUIRED_CODEGRAPH_VERSION, indexBuiltWithVersion: REQUIRED_CODEGRAPH_VERSION,
        pendingChanges: { added: 0, modified: 0, removed: 0 }, issues: []
      });
      expect(() => assertRepositoryCodeFactsReady(root)).not.toThrow();
      commands = spy?.subcommands() ?? [];
    } finally {
      process.env.PATH = path;
      spy?.restore();
    }
    if (spy) {
      // The spy saw the provider enumeration, so an absent status or diff is a real absence.
      expect(commands.some(command => command.startsWith("ls-files"))).toBe(true);
      expect(commands.filter(command => /^(status|diff)\b/.test(command))).toEqual([]);
    }
    expect({ gitIndex: statSync(gitIndex).mtimeMs, database: digest(database) }).toEqual(before);
  });

  test("the oversize file is indexed as a stamp and reads as fresh", () => {
    withCodeGraphReadSession(root, (opened) => {
      if (opened.state !== "open") throw new Error(opened.state);
      expect(opened.session.graph.getFile(oversize)).not.toBeNull();
      expect(opened.session.freshness()).toEqual({ added: 0, modified: 0, removed: 0 });
    });
  });

  test("an edit, a new source and a deletion are counted; the gate still passes", () => {
    const edited = join(root, "src/a.ts");
    const removed = join(root, "src/b.ts");
    const added = join(root, "src/c.ts");
    const originals = { edited: readFileSync(edited), removed: readFileSync(removed) };
    try {
      writeFileSync(edited, "export function a() { return 2; }\n");
      unlinkSync(removed);
      writeFileSync(added, "export const c = 3;\n");
      expect(inspectRepositoryCodeFacts(root)).toMatchObject({
        state: "not-ready", pendingChanges: { added: 1, modified: 1, removed: 1 },
        issues: [{ code: "pending-source-changes" }]
      });
      expect(() => assertRepositoryCodeFactsReady(root)).not.toThrow();
    } finally {
      writeFileSync(edited, originals.edited);
      writeFileSync(removed, originals.removed);
      rmSync(added, { force: true });
    }
    expect(inspectRepositoryCodeFacts(root)).toMatchObject({ state: "ready" });
  });
});

describe("withReadyCodeGraphIndex: readiness and the read on one session", () => {
  test("a ready read opens one handle, queries it, and closes it", () => {
    withRoot((root) => {
      const provider = fakeReadProvider(root);
      let atRead: number[] = [];
      expect(withReadyCodeGraphIndex(root, (graph) => {
        atRead = [provider.calls.open, provider.calls.close];
        return graph.getProjectRoot();
      }, { provider })).toBe(root);
      expect(atRead).toEqual([1, 0]);
      expect([provider.calls.open, provider.calls.close]).toEqual([1, 1]);
    });
  });

  const notReady = (retryable: boolean) => ({ code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "code-facts-read-not-ready", retryable });
  // A revision read after readiness that differs from the one at open, as a sync committing mid-query.
  const movesDuringQuery = (root: string) => {
    const base = fakeReadProvider(root);
    let queried = false;
    const provider: CodeGraphReadProvider = {
      get version() { return base.version; },
      get extractionVersion() { return base.extractionVersion; },
      openReadOnly: (openedRoot) => {
        const graph = base.openReadOnly(openedRoot);
        const revision = graph.getIndexRevision.bind(graph);
        return Object.assign(graph, { getIndexRevision: () => ({ ...revision(), fileCount: queried ? 99 : 1 }) });
      },
      scanSourceFiles: (scanRoot) => base.scanSourceFiles(scanRoot),
      changeHash: (path) => base.changeHash(path)
    };
    return { provider, calls: base.calls, during: () => { queried = true; } };
  };
  const lockDuringQuery = (root: string) => {
    const provider = fakeReadProvider(root);
    return { provider, calls: provider.calls, during: () => writeFileSync(join(root, ".codegraph", "codegraph.lock"), String(process.pid)) };
  };
  const refusing = (facts: Parameters<typeof fakeReadProvider>[1], before?: (root: string) => void) => (root: string) => {
    const provider = fakeReadProvider(root, facts);
    before?.(root);
    return { provider, calls: provider.calls, during: () => {} };
  };
  const failingRead = (root: string) => {
    const provider = fakeReadProvider(root);
    return { provider, calls: provider.calls, during: () => { throw new Error("private raw provider error /outside/repository"); } };
  };

  test.each([
    ["pending source changes", refusing({ pending: { added: 1, modified: 0, removed: 0 } }), notReady(false), false, 1],
    ["a revision that moves before the query", refusing({ revisionMoves: true }), notReady(true), false, 1],
    ["a moving index of the wrong provider version", refusing({ revisionMoves: true, version: "0.0.1" }), notReady(false), false, 1],
    ["a live build at open", refusing({}, root => writeFileSync(join(root, ".codegraph", "codegraph.lock"), String(process.pid))), notReady(true), false, 0],
    ["an index whose readiness reads fail", refusing({ readFailsAfterOpen: true }), { reasonCode: "index-open-failed" }, false, 1],
    ["a revision that moves during the query", movesDuringQuery, notReady(true), true, 1],
    ["a writer lock that appears during the query", lockDuringQuery, notReady(true), true, 1],
    ["a query that throws a non-FailureError", failingRead, { code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "code-facts-unavailable" }, true, 1]
  ] as const)("%s is refused, and the handle is closed", (_name, setup, error, queried, opens) => {
    withRoot((root) => {
      const { provider, calls, during } = setup(root);
      let ran = false;
      expect(() => withReadyCodeGraphIndex(root, () => { ran = true; during(); return true; }, { provider })).toThrow(expect.objectContaining(error));
      expect(ran).toBe(queried);
      expect([calls.open, calls.close]).toEqual([opens, opens]);
    });
  });
});

test("a ready read sees includeIgnored, include and extension sources; a new source under includeIgnored makes it not ready", () => {
  withRoot((root) => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), ".codegraph/\nexternal-projects/\nprivate-src/\n");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/main.ts"), "export const MAIN_VERSION = 1;\n");
    mkdirSync(join(root, "external-projects/embedded"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: join(root, "external-projects/embedded") });
    writeFileSync(join(root, "external-projects/embedded/library.ts"), "export function optedInLibrary() { return 1; }\n");
    mkdirSync(join(root, "private-src"));
    writeFileSync(join(root, "private-src/source.fixture"), "export function customExtension() { return 1; }\n");
    writeFileSync(join(root, "codegraph.json"), JSON.stringify({
      includeIgnored: ["external-projects/"], include: ["private-src/**"], extensions: { ".fixture": "typescript" }
    }));
    indexCodeGraphFixture(root);
    const names = ["MAIN_VERSION", "optedInLibrary", "customExtension"];
    expect(withReadyCodeGraphIndex(root, graph => names.map(name => graph.getNodesByName(name).length))).toEqual([1, 1, 1]);
    writeFileSync(join(root, "external-projects/embedded/new.ts"), "export const newIgnoredSource = 1;\n");
    expect(() => withReadyCodeGraphIndex(root, () => true)).toThrow(expect.objectContaining({
      reasonCode: "code-facts-read-not-ready", details: { issues: [expect.objectContaining({ code: "pending-source-changes" })] }
    }));
  });
}, 120_000);
