import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

export interface ByteEntry { path: string; kind: string; mode: number; sha256?: string; target?: string; }
export const FIXTURE_VOLATILE_CONTENT = [".codegraph/codegraph.db-shm"] as const;

/** Fresh recursive discovery; includes directories, ignored/untracked files and Git metadata. */
export function recursiveByteEntries(root: string, volatileContentPaths: readonly string[] = []): ByteEntry[] {
  const rows: ByteEntry[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(join(root, path)).sort()) {
      const relative = path ? path + "/" + name : name;
      const absolute = join(root, relative); const stat = lstatSync(absolute);
      const mode = stat.mode & 0o777;
      if (stat.isDirectory()) { rows.push({ path: relative, kind: "directory", mode }); walk(relative); }
      else if (stat.isSymbolicLink()) rows.push({ path: relative, kind: "symlink", mode, target: readlinkSync(absolute) });
      else if (stat.isFile()) rows.push({ path: relative, kind: volatileContentPaths.includes(relative) ? "sqlite-shm-lock-marks" : "file", mode,
        ...(volatileContentPaths.includes(relative) ? {} : { sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex") }) });
      else rows.push({ path: relative, kind: "special", mode });
    }
  };
  walk(""); return rows;
}

export function benchmarkByteWitness(fixtureRoot: string, stateRoot: string): string {
  return JSON.stringify({ fixture: recursiveByteEntries(fixtureRoot, FIXTURE_VOLATILE_CONTENT),
    runtimeState: recursiveByteEntries(stateRoot) });
}

