# Task Review: ownership-change-acceptance-recovery

> **Status**: Ready for independent review
> **Plan**: plans/plan-20260901-1836-ownership-change-acceptance-recovery.md
> **Contract**: tasks/contracts/20260901-1836-ownership-change-acceptance-recovery.contract.md
> **Notes File**: tasks/notes/20260901-1836-ownership-change-acceptance-recovery.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-02
> **Recommendation**: pending independent review
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: pending
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: pending

## Human Review Card

- Verdict: implementation verification complete; independent acceptance review pending
- Change type: bugfix
- Intended files changed: recovery contracts/schema, projection fixed point, receipt store/daemon/RPC/CLI, regression tests, unreleased `0.4.8` product/package authority, and task artifacts
- Actual files changed: see contract Allowed Paths and `git diff --stat`
- Commands passed: Bun 1.4.0; frozen install; typecheck; recovery/contracts 181/181; local-store projection matrix 2/2; legacy WAL/in-place migration lifecycle 2/2; CLI accepted apply/recovery matrix; real-RPC runtime-churn fixture 1/1 (32 assertions); package/catalog release tests; generated public `archctx` and unscoped `archctx-contracts` pack/dry-run; clean dual-tarball consumer import/schema/CLI smoke; full suite 1241/1241 (7717 assertions); strict task workflow/sync/architecture checks; diff check
- Residual risks: receipt consumption is intentionally protected by local daemon/store boundaries; public `archctx@0.4.8` and `archctx-contracts@0.4.8` are deliberately unpublished, so an independent reviewer must inspect proof binding, transaction ordering, and the separate release decision before acceptance
- Reviewer action required: inspect final diff and execute the frozen acceptance workflow
- Rollback: revert the recovery protocol as one unit; v0.4.7 receipts stay readable but are not recoverable

## Mode Evidence

- Selected route: contract work-package bugfix
- P1/P2/P3 evidence: captured plan §§ P1-P3; implementation notes record the authoritative receipt/store/daemon/CLI ownership split and the fixed-point tradeoff
- Root cause or plan evidence: contract Root Cause Evidence and pre-fix artifact

## Verification Evidence

- Waza `/check` run: pending independent reviewer
- Commands run: Node 22.22.0 + Bun 1.4.0; frozen install, generated public npm pack/dry-run, and clean dual-tarball consumer smoke passed; `bun test --timeout 60000` passed 1241 tests with 0 failures and 7717 assertions.
- Manual checks: real committed post-write race, mismatch matrix, and proof-bound pre-consume mutation are asserted by `tests/ownership-change-acceptance-recovery.test.ts`
- Supporting artifacts: `docs/verification/20260901-ownership-change-acceptance-recovery-pre-fix.txt`
- Implementation notes reviewed: pending independent reviewer
- Run snapshot: `.ai/harness/runs/`

## Manual Check Evidence

Copy each non-built-in contract `manual_checks` requirement exactly. Check it only after
the observation is complete and replace the placeholder with concrete command output,
screenshot/artifact path, or reviewer observation.

- No non-built-in `manual_checks` requirement is declared; behavior is covered by the exact
  regression guard and package matrices above.

## Acceptance Receipt Projection

> **Disposition**: unavailable
> **Reviewer**: unavailable
> **Source**: unavailable
> **Actor**: not-applicable
> **Reviewed Subject SHA256**: pending
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: pending
> **Verification Evidence SHA256**: pending
> **Issued At**: pending

- Summary: No AcceptanceReceipt has been recorded.
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

- Independent acceptance review remains required by the frozen policy; no AcceptanceReceipt has
  been issued in this worktree.
- Publication remains blocked pending an explicit release authority, registry publication, and
  post-publication registry/readback verification. No publish, tag, release, merge, or push was
  attempted here.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | pending | independent review required |
| Product depth | pending | independent review required |
| Design quality | pending | independent review required |
| Code quality | pending | independent review required |

## Failing Items

- None in implementation verification; independent acceptance review is pending.

## Retest Steps

- Re-run: commands frozen in the task contract Exit Criteria using Node 22.22.0 and Bun 1.4.0.
- Re-check: inspect immutable receipt binding, proof digest, daemon pre-consume snapshot check, and SQLite conditional consume.

## Summary

- Ready for independent acceptance review; no approval/receipt has been issued by this worker.
