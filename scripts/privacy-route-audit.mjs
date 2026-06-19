#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const scanRoots = [
  "apps",
  "services",
  "packages/control-plane",
  "packages/mcp-cloud-metadata",
  "packages/github-app",
  "packages/cloud-db"
];
const forbidden = [
  /source\s*code/i,
  /codegraph/i,
  /diff\s*body/i,
  /symbol\s*payload/i,
  /architecture\s*model\s*body/i
];
const findings = [];

for (const dir of scanRoots) {
  await scan(join(root, dir));
}

if (findings.length > 0) {
  console.error("[privacy-route-audit] forbidden SaaS content route terms found");
  for (const finding of findings) {
    console.error(`- ${finding.path}: ${finding.pattern}`);
  }
  process.exit(1);
}

console.log("[privacy-route-audit] OK");

async function scan(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "coverage"].includes(entry.name)) continue;
      await scan(path);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|json|md|yaml|yml)$/.test(entry.name)) continue;
    const content = await readFile(path, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(content)) {
        findings.push({ path: relative(root, path), pattern: pattern.toString() });
      }
    }
  }
}
