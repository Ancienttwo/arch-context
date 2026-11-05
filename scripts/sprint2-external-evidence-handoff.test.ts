import { describe, expect, test } from "bun:test";
import { renderSprint2ExternalEvidenceHandoff } from "./sprint2-external-evidence-handoff.mjs";

describe("sprint2-external-evidence-handoff", () => {
  test("renders the blocked gates, artifact paths, and acquisition commands", () => {
    const packet = renderSprint2ExternalEvidenceHandoff({
      status: "blocked",
      gates: [
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
    expect(packet).toContain("| MR-EG5/TR-EG4/HL-EG1 | blocked | `docs/security/captures/manifest.json` | missing verified staging or production capture |");
    expect(packet).not.toMatch(/approval|CD-EG3/i);
    expect(packet).toContain("node scripts/sprint2-external-evidence-record.mjs record");
    expect(packet).toContain("node scripts/privacy-capture-manifest.mjs record --environment production");
    expect(packet).toContain("node scripts/security-scan-manifest.mjs record --environment production");
    expect(packet).toContain("This packet does not create packet capture or security scan evidence.");
  });
});
