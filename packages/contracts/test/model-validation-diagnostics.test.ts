import { expect, test } from "bun:test";
import { failureIssues, knownFailure, modelValidationFailureDetails, type ModelValidationResult } from "../src/index";

test("model refusals retain only bounded authority-owned locations and codes", () => {
  const errors = Array.from({ length: 12 }, (_, index) => `private validation body ${index}`);
  const result: ModelValidationResult = {
    valid: false, errors, modelDigest: "sha256:fixture",
    diagnostics: errors.map((error, index) => ({ error, path: `docs/adr/ADR-${String(index).padStart(4, "0")}-x.md`, code: "schema-version-missing" }))
  };
  const details = modelValidationFailureDetails(result, errors);
  expect(details).toMatchObject({ issueCount: 12, omittedIssueCount: 4 });
  expect(details.diagnostics).toHaveLength(8);
  for (const reason of ["plan-model-invalid", "apply-model-invalid"]) {
    const failure = knownFailure("AC_PRECONDITION_FAILED", reason, details);
    expect(failureIssues(failure)).toEqual([]);
    expect(failure).toMatchObject({ retryable: false, action: "repair-model", details });
    expect(JSON.stringify(failure)).not.toContain("private validation body");
  }
});

test("blocking selection does not infer locations from private validation text", () => {
  const secret = "/private/customer/provider-body";
  const result: ModelValidationResult = { valid: false, errors: [secret, "repairable"], modelDigest: "sha256:fixture", diagnostics: [{ path: "docs/adr/repaired.md", code: "schema-version-missing", error: "repairable" }] };
  expect(modelValidationFailureDetails(result, [secret])).toEqual({ issueCount: 1, diagnostics: [], omittedIssueCount: 1 });
  expect(modelValidationFailureDetails(result, ["repairable"])).toEqual({ issueCount: 1, diagnostics: [{ path: "docs/adr/repaired.md", code: "schema-version-missing" }], omittedIssueCount: 0 });
});

test("node-schema locations are projected from existing structured validation metadata", () => {
  const result: ModelValidationResult = { valid: false, errors: ["schema failure"], nodeSchemaErrors: [{ path: ".archcontext/model/nodes/module.x.yaml", error: "schema failure" }], modelDigest: "sha256:fixture" };
  expect(modelValidationFailureDetails(result, result.errors).diagnostics).toEqual([{ path: ".archcontext/model/nodes/module.x.yaml", code: "node-schema-invalid" }]);
});

test("escaped path bytes cannot exhaust the public failure envelope budget", () => {
  const result: ModelValidationResult = { valid: false, errors: ["invalid"], diagnostics: [{ path: "x" + "\u0001".repeat(100), code: "schema-version-missing", error: "invalid" }], modelDigest: "sha256:fixture" };
  const details = modelValidationFailureDetails(result, result.errors);
  expect(details).toEqual({ issueCount: 1, diagnostics: [], omittedIssueCount: 1 });
  expect(failureIssues(knownFailure("AC_PRECONDITION_FAILED", "plan-model-invalid", details))).toEqual([]);
});
