#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditPacketCapture } from "./privacy-capture-lib.mjs";

const inputPaths = process.argv.slice(2);
if (inputPaths.length === 0) {
  console.error("[privacy-packet-capture-audit] usage: node scripts/privacy-packet-capture-audit.mjs <capture.har.json> [...]");
  process.exit(2);
}

const failures = [];
let totalEntries = 0;
let totalCheckedValues = 0;

for (const inputPath of inputPaths) {
  const path = resolve(process.cwd(), inputPath);
  const capture = JSON.parse(await readFile(path, "utf8"));
  const result = auditPacketCapture(capture);
  totalEntries += result.entries;
  totalCheckedValues += result.checkedValues;
  if (!result.ok) {
    failures.push({ inputPath, findings: result.findings });
  }
}

if (failures.length > 0) {
  console.error("[privacy-packet-capture-audit] FAILED");
  for (const failure of failures) {
    console.error(`- ${failure.inputPath}`);
    for (const finding of failure.findings) {
      console.error(`  ${finding.entry} ${finding.path} ${finding.pattern} ${finding.valuePreview}`);
    }
  }
  process.exit(1);
}

console.log(`[privacy-packet-capture-audit] OK entries=${totalEntries} checked=${totalCheckedValues}`);
