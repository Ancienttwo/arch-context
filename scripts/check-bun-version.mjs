import { readFileSync } from "node:fs";

const { packageManager } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const actual = process.versions.bun;
if (packageManager !== `bun@${actual}`) {
  throw new Error(`This repository requires ${packageManager}; running ${actual ? `bun@${actual}` : "without Bun"}. Install the pinned Bun before running verification.`);
}
