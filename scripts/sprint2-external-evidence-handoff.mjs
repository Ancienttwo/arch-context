#!/usr/bin/env node
import { buildSprint2ExternalEvidenceConfig, readbackSprint2ExternalEvidence } from "./sprint2-external-evidence-readback.mjs";

if (import.meta.main) {
  const [command = "render", ...args] = process.argv.slice(2);
  if (command !== "render") {
    console.error("[sprint2-external-evidence-handoff] usage: render");
    process.exit(2);
  }
  const config = buildSprint2ExternalEvidenceConfig(process.env, args);
  const result = await readbackSprint2ExternalEvidence(config);
  process.stdout.write(renderSprint2ExternalEvidenceHandoff(result));
}

export function renderSprint2ExternalEvidenceHandoff(result) {
  const lines = [
    "# Sprint 2 External Evidence Handoff Packet",
    "",
    `Status: ${result.status}.`,
    "",
    "## Current Gate State",
    "",
    "| Gate | Status | Evidence | Failure |",
    "|---|---|---|---|"
  ];

  for (const gate of result.gates) {
    lines.push(`| ${gate.id} | ${gate.status} | \`${gate.evidence}\` | ${formatFailures(gate.failures)} |`);
  }

  lines.push(
    "",
    "## Required Actions",
    "",
    "1. Complete `docs/approvals/archctx-sprint-2.md`: set `Status` to `Approved` and replace the placeholder approver with a real human approver after ADR-0026, ADR-0027, and ADR-0028 are reviewed.",
    "2. Capture staging or production SaaS traffic, redact secrets/customer identifiers, save it as `docs/security/captures/production-redacted.har.json` or `docs/security/captures/staging-redacted.har.json`.",
    "3. Commit a staging or production security scan artifact with zero Critical and High findings.",
    "4. Run the combined recorder. It records capture and scan evidence, then immediately runs strict Sprint 2 readback.",
    "",
    "## Combined Recorder",
    "",
    "```bash",
    "node scripts/sprint2-external-evidence-record.mjs record \\",
    "  --environment production \\",
    "  --capture docs/security/captures/production-redacted.har.json \\",
    "  --scan-artifact docs/security/reviews/production-security-scan.md \\",
    "  --critical 0 \\",
    "  --high 0 \\",
    "  --scanner external-security-scan",
    "```",
    "",
    "## Underlying Evidence Commands",
    ""
  );

  for (const item of result.acquisitionPlan) {
    lines.push(`### ${item.gate}`, "", "```bash", item.command, "```", "");
  }

  lines.push(
    "## Final Readback",
    "",
    "```bash",
    "bun run readback:s2:external",
    "node scripts/sprint2-external-evidence-readback.mjs readback --json",
    "```",
    "",
    "## Boundary",
    "",
    "This packet does not create approval, packet capture, or security scan evidence. It only identifies the exact artifacts and commands needed to close the remaining Sprint 2 external gates.",
    ""
  );

  return lines.join("\n");
}

function formatFailures(failures = []) {
  if (failures.length === 0) return "none";
  return failures.map((item) => escapeTableCell(item)).join("<br>");
}

function escapeTableCell(value) {
  return String(value).replace(/\|/g, "\\|");
}
