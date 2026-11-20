import { constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { disableCodeGraphTelemetryByDefault } from "./cli-invocation";
import { codeGraphBundle, codeGraphIndexBuildInProgress, codeGraphIndexIdentity, isolatedCodeGraphReadSession, pinnedCodeGraphProvider, type CodeGraphIndexHandle, type CodeGraphReadProvider, type CodeGraphReadSessionOpenV1 } from "./read-session";

/** The SDK may create a WAL, SHM and .gitignore even on a read-only open. Keep them outside the workspace. */
export function withWorkspaceReadOnlyCodeGraph<T>(root: string, read: (opened: CodeGraphReadSessionOpenV1) => T, readProvider?: CodeGraphReadProvider): T {
  const opened = openWorkspaceReadOnlyCodeGraph(root, readProvider);
  try { return read(opened.result); }
  finally { opened.close?.(); }
}

function openWorkspaceReadOnlyCodeGraph(root: string, readProvider?: CodeGraphReadProvider): { result: CodeGraphReadSessionOpenV1; close?: () => void } {
  const indexDir = join(root, ".codegraph");
  const database = join(indexDir, "codegraph.db");
  const wal = `${database}-wal`;
  const journal = `${database}-journal`;
  const missing = { result: { state: "index-missing" } } as const;
  const unreadable = { result: { state: "index-open-failed" } } as const;
  const moving = { result: { state: "build-in-progress" } } as const;
  let scratch: string | undefined;
  let graph: CodeGraphIndexHandle | undefined;
  const clean = () => {
    try { graph?.close(); }
    finally {
      if (scratch !== undefined) rmSync(scratch, { force: true, recursive: true, maxRetries: 3 });
    }
  };
  try {
    const index = directoryIdentity(indexDir);
    if (index === undefined) return missing;
    if (codeGraphIndexBuildInProgress(root)) return moving;
    const before = fileIdentity(database);
    if (before === undefined) return missing;
    const beforeWal = fileIdentity(wal);
    if (!codeGraphIndexIdentity(root) || statIfPresent(journal)) return unreadable;
    const { sdk } = codeGraphBundle();
    const parent = realpathSync(tmpdir());
    const fromRoot = relative(realpathSync(root), parent);
    if (fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))) return unreadable;
    scratch = mkdtempSync(join(parent, "archctx-verify-"));
    const copy = sdk.getDatabasePath(scratch);
    if (copy !== join(scratch, ".codegraph", "codegraph.db")) throw new Error("CodeGraph resolved an unexpected snapshot path");
    mkdirSync(dirname(copy));
    // Preserve a committed WAL as part of the snapshot. SQLite rebuilds SHM on the private copy.
    copyFileSync(database, copy, constants.COPYFILE_FICLONE);
    if (beforeWal !== undefined) copyFileSync(wal, `${copy}-wal`, constants.COPYFILE_FICLONE);
    const indexIsCurrent = () => {
      try {
        return !codeGraphIndexBuildInProgress(root) && directoryIdentity(indexDir) === index
          && fileIdentity(database) === before && fileIdentity(wal) === beforeWal && !statIfPresent(journal);
      } catch { return false; }
    };
    if (!indexIsCurrent()) { clean(); return moving; }
    disableCodeGraphTelemetryByDefault();
    const provider = readProvider ?? pinnedCodeGraphProvider();
    graph = provider.openReadOnly(scratch);
    const session = isolatedCodeGraphReadSession(root, graph, provider, indexIsCurrent);
    graph = undefined;
    return { result: { state: "open", session }, close: () => { try { session.close(); } finally { clean(); } } };
  } catch {
    clean();
    return unreadable;
  }
}

function statIfPresent(path: string) {
  try { return lstatSync(path, { bigint: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function directoryIdentity(path: string): string | undefined {
  const stat = statIfPresent(path);
  if (stat === undefined) return undefined;
  if (!stat.isDirectory()) throw new Error("CodeGraph directory is not local");
  return `${stat.dev}:${stat.ino}`;
}

function fileIdentity(path: string): string | undefined {
  const stat = statIfPresent(path);
  if (stat === undefined) return undefined;
  if (!stat.isFile()) throw new Error("CodeGraph snapshot entry is not a regular file");
  return `${stat.dev}:${stat.ino}:${stat.ctimeNs}:${stat.mtimeNs}:${stat.size}`;
}
