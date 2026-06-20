#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_SPRINT2_ARTIFACT = "docs/approvals/archctx-sprint-2.md";
const DEFAULT_SPRINT2_ADRS = ["ADR-0026", "ADR-0027", "ADR-0028"];
const AUTOMATION_APPROVER = /\b(codex|claude|agent|bot|automation|self-attested)\b/i;
const PLACEHOLDER_APPROVER = /^(tbd|todo|n\/a|<.*>|.*required.*)$/i;

if (import.meta.main) {
  const [command = "readback", ...args] = process.argv.slice(2);
  if (command !== "readback") {
    console.error("[governance-approval-check] usage: readback");
    process.exit(2);
  }
  const result = await readbackGovernanceApproval({
    artifactPath: readFlag(args, "--artifact") ?? DEFAULT_SPRINT2_ARTIFACT,
    sprint: readFlag(args, "--sprint") ?? "archctx-s2",
    requiredAdrs: readFlags(args, "--required-adr", DEFAULT_SPRINT2_ADRS)
  });
  if (!result.ok) {
    console.error("[governance-approval-check] FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`[governance-approval-check] OK artifact=${result.artifactPath}`);
}

export async function readbackGovernanceApproval({
  artifactPath = DEFAULT_SPRINT2_ARTIFACT,
  root = process.cwd(),
  sprint = "archctx-s2",
  requiredAdrs = DEFAULT_SPRINT2_ADRS
} = {}) {
  let body;
  try {
    body = await readFile(resolve(root, artifactPath), "utf8");
  } catch {
    return { ok: false, artifactPath, failures: [`${artifactPath}: missing or unreadable`] };
  }

  const failures = [];
  const status = field(body, "Status");
  const date = field(body, "Date");
  const scope = field(body, "Scope") ?? "";
  const approver = field(body, "Approved By") ?? field(body, "Approver");

  if (status !== "Approved") failures.push(`${artifactPath}: Status must be Approved`);
  if (!date || !/^\d{4}-\d{2}-\d{2}\b/.test(date)) failures.push(`${artifactPath}: Date must be YYYY-MM-DD`);
  if (!approver) {
    failures.push(`${artifactPath}: Approved By is required`);
  } else if (AUTOMATION_APPROVER.test(approver)) {
    failures.push(`${artifactPath}: Approved By must name a human approver, not automation`);
  } else if (PLACEHOLDER_APPROVER.test(approver)) {
    failures.push(`${artifactPath}: Approved By must name a real human approver, not a placeholder`);
  }
  if (!containsCaseInsensitive(scope, sprint) && !containsCaseInsensitive(body, sprint)) {
    failures.push(`${artifactPath}: approval must reference ${sprint}`);
  }
  for (const adr of requiredAdrs) {
    if (!body.includes(adr)) failures.push(`${artifactPath}: missing ${adr}`);
  }
  if (!/##\s+(Approved Boundary|Boundary)\b/i.test(body)) {
    failures.push(`${artifactPath}: missing Approved Boundary section`);
  }

  return { ok: failures.length === 0, artifactPath, failures };
}

function field(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`^>\\s*\\*\\*${escaped}\\*\\*:\\s*(.+?)\\s*$`, "mi"))
    ?? body.match(new RegExp(`^\\*\\*${escaped}\\*\\*:\\s*(.+?)\\s*$`, "mi"));
  return match?.[1]?.trim();
}

function containsCaseInsensitive(body, value) {
  return body.toLowerCase().includes(value.toLowerCase());
}

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readFlags(args, flag, fallback) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values.length > 0 ? values : fallback;
}
