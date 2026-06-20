import { describe, expect, test } from "bun:test";
import { renderSprint2ExternalEvidenceHandoff } from "./sprint2-external-evidence-handoff.mjs";

describe("sprint2-external-evidence-handoff", () => {
  test("renders the blocked gates, artifact paths, and acquisition commands", () => {
    const packet = renderSprint2ExternalEvidenceHandoff({
      status: "blocked",
      gates: [
        {
          id: "CD-EG3",
          status: "blocked",
          evidence: "docs/approvals/archctx-sprint-2.md",
          failures: ["docs/approvals/archctx-sprint-2.md: Status must be Approved"]
        },
        {
          id: "MR-EG5/TR-EG4/HL-EG1",
          status: "blocked",
          evidence: "docs/security/captures/manifest.json",
          failures: ["missing verified staging or production capture"]
        },
        {
          id: "HL-EG5",
          status: "blocked",
          evidence: "docs/security/scans/manifest.json",
          failures: ["missing verified staging or production security scan"]
        }
      ],
      acquisitionPlan: [
        {
          gate: "CD-EG3",
          command: "node scripts/governance-approval-check.mjs readback --artifact docs/approvals/archctx-sprint-2.md"
        },
        {
          gate: "MR-EG5/TR-EG4/HL-EG1",
          command: "node scripts/privacy-capture-manifest.mjs record --environment production --capture docs/security/captures/production-redacted.har.json"
        },
        {
          gate: "HL-EG5",
          command: "node scripts/security-scan-manifest.mjs record --environment production --artifact docs/security/reviews/production-security-scan.md --critical 0 --high 0"
        }
      ]
    });

    expect(packet).toContain("# Sprint 2 External Evidence Handoff Packet");
    expect(packet).toContain("| CD-EG3 | blocked | `docs/approvals/archctx-sprint-2.md` | docs/approvals/archctx-sprint-2.md: Status must be Approved |");
    expect(packet).toContain("node scripts/sprint2-external-evidence-record.mjs record");
    expect(packet).toContain("node scripts/privacy-capture-manifest.mjs record --environment production");
    expect(packet).toContain("node scripts/security-scan-manifest.mjs record --environment production");
    expect(packet).toContain("This packet does not create approval, packet capture, or security scan evidence.");
  });
});
