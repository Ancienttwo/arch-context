import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Test stand-in for the local runtime's Git listing (`listProjectionSourceFiles`): every regular
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
