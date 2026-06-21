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

  const draftIntake = prd.includes("**Status**: Draft for Architecture Review");
  const fg0Accepted = prd.includes("**Status**: Accepted for FG0 Contract Execution");
  if (!draftIntake && !fg0Accepted) {
    failures.push(`${prdPath}: follow-up PRD status must be Draft for Architecture Review or Accepted for FG0 Contract Execution`);
  }
  if (!prd.includes("**Source PRD**: `plans/prds/20260619-2039-archcontext.prd.md`")) {
    failures.push(`${prdPath}: Source PRD must point at the canonical ArchContext PRD`);
  }
  if (!prd.includes("**Source Spec**: `docs/spec.md`")) {
    failures.push(`${prdPath}: Source Spec must point at docs/spec.md`);
  }

  const statusLine = findStatusLine(sprint);
  if (!sprint.includes(`**Source PRD**: \`${prdPath}\``)) {
    failures.push(`${sprintPath}: Source PRD must point at ${prdPath}`);
  }
  if (!sprint.includes("**Parent Sprint**: `plans/sprints/archctx-sprint.md`")) {
    failures.push(`${sprintPath}: Parent Sprint must point at the MVP sprint`);
  }
  if (draftIntake) {
    if (!statusLine || !/Draft\s+—\s+Not Started/.test(statusLine)) {
      failures.push(`${sprintPath}: status must remain Draft — Not Started until FG0 acceptance starts`);
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
    return;
  }

  if (fg0Accepted) {
    await validateGovernanceFollowupFg0(root, sprint, statusLine, failures);
  }
}

async function validateGovernanceFollowupFg0(root, sprint, statusLine, failures) {
  const sprintPath = "plans/sprints/archctx-local-github-governance-sprint.md";
  const ledgerPath = "docs/verification/acceptance-ledger.json";
  const evidencePath = "docs/verification/fg0-contract-correction-gate.md";
  const [ledgerText, evidence] = await Promise.all([
    readOptional(root, ledgerPath),
    readOptional(root, evidencePath)
  ]);
  if (!ledgerText) failures.push(`${ledgerPath}: missing FG0 acceptance ledger`);
  if (!evidence) failures.push(`${evidencePath}: missing FG0 evidence file`);
  if (!ledgerText) return;

  let ledger;
  try {
    ledger = JSON.parse(ledgerText);
  } catch {
    failures.push(`${ledgerPath}: invalid JSON`);
    return;
  }
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const completed = entries.filter((entry) => entry.status === "completed");
  const completedIds = new Set(completed.map((entry) => entry.id));
  const sprintCompletedIds = governanceCompletedIds(sprint);
  const fg1Evidence = await readOptional(root, "docs/verification/fg1-local-product-gate.md");
  const fg2Evidence = await readOptional(root, "docs/verification/fg2-github-privacy-gate.md");
  const fg3Evidence = await readOptional(root, "docs/verification/fg3-developer-review-gate.md");
  const fg4Evidence = await readOptional(root, "docs/verification/fg4-organization-runner-gate.md");
  const fg1Completed = completed.filter((entry) => /^FG1(?:-\d+|-EG\d+)$/.test(entry.id)).length;
  const fg1Complete = fg1Completed === 24
    && fg1Evidence?.includes("PASS for FG1-01 through FG1-18 plus FG1-EG1 through FG1-EG6");
  const fg2Completed = completed.filter((entry) => /^FG2(?:-\d+|-EG\d+)$/.test(entry.id)).length;
  const fg2Complete = fg2Completed === 27
    && fg2Evidence?.includes("PASS for all FG2 tasks and for FG2-EG1 through FG2-EG7");
  const fg3Completed = completed.filter((entry) => /^FG3(?:-\d+|-EG\d+)$/.test(entry.id)).length;
  const fg3Complete = fg3Completed === 32
    && fg3Evidence?.includes("PASS for FG3-01 through FG3-24 and FG3-EG1 through FG3-EG8");
  const fg4Completed = completed.filter((entry) => /^FG4(?:-\d+|-EG\d+)$/.test(entry.id)).length;
  const fg4Complete = fg4Completed === 29
    && fg4Evidence?.includes("PASS for FG4-01 through FG4-21 and FG4-EG1 through FG4-EG8");
  const hasFg1Progress = completed.some((entry) => /^FG1(?:-\d+|-EG\d+)$/.test(entry.id))
    || sprintCompletedIds.some((id) => /^FG1(?:-\d+|-EG\d+)$/.test(id));
  const hasFg2Progress = completed.some((entry) => /^FG2(?:-\d+|-EG\d+)$/.test(entry.id))
    || sprintCompletedIds.some((id) => /^FG2(?:-\d+|-EG\d+)$/.test(id));
  const hasFg3Progress = completed.some((entry) => /^FG3(?:-\d+|-EG\d+)$/.test(entry.id))
    || sprintCompletedIds.some((id) => /^FG3(?:-\d+|-EG\d+)$/.test(id));
  const hasFg4Progress = completed.some((entry) => /^FG4(?:-\d+|-EG\d+)$/.test(entry.id))
    || sprintCompletedIds.some((id) => /^FG4(?:-\d+|-EG\d+)$/.test(id));
  const hasFg5Progress = completed.some((entry) => /^FG5(?:-\d+|-EG\d+)$/.test(entry.id))
    || sprintCompletedIds.some((id) => /^FG5(?:-\d+|-EG\d+)$/.test(id));
  const hasFg6Progress = completed.some((entry) => /^FG6(?:-\d+|-EG\d+)$/.test(entry.id))
    || sprintCompletedIds.some((id) => /^FG6(?:-\d+|-EG\d+)$/.test(id));

  if (hasFg2Progress && !fg1Complete) {
    failures.push(`${sprintPath}: FG2-FG6 completion is not accepted until FG1 exit evidence exists`);
  }
  if (hasFg3Progress && !fg2Complete) {
    failures.push(`${sprintPath}: FG3-FG6 completion is not accepted until FG2 exit evidence exists`);
  }
  if ((hasFg4Progress || hasFg5Progress || hasFg6Progress) && !fg3Complete) {
    failures.push(`${sprintPath}: FG4-FG6 completion is not accepted until FG3 exit evidence exists`);
  }
  if ((hasFg5Progress || hasFg6Progress) && !fg4Complete) {
    failures.push(`${sprintPath}: FG5-FG6 completion is not accepted until FG4 exit evidence exists`);
  }
  if (hasFg6Progress) {
    failures.push(`${sprintPath}: FG6 completion is not accepted until FG5 exit evidence exists`);
  }

  if (hasFg4Progress && fg3Complete) {
    if (!statusLine || !/Executing\s+—\s+FG4 In Progress/.test(statusLine)) {
      failures.push(`${sprintPath}: FG4 progress must use status Executing — FG4 In Progress`);
    }
    if (!progressRowMatches(sprint, "FG1", 24, 24)) {
      failures.push(`${sprintPath}: FG1 progress must remain 24 / 24 before FG4 progress is accepted`);
    }
    if (!progressRowMatches(sprint, "FG2", 27, 27)) {
      failures.push(`${sprintPath}: FG2 progress must remain 27 / 27 before FG4 progress is accepted`);
    }
    if (!progressRowMatches(sprint, "FG3", 32, 32)) {
      failures.push(`${sprintPath}: FG3 progress must remain 32 / 32 before FG4 progress is accepted`);
    }
    if (!progressRowMatches(sprint, "FG4", fg4Completed, 29)) {
      failures.push(`${sprintPath}: FG4 progress must match ledger count ${fg4Completed} / 29`);
    }
    if (!totalProgressMatches(sprint, completed.length)) {
      failures.push(`${sprintPath}: total progress must match ledger count ${completed.length} / 192`);
    }
    for (const id of sprintCompletedIds) {
      if (!completedIds.has(id)) failures.push(`${ledgerPath}: sprint marks ${id} complete without completed ledger evidence`);
    }
  } else if (hasFg3Progress && fg2Complete) {
    if (!statusLine || !/Executing\s+—\s+FG3 In Progress/.test(statusLine)) {
      failures.push(`${sprintPath}: FG3 progress must use status Executing — FG3 In Progress`);
    }
    if (!progressRowMatches(sprint, "FG1", 24, 24)) {
      failures.push(`${sprintPath}: FG1 progress must remain 24 / 24 before FG3 progress is accepted`);
    }
    if (!progressRowMatches(sprint, "FG2", 27, 27)) {
      failures.push(`${sprintPath}: FG2 progress must remain 27 / 27 before FG3 progress is accepted`);
    }
    if (!progressRowMatches(sprint, "FG3", fg3Completed, 32)) {
      failures.push(`${sprintPath}: FG3 progress must match ledger count ${fg3Completed} / 32`);
    }
    if (!totalProgressMatches(sprint, completed.length)) {
      failures.push(`${sprintPath}: total progress must match ledger count ${completed.length} / 192`);
    }
    for (const id of sprintCompletedIds) {
      if (!completedIds.has(id)) failures.push(`${ledgerPath}: sprint marks ${id} complete without completed ledger evidence`);
    }
  } else if (hasFg2Progress && fg1Complete) {
    if (!statusLine || !/Executing\s+—\s+FG2 In Progress/.test(statusLine)) {
      failures.push(`${sprintPath}: FG2 progress must use status Executing — FG2 In Progress`);
    }
    if (!progressRowMatches(sprint, "FG1", 24, 24)) {
      failures.push(`${sprintPath}: FG1 progress must remain 24 / 24 before FG2 progress is accepted`);
    }
    if (!progressRowMatches(sprint, "FG2", fg2Completed, 27)) {
      failures.push(`${sprintPath}: FG2 progress must match ledger count ${fg2Completed} / 27`);
    }
    if (!totalProgressMatches(sprint, completed.length)) {
      failures.push(`${sprintPath}: total progress must match ledger count ${completed.length} / 192`);
    }
    for (const id of sprintCompletedIds) {
      if (!completedIds.has(id)) failures.push(`${ledgerPath}: sprint marks ${id} complete without completed ledger evidence`);
    }
  } else if (hasFg1Progress) {
    if (!statusLine || !/Executing\s+—\s+FG1 In Progress/.test(statusLine)) {
      failures.push(`${sprintPath}: FG1 progress must use status Executing — FG1 In Progress`);
    }
    if (!progressRowMatches(sprint, "FG1", fg1Completed, 24)) {
      failures.push(`${sprintPath}: FG1 progress must match ledger count ${fg1Completed} / 24`);
    }
    if (!totalProgressMatches(sprint, completed.length)) {
      failures.push(`${sprintPath}: total progress must match ledger count ${completed.length} / 192`);
    }
    for (const id of sprintCompletedIds) {
      if (!completedIds.has(id)) failures.push(`${ledgerPath}: sprint marks ${id} complete without completed ledger evidence`);
    }
  } else {
    if (!statusLine || !/Executing\s+—\s+FG0 Complete/.test(statusLine)) {
      failures.push(`${sprintPath}: accepted follow-up must be Executing — FG0 Complete until FG1 starts`);
    }
    if (completed.length !== 23) {
      failures.push(`${ledgerPath}: FG0 complete state must have exactly 23 completed entries`);
    }
    if (!totalProgressMatches(sprint, 23)) {
      failures.push(`${sprintPath}: accepted FG0 progress must be exactly 23 / 192`);
    }
    if (sprintCompletedIds.some((id) => /^FG[1-6](?:-\d+|-EG\d+)$/.test(id))) {
      failures.push(`${sprintPath}: FG1-FG6 tasks/gates must not be marked complete before their evidence gates exist`);
    }
  }

  for (const entry of completed) {
    const supportedEntry = fg3Complete
      ? /^FG[0-4](?:-\d+|-EG\d+)$/.test(entry.id)
      : fg2Complete
        ? /^FG[0-3](?:-\d+|-EG\d+)$/.test(entry.id)
      : fg1Complete
        ? /^FG[0-2](?:-\d+|-EG\d+)$/.test(entry.id)
        : /^FG[01](?:-\d+|-EG\d+)$/.test(entry.id);
    if (!supportedEntry) {
      failures.push(`${ledgerPath}: unsupported governance entry is completed before its evidence gate: ${entry.id}`);
    }
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      failures.push(`${ledgerPath}: completed entry lacks evidence: ${entry.id}`);
    }
  }
  for (const required of ["FG0-01", "FG0-18", "FG0-EG1", "FG0-EG2", "FG0-EG3", "FG0-EG4", "FG0-EG5"]) {
    if (!completed.some((entry) => entry.id === required)) {
      failures.push(`${ledgerPath}: missing completed FG0 entry ${required}`);
    }
  }
}

function governanceCompletedIds(sprint) {
  return [...sprint.matchAll(/^\|\s*(FG[0-6](?:-\d+|-EG\d+))\s*\|\s*☑\s*\|/gm)].map((match) => match[1]);
}

function progressRowMatches(sprint, milestone, completed, total) {
  return new RegExp(`\\|\\s*${milestone}\\s*\\|[^\\n]*\\|\\s*${completed}\\s*\\/\\s*${total}\\s*\\|`).test(sprint);
}

function totalProgressMatches(sprint, completed) {
  return new RegExp(`\\|\\s*\\*\\*合计\\*\\*\\s*\\|[^\\n]*\\|\\s*\\*\\*${completed}\\s*\\/\\s*192\\*\\*\\s*\\|`).test(sprint);
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
