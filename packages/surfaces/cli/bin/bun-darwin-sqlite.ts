/**
 * Development runtime only; never part of the npm tarball (#574, ADR-0058 Decision 8).
 *
 * Bun on macOS loads the system SQLite, which cannot open a WAL database read-only before its
 * `-wal` and `-shm` sidecars exist, and the CodeGraph writer deletes them when it closes. The
 * packaged product runs on Node, whose SQLite opens such a database read-only. This module makes
 * Bun on darwin load a SQLite library from a closed list instead, so the development CLI and the
 * Bun test runner read the CodeGraph index through the same SDK calls as the product. It acts only
 * under Bun on darwin and fails loudly when no listed library exists.
 *
 * Imported first by `bunfig.toml` (test preload) and by `bin/archctx`, which also preloads it into
 * the CLI process it starts.
 */
import { existsSync } from "node:fs";

/** The only libraries this module loads, in order: Homebrew on Apple silicon, then on Intel. */
export const DARWIN_SQLITE_LIBRARY_CANDIDATES: readonly string[] = Object.freeze([
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib"
]);

export function selectDarwinSqliteLibrary(exists: (path: string) => boolean = existsSync): string {
  const library = DARWIN_SQLITE_LIBRARY_CANDIDATES.find(path => exists(path));
  if (library === undefined) {
    throw new Error(`Bun on macOS needs a SQLite library that opens a WAL database read-only; none of ${DARWIN_SQLITE_LIBRARY_CANDIDATES.join(", ")} exists. Install it with \`brew install sqlite\`.`);
  }
  return library;
}

/** The library this process now uses, or `undefined` when the runtime is not Bun on darwin. */
export async function loadDarwinSqliteForBun(): Promise<string | undefined> {
  if (process.platform !== "darwin" || process.versions.bun === undefined) return undefined;
  const library = selectDarwinSqliteLibrary();
  const { Database } = await import("bun:sqlite");
  Database.setCustomSQLite(library);
  return library;
}

export const darwinSqliteLibrary = await loadDarwinSqliteForBun();
// One line per CI test process, so a run shows which library the macOS runner provided.
if (darwinSqliteLibrary !== undefined && process.env.CI === "true" && process.env.NODE_ENV === "test") {
  process.stderr.write(`[bun-darwin-sqlite] ${darwinSqliteLibrary}\n`);
}
