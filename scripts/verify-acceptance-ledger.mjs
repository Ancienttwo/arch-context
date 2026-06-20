import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ledgerPath = resolve(root, "docs/verification/acceptance-ledger.json");
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const errors = [];

if (ledger.schemaVersion !== "archcontext.acceptance-ledger/v1") {
  errors.push(`unexpected schemaVersion: ${ledger.schemaVersion}`);
}

if (!Array.isArray(ledger.entries) || ledger.entries.length === 0) {
  errors.push("ledger.entries must be a non-empty array");
}

const seen = new Set();
for (const entry of ledger.entries ?? []) {
  if (!entry.id) errors.push("entry missing id");
  if (entry.id && seen.has(entry.id)) errors.push(`duplicate entry id: ${entry.id}`);
  if (entry.id) seen.add(entry.id);
  if (!["task", "exit-gate", "waypoint", "adr"].includes(entry.kind)) {
    errors.push(`${entry.id}: invalid kind ${entry.kind}`);
  }
  if (!["completed", "in_progress", "blocked", "pending"].includes(entry.status)) {
    errors.push(`${entry.id}: invalid status ${entry.status}`);
  }
  if (!/^E[0-4]$/.test(entry.target ?? "")) {
    errors.push(`${entry.id}: invalid target ${entry.target}`);
  }
  if (entry.status === "completed") {
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      errors.push(`${entry.id}: completed entries require evidence`);
      continue;
    }
    for (const evidence of entry.evidence) {
      if (typeof evidence !== "string" || evidence.trim() === "") {
        errors.push(`${entry.id}: evidence path must be a non-empty string`);
        continue;
      }
      const pathOnly = evidence.split("#")[0];
      if (!existsSync(resolve(root, pathOnly))) {
        errors.push(`${entry.id}: evidence path does not exist: ${evidence}`);
      }
    }
  }
}

for (const required of ["FG0-01", "FG0-18", "FG0-EG1", "FG0-EG5"]) {
  if (!seen.has(required)) errors.push(`missing required FG0 ledger entry: ${required}`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`acceptance ledger ok: ${ledger.entries.length} entries`);
