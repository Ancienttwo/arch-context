#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const sprintPath = "plans/sprints/archctx-sprint.md";
const specPath = "docs/spec.md";
const sprint = await readFile(sprintPath, "utf8");
const spec = await readFile(specPath, "utf8");
const failures = [];

const prdMatch = sprint.match(/\*\*Source PRD\*\*:\s*`([^`]+)`/);
if (!prdMatch) {
  failures.push(`${sprintPath}: missing Source PRD`);
} else {
  const prdPath = prdMatch[1];
  if (!/^plans\/prds\/\d{8}-\d{4}-[a-z0-9-]+\.prd\.md$/.test(prdPath)) {
    failures.push(`${sprintPath}: Source PRD path does not match repo-harness PRD naming contract`);
  } else {
    await expectFile(prdPath);
    const prd = await readFile(prdPath, "utf8");
    for (const required of ["**Status**", "**Slug**", "**Created**", "**Updated**", "**Source Spec**"]) {
      if (!prd.includes(required)) failures.push(`${prdPath}: missing ${required}`);
    }
  }
  if (!spec.includes(prdPath)) {
    failures.push(`${specPath}: Full PRD pointer does not match sprint Source PRD`);
  }
}

for (const marker of ["## M0", "## M1", "## M2", "## M3", "## M4", "## M5", "## M6"]) {
  if (!sprint.includes(marker)) failures.push(`${sprintPath}: missing ${marker}`);
}

if (failures.length > 0) {
  console.error("[sprint-status-check] FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[sprint-status-check] OK");

async function expectFile(path) {
  try {
    await access(path, constants.R_OK);
  } catch {
    failures.push(`${path}: missing or unreadable`);
  }
}
