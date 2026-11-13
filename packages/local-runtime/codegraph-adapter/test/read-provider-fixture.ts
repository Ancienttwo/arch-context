import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeGraphReadProvider } from "../src/index";
import { REQUIRED_CODEGRAPH_VERSION } from "../src/index";

/** What the injected index reports. Every field defaults to a ready, fresh index of `root`. */
export interface FakeIndexFacts {
  /** Version of the provider bundle "loaded" by this process. */
  version?: string;
  builtWithVersion?: string | null;
  builtWithExtractionVersion?: number | null;
  currentExtractionVersion?: number;
  state?: string | null;
  reindexRecommended?: boolean;
  pendingRefs?: number;
  /** Project root the handle reports; `root` when omitted. */
  projectPath?: string;
  lastIndexedAt?: number | null;
  /** Pending source changes the provider's change test finds. */
  pending?: { added: number; modified: number; removed: number };
  /** The read-only open throws. */
  openFails?: boolean;
  /** Every read on the opened handle throws, including the revision read during the open. */
  readFails?: boolean;
  /** Only reads after the open throw: the build info, which `compatibility()` reads first. */
  readFailsAfterOpen?: boolean;
  /** Each revision read reports a later index, as a sync that commits during the session would. */
  revisionMoves?: boolean;
}

export interface FakeReadProvider extends CodeGraphReadProvider {
  /** Counters of what the session asked the provider and the handle for. */
  readonly calls: { open: number; close: number; scan: number; hash: number };
}

/**
 * A provider whose read-only handle answers from `facts`, read anew on every open, so a test can
 * change the index between reads. Creates `.codegraph/codegraph.db` so the session opens it.
 */
export function fakeReadProvider(root: string, facts: FakeIndexFacts | (() => FakeIndexFacts) = {}): FakeReadProvider {
  mkdirSync(join(root, ".codegraph", "fake-sources"), { recursive: true });
  writeFileSync(join(root, ".codegraph", "codegraph.db"), "");
  // As in a real index directory, Git ignores everything in it, so the fake sources below never
  // enter the Git-visible files or a worktree digest.
  writeFileSync(join(root, ".codegraph", ".gitignore"), "*\n");
  const current = () => typeof facts === "function" ? facts() : facts;
  const calls = { open: 0, close: 0, scan: 0, hash: 0 };
  const extractionVersion = () => current().currentExtractionVersion ?? 7;
  // The pending counts become files: `m*` indexed and changed, `r*` indexed and gone, `a*` new.
  const population = () => {
    const pending = current().pending ?? { added: 0, modified: 0, removed: 0 };
    const name = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `.codegraph/fake-sources/${prefix}${index}.ts`);
    return { fresh: [".codegraph/fake-sources/fresh.ts"], modified: name("m", pending.modified), removed: name("r", pending.removed), added: name("a", pending.added) };
  };
  // The worktree holds what the enumeration lists; removed files are gone from both.
  const materialize = () => {
    const files = population();
    for (const path of [...files.fresh, ...files.modified, ...files.added]) writeFileSync(join(root, path), `// ${path}\n`);
    for (const path of files.removed) rmSync(join(root, path), { force: true });
    return files;
  };
  materialize();
  return {
    calls,
    get version() { return current().version ?? REQUIRED_CODEGRAPH_VERSION; },
    get extractionVersion() { return extractionVersion(); },
    openReadOnly: (openedRoot) => {
      calls.open++;
      const value = current();
      if (value.openFails) throw new Error("private raw provider error /outside/repository");
      const read = <T>(answer: () => T): T => {
        if (value.readFails) throw new Error("private raw provider error /outside/repository");
        return answer();
      };
      const files = population();
      let revisions = 0;
      return {
        getIndexBuildInfo: () => read(() => {
          if (value.readFailsAfterOpen) throw new Error("private raw provider error /outside/repository");
          return {
          version: value.builtWithVersion === undefined ? REQUIRED_CODEGRAPH_VERSION : value.builtWithVersion,
          extractionVersion: value.builtWithExtractionVersion === undefined ? extractionVersion() : value.builtWithExtractionVersion
          };
        }),
        getLastIndexedAt: () => read(() => value.lastIndexedAt === undefined ? Date.UTC(2026, 0, 1) : value.lastIndexedAt),
        getProjectRoot: () => read(() => value.projectPath ?? openedRoot),
        isIndexStale: () => read(() => value.reindexRecommended ?? false),
        getIndexState: () => read(() => value.state === undefined ? "complete" : value.state),
        getPendingReferenceCount: () => read(() => value.pendingRefs ?? 0),
        getIndexRevision: () => read(() => ({
          lastIndexedAt: Date.UTC(2026, 0, 1) + (value.revisionMoves ? revisions++ : 0),
          fileCount: files.fresh.length + files.modified.length + files.removed.length
        })),
        getFiles: () => read(() => [...files.fresh, ...files.modified, ...files.removed].map(path => ({ path, contentHash: `hash:${path}` }))),
        close: () => { calls.close++; }
      } as unknown as ReturnType<CodeGraphReadProvider["openReadOnly"]>;
    },
    scanSourceFiles: () => {
      calls.scan++;
      const files = materialize();
      return [...files.fresh, ...files.modified, ...files.added];
    },
    changeHash: (path) => {
      calls.hash++;
      const relative = path.slice(root.length + 1).replaceAll("\\", "/");
      return population().modified.includes(relative) ? "hash:changed" : `hash:${relative}`;
    }
  };
}
