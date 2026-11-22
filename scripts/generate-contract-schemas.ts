#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CONTRACT_SCHEMA_REGISTRY, serializeSchemaDocument } from "@archcontext/contracts";

const checkOnly = process.argv.includes("--check");
const root = resolve(import.meta.dir, "..");

const stale: string[] = [];
const updated: string[] = [];

for (const [relPath, schema] of Object.entries(CONTRACT_SCHEMA_REGISTRY)) {
  const fullPath = resolve(root, relPath);
  const next = serializeSchemaDocument(schema);
  let prev: string | undefined;
  try {
    prev = readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
  } catch {
    prev = undefined;
  }
  if (prev === next) continue;
  if (checkOnly) {
    stale.push(relPath);
    continue;
  }
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, next, "utf8");
  updated.push(relPath);
}

if (checkOnly) {
  if (stale.length > 0) {
    console.error(`Schema drift detected in ${stale.length} file(s):\n${stale.map((p) => `- ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Schema registry in sync (${Object.keys(CONTRACT_SCHEMA_REGISTRY).length} schemas).`);
} else {
  console.log(
    updated.length === 0
      ? `All ${Object.keys(CONTRACT_SCHEMA_REGISTRY).length} generated schemas already up to date.`
      : `Generated ${updated.length} schema file(s):\n${updated.map((p) => `- ${p}`).join("\n")}`
  );
}
