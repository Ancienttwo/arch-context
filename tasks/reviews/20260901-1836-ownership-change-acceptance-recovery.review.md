# Task Review: ownership-change-acceptance-recovery

> **Status**: Accepted
> **Plan**: plans/plan-20260901-1836-ownership-change-acceptance-recovery.md
> **Contract**: tasks/contracts/20260901-1836-ownership-change-acceptance-recovery.contract.md
> **Notes File**: tasks/notes/20260901-1836-ownership-change-acceptance-recovery.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-02
> **Recommendation**: pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: sha256:b67cfee8137c92d99c2dd2e733fd21167662656f87308a771418c0a5afe0d043
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: f78a7e024f99075042218b9bff8b61a13e01b018

## Human Review Card

- Verdict: accepted after independent Codex recovery and release-prep gates passed; the user then explicitly authorized commit and merge
- Change type: bugfix
- Intended files changed: recovery contracts/schema, projection fixed point, receipt store/daemon/RPC/CLI, regression tests, unreleased `0.4.8` product/package authority, and task artifacts
- Actual files changed: see contract Allowed Paths and `git diff --stat`
- Commands passed: Bun 1.4.0; frozen install; typecheck; recovery/contracts 181/181; local-store projection matrix 2/2; legacy WAL/in-place migration lifecycle 2/2; CLI accepted apply/recovery matrix; real-RPC runtime-churn fixture 1/1 (32 assertions); package/catalog release tests; generated public `archctx` and unscoped `archctx-contracts` pack/dry-run; clean dual-tarball consumer import/schema/CLI smoke; full suite 1241/1241 (7717 assertions); strict task workflow/sync/architecture checks; diff check
- Residual risks: public `archctx@0.4.8` and `archctx-contracts@0.4.8` remain deliberately unpublished; merge does not authorize publication or rollout
- Reviewer action required: none for this merge; publication requires a separate explicit release decision and registry readback
- Rollback: revert the recovery protocol as one unit; v0.4.7 receipts stay readable but are not recoverable

## Mode Evidence

- Selected route: contract work-package bugfix
- P1/P2/P3 evidence: captured plan §§ P1-P3; implementation notes record the authoritative receipt/store/daemon/CLI ownership split and the fixed-point tradeoff
- Root cause or plan evidence: contract Root Cause Evidence and pre-fix artifact

## Verification Evidence

- Waza `/check` equivalent: independent gatekeeper inspected the exact recovery authority and release-prep surfaces and returned PASS with no blocking findings
- Commands run: Node 22.22.0 + Bun 1.4.0; frozen install, generated public npm pack/dry-run, and clean dual-tarball consumer smoke passed; `bun test --timeout 60000` passed 1241 tests with 0 failures and 7717 assertions.
- Manual checks: real committed post-write race, mismatch matrix, and proof-bound pre-consume mutation are asserted by `tests/ownership-change-acceptance-recovery.test.ts`
- Supporting artifacts: `docs/verification/20260901-ownership-change-acceptance-recovery-pre-fix.txt`
- Implementation notes reviewed: yes
- Run snapshot: `.ai/harness/runs/`

## Manual Check Evidence

Copy each non-built-in contract `manual_checks` requirement exactly. Check it only after
the observation is complete and replace the placeholder with concrete command output,
screenshot/artifact path, or reviewer observation.

- No non-built-in `manual_checks` requirement is declared; behavior is covered by the exact
  regression guard and package matrices above.

## Acceptance Receipt Projection

> **Disposition**: user_waiver
> **Reviewer**: User
> **Source**: user-waiver
> **Actor**: ancienttwo
> **Reviewed Subject SHA256**: sha256:b67cfee8137c92d99c2dd2e733fd21167662656f87308a771418c0a5afe0d043
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: f78a7e024f99075042218b9bff8b61a13e01b018
> **Verification Evidence SHA256**: sha256:9435d5216a824be54780170d90021b2ef0d5270fb0da916b3b3970f4b5e92739
> **Issued At**: 2026-09-01T18:04:39.513Z

- Summary: User explicitly authorized commit and merge after independent recovery and release-prep gates passed; npm publication remains out of scope and fail-closed.
- Findings: none

## Behavior Diff Notes

- `projection recover --request-json` is the only recovery surface. Its client input is a
  receipt identity intent; the daemon performs the non-consuming receipt inspection, recompiles
  the no-accepted-change fixed point inside its writer boundary, and produces the typed proof
  before store consumption. The RPC dispatcher exposes no direct receipt-delivery method.
- A receipt records the original approval, expected digest set, renderer/layout/CodeGraph
  provenance, and owned bytes. A repeated successful recovery returns `already-delivered` with no
  refresh signal or projection write.
- Raw authenticated RPC tests prove that the retired direct-delivery method is unknown and that a
  client-shaped proof is schema-invalid; neither path can consume a pending receipt. A clean
  first-pass delivery uses the same daemon writer proof boundary and therefore requires ready
  CodeGraph authority.
- The recovery capability uses unreleased `0.4.8` across package and product authorities. The
  public-shaped local artifacts are `archctx-0.4.8.tgz` (SHA-256
  `cdc1e060ca78e30086c1539a926b6124245db81386061df7c5398f70398c6fec`) and unscoped
  `archctx-contracts-0.4.8.tgz` (SHA-256
  `a9be92f610a00dabe9a2e9d46f3e970236c2bef64217e83cbf2430211b4e4f99`). The release guard
  rejects the scoped source manifest as a public contracts artifact and requires the recovery
  schema export; public npm returned `E404` for the unreleased versions, so rollout remains
  fail-closed.

## Residual Risks / Follow-ups

- Publication remains blocked pending an explicit release authority, registry publication, and
  post-publication registry/readback verification. No publish, tag, release, or push was attempted.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | pass | semantic drift and raw-RPC bypasses fail closed before consumption |
| Product depth | pass | exact recovery protocol, receipt binding, and public package staging are covered |
| Design quality | pass | daemon writer remains the sole semantic recovery authority |
| Code quality | pass | full suite, typecheck, strict contract, and independent gates pass |

## Failing Items

- None.

## Retest Steps

- Re-run: commands frozen in the task contract Exit Criteria using Node 22.22.0 and Bun 1.4.0.
- Re-check: inspect immutable receipt binding, proof digest, daemon pre-consume snapshot check, and SQLite conditional consume.

## Summary

- Accepted for merge under the recorded user-waiver receipt; npm publication remains out of scope.
