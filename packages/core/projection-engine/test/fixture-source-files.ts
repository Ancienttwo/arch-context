import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ARCHITECTURE_HISTORY_SCHEMA_VERSION, type ArchitectureHistory } from "@archcontext/contracts";

/**
 * Test stand-in for the local runtime's Git listing (`listGitVisibleFiles`): every regular
 * file under `root`, repo-relative and sorted. Core fixtures are plain directories, not Git
 * repositories, and core itself never walks the filesystem for the footprint universe.
 */
export function fixtureSourceFiles(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...fixtureSourceFiles(root, path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort((left, right) => left.localeCompare(right));
}

/**
 * An architecture history with no milestones: the input a repo-harness/v1 render needs while the
 * committed architecture-history row cannot be carried forward: there is no row, or history.md is
 * missing or does not match it (`architectureHistoryCarryForwardBlocker`, ADR-0056 §8).
 */
export const fixtureArchitectureHistory: ArchitectureHistory = {
  schemaVersion: ARCHITECTURE_HISTORY_SCHEMA_VERSION,
  head: "0".repeat(40),
  total: 0,
  offset: 0,
  limit: 0,
  milestones: []
};
