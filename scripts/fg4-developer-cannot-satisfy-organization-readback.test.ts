import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inspectFg4DeveloperCannotSatisfyOrganizationReadback } from "./fg4-developer-cannot-satisfy-organization-readback";

describe("fg4 Developer Check cannot satisfy Organization Runner readback", () => {
  test("accepts sanitized verified protected ruleset evidence", () => {
    const evidence = JSON.parse(readFileSync("docs/verification/fg4-developer-cannot-satisfy-organization-readback.json", "utf8"));
    expect(inspectFg4DeveloperCannotSatisfyOrganizationReadback(evidence)).toEqual({ ok: true, failures: [] });
  });

  test("rejects Developer Check reuse, missing Organization requirement, cleanup gaps, and secrets", () => {
    const evidence = JSON.parse(readFileSync("docs/verification/fg4-developer-cannot-satisfy-organization-readback.json", "utf8"));
    const weak = {
      ...evidence,
      evidence: {
        ...evidence.evidence,
        policy: {
          ...evidence.evidence.policy,
          developerTrustSatisfiesOrganization: true,
          developerAttestationAcceptedForOrganization: true,
          rejectionReasonCode: ""
        },
        organizationRunner: {
          ...evidence.evidence.organizationRunner,
          checkRunId: evidence.evidence.developerReview.checkRunId,
          conclusion: "success",
          outputTitle: "Organization-attested",
          requiredSummary: false
        },
        ruleset: {
          ...evidence.evidence.ruleset,
          requiredContext: "ArchContext / Developer Review",
          integrationId: 123,
          deletedAfterReadback: false
        }
      },
      leaked: "Bearer ghs_private_token"
    };
    const result = inspectFg4DeveloperCannotSatisfyOrganizationReadback(weak);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("Developer trust must not satisfy Organization policy");
    expect(result.failures).toContain("Developer Attestation must be rejected for Organization policy");
    expect(result.failures).toContain("Organization Check must remain failure");
    expect(result.failures).toContain("Organization Check must explain Organization Attestation requirement");
    expect(result.failures).toContain("Developer and Organization checks must be distinct CheckRuns");
    expect(result.failures).toContain("ruleset required context must be Organization Runner");
    expect(result.failures).toContain("ruleset integrationId must match staging App ID");
    expect(result.failures).toContain("temporary ruleset must be deleted");
    expect(result.failures.some((failure) => failure.includes("forbidden secret marker"))).toBe(true);
  });
});
