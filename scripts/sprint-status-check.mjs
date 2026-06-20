#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readbackGovernanceApproval } from "./governance-approval-check.mjs";

const sprintPath = "plans/sprints/archctx-sprint.md";
const specPath = "docs/spec.md";

export async function collectSprintStatusFailures(root = process.cwd()) {
  const failures = [];
  const sprint = await readRequired(root, sprintPath, failures);
  const spec = await readRequired(root, specPath, failures);

  if (sprint && spec) await validateMvpSprint(root, sprint, spec, failures);
  await validateSprint2EvidenceClaims(root, failures);
  await validateSprint3EvidenceClaims(root, failures);
  await validateGovernanceFollowupPlan(root, failures);

  return failures;
}

async function validateMvpSprint(root, sprint, spec, failures) {
  const prdMatch = sprint.match(/\*\*Source PRD\*\*:\s*`([^`]+)`/);
  if (!prdMatch) {
    failures.push(`${sprintPath}: missing Source PRD`);
  } else {
    const prdPath = prdMatch[1];
    if (!/^plans\/prds\/\d{8}-\d{4}-[a-z0-9-]+\.prd\.md$/.test(prdPath)) {
      failures.push(`${sprintPath}: Source PRD path does not match repo-harness PRD naming contract`);
    } else {
      await expectFile(root, prdPath, failures);
      const prd = await readRequired(root, prdPath, failures);
      if (prd) {
        for (const required of ["**Status**", "**Slug**", "**Created**", "**Updated**", "**Source Spec**"]) {
          if (!prd.includes(required)) failures.push(`${prdPath}: missing ${required}`);
        }
      }
    }
    if (!spec.includes(prdPath)) {
      failures.push(`${specPath}: Full PRD pointer does not match sprint Source PRD`);
    }
  }

  for (const marker of ["## M0", "## M1", "## M2", "## M3", "## M4", "## M5", "## M6"]) {
    if (!sprint.includes(marker)) failures.push(`${sprintPath}: missing ${marker}`);
  }
}

async function validateGovernanceFollowupPlan(root, failures) {
  const prdPath = "plans/prds/20260620-0236-archcontext-local-github-governance.prd.md";
  const sprintPath = "plans/sprints/archctx-local-github-governance-sprint.md";
  const [prd, sprint] = await Promise.all([
    readOptional(root, prdPath),
    readOptional(root, sprintPath)
  ]);

  if (!prd && !sprint) return;
  if (!prd) {
    failures.push(`${prdPath}: missing while ${sprintPath} exists`);
    return;
  }
  if (!sprint) {
    failures.push(`${sprintPath}: missing while ${prdPath} exists`);
    return;
  }

  if (!prd.includes("**Status**: Draft for Architecture Review")) {
    failures.push(`${prdPath}: follow-up PRD must remain Draft for Architecture Review until human acceptance is recorded`);
  }
  if (!prd.includes("**Source PRD**: `plans/prds/20260619-2039-archcontext.prd.md`")) {
    failures.push(`${prdPath}: Source PRD must point at the canonical ArchContext PRD`);
  }
  if (!prd.includes("**Source Spec**: `docs/spec.md`")) {
    failures.push(`${prdPath}: Source Spec must point at docs/spec.md`);
  }

  const statusLine = findStatusLine(sprint);
  if (!statusLine || !/Draft\s+—\s+Not Started/.test(statusLine)) {
    failures.push(`${sprintPath}: status must remain Draft — Not Started until FG0 acceptance starts`);
  }
  if (!sprint.includes(`**Source PRD**: \`${prdPath}\``)) {
    failures.push(`${sprintPath}: Source PRD must point at ${prdPath}`);
  }
  if (!sprint.includes("**Parent Sprint**: `plans/sprints/archctx-sprint.md`")) {
    failures.push(`${sprintPath}: Parent Sprint must point at the MVP sprint`);
  }
  if (!/\|\s*\*\*合计\*\*\s*\|[^|\n]*\|\s*\*\*141\*\*\s*\|\s*\*\*51\*\*\s*\|\s*\*\*0\s*\/\s*192\*\*\s*\|/.test(sprint)) {
    failures.push(`${sprintPath}: progress total must stay 0 / 192 while draft intake is not accepted`);
  }
  if (/^\|\s*FG\d+(?:-\d+|-EG\d+)\s*\|\s*☑\s*\|/m.test(sprint)) {
    failures.push(`${sprintPath}: follow-up FG tasks/gates must not be marked complete during draft intake`);
  }

  const todos = await readOptional(root, "tasks/todos.md");
  if (!todos || !todos.includes(sprintPath)) {
    failures.push(`tasks/todos.md: must reference ${sprintPath} as deferred follow-up work`);
  }
}

async function validateSprint2EvidenceClaims(root, failures) {
  const path = "plans/sprints/archctx-sprint-2.md";
  const sprint = await readOptional(root, path);
  if (!sprint) return;

  const hardening = await readOptional(root, "packages/cloud/hardening/src/index.ts");
  const manifest = await readOptional(root, "docs/security/captures/manifest.json");
  const pendingCapture = !manifest || !hardening || captureManifestHasPending(manifest, ["production", "staging"], failures) || hardening.includes("pending-production-environment");
  const securityScanManifest = await readOptional(root, "docs/security/scans/manifest.json");
  const pendingProductionScan = !hardening || /productionScan:\s*"pending"/.test(hardening) || !securityScanManifest || securityScanManifestHasPending(securityScanManifest, ["production", "staging"], failures);
  const missingRepresentativeEval = !(await fileExists(root, "docs/verification/s2-representative-eval.md"));
  const humanApproval = await readbackGovernanceApproval({ root });
  const missingHumanApproval = !humanApproval.ok;
  const missingRebuildProof = !(await fileExists(root, "docs/verification/s2-multirepo-rebuild.md"));

  if (/\b81\s*\/\s*81\b/.test(sprint)) {
    failures.push(`${path}: must not claim 81/81 while Sprint 2 launch/governance evidence is pending`);
  }

  const statusLine = findStatusLine(sprint);
  if (statusLine && /\*\*Status\*\*:\s*Complete\s*$/.test(statusLine)) {
    failures.push(`${path}: bare Complete status hides pending production/governance evidence`);
  }

  if (missingHumanApproval) {
    assertNotGreen(sprint, path, "CD-EG3", "human approval artifact is missing or invalid", failures);
  }
  if (missingRebuildProof) {
    assertNotGreen(sprint, path, "MR-16", "delete-local-store rebuild proof is missing", failures);
    assertNotGreen(sprint, path, "MR-EG3", "delete-local-store rebuild proof is missing", failures);
  }
  if (pendingCapture) {
    for (const id of ["MR-EG5", "TR-EG4", "HL-EG1"]) {
      assertNotGreen(sprint, path, id, "production or staging packet capture remains pending", failures);
    }
  }
  if (pendingProductionScan) {
    assertNotGreen(sprint, path, "HL-EG5", "production security scan remains pending", failures);
  }
  if (missingRepresentativeEval) {
    assertNotGreen(sprint, path, "HL-EG6", "representative Eval report is missing", failures);
  }
}

async function validateSprint3EvidenceClaims(root, failures) {
  const path = "plans/sprints/archctx-sprint-3.md";
  const sprint = await readOptional(root, path);
  if (!sprint) return;

  const manifest = await readOptional(root, "docs/security/captures/manifest.json");
  const hasPendingExternalCapture = !manifest || captureManifestHasPending(manifest, ["production", "staging"], failures);

  if (/Complete\s+81\/81/.test(sprint) || /S2\s+全绿/.test(sprint)) {
    failures.push(`${path}: must not inherit Sprint 2 as fully green while Sprint 2 evidence is pending`);
  }

  if (hasPendingExternalCapture && /production GA verified/i.test(sprint) && !/production GA external readback pending/i.test(sprint)) {
    failures.push(`${path}: production GA verified claim requires external readback evidence`);
  }
}

function assertNotGreen(document, path, id, reason, failures) {
  if (new RegExp(`\\|\\s*${escapeRegExp(id)}\\s*\\|\\s*☑\\s*\\|`).test(document)) {
    failures.push(`${path}: ${id} is marked ☑ but ${reason}`);
  }
}

function captureManifestHasPending(manifestText, environments, failures) {
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    failures.push("docs/security/captures/manifest.json: invalid JSON");
    return true;
  }
  return (manifest.captures ?? []).some((entry) => environments.includes(entry.environment) && entry.status === "pending");
}

function securityScanManifestHasPending(manifestText, environments, failures) {
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    failures.push("docs/security/scans/manifest.json: invalid JSON");
    return true;
  }
  return (manifest.scans ?? []).some((entry) => environments.includes(entry.environment) && entry.status === "pending");
}

function findStatusLine(document) {
  return document.split("\n").find((line) => line.includes("**Status**"));
}

async function readRequired(root, path, failures) {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch {
    failures.push(`${path}: missing or unreadable`);
    return undefined;
  }
}

async function readOptional(root, path) {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch {
    return undefined;
  }
}

async function fileExists(root, path) {
  try {
    await access(resolve(root, path), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function expectFile(root, path, failures) {
  try {
    await access(resolve(root, path), constants.R_OK);
  } catch {
    failures.push(`${path}: missing or unreadable`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = await collectSprintStatusFailures();
  if (failures.length > 0) {
    console.error("[sprint-status-check] FAILED");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("[sprint-status-check] STRUCTURE AND EVIDENCE CLAIMS OK");
}
