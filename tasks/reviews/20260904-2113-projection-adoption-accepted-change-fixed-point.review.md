# Task Review: projection-adoption-accepted-change-fixed-point

> **Status**: Complete
> **Plan**: plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md
> **Contract**: tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md
> **Notes File**: tasks/notes/20260904-2113-projection-adoption-accepted-change-fixed-point.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-04 21:49
> **Recommendation**: pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: pending
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: pending

## Human Review Card

- Verdict: pass
- Change type: code-change
- Intended files changed: provider adoption fixed-point, CLI regression, 0.5.5 package/release authorities, and workflow evidence
- Actual files changed: only contract allowed paths; implementation commit `91210e7` plus this release closeout
- Commands passed: focused adoption regression, full CLI suite, contracts/adoption tests, typecheck, release dry-run, packaged smoke, registry-installed capabilities smoke, strict contract verification
- Residual risks: npm publish helper observed transient E404 immediately after each successful publish; independent registry readback subsequently verified both exact digests and `latest=0.5.5`
- Reviewer action required: none
- Rollback: revert the provider and release closeout commits together; consumers remain pinned until their separate upgrade

## Mode Evidence

- Selected route: bugfix
- P1/P2/P3 evidence: CLI `projection adopt` enters `runArchitectureDocsAdoptionCommand`, crosses projection simulation and daemon commit, and terminates in durable apply receipt plus refresh delivery; the invariant is one accepted reference consumed once in one transaction.
- Root cause or plan evidence: `docs/verification/20260904-projection-adoption-accepted-change-fixed-point-pre-fix.txt` and the contract Root Cause Evidence

## Verification Evidence

- Waza `/check` run: strict contract verification passed
- Commands run: `bun test packages/surfaces/cli/test/cli.test.ts`; `bun run typecheck`; contracts/adoption test set; release dry-run; packaged and registry-installed CLI smokes
- Manual checks: npm registry readback matched both locally packed tarball shasums/integrities and `latest=0.5.5`
- Supporting artifacts: `docs/verification/archctx-0.5.5-release.json`
- Implementation notes reviewed: yes
- Run snapshot: `.ai/harness/checks/latest.json`

## Manual Check Evidence

Copy each non-built-in contract `manual_checks` requirement exactly. Check it only after
the observation is complete and replace the placeholder with concrete command output,
screenshot/artifact path, or reviewer observation.

- No non-built-in manual checks are declared by the contract.

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

- `mode=adopt` applies ownership adoption and the exact approved semantic change atomically.
- Fixed-point reconstruction no longer reuses the single-use accepted reference.
- Embedded CLI runtime remains alive until asynchronous `projection` and `book` commands settle.

## Residual Risks / Follow-ups

- No provider-side blocker remains. Consumer pinning and orchestration are a separate repo-harness change.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 10/10 | Adoption plus semantic acceptance reaches a durable fixed point. |
| Product depth | 9/10 | Preserves recovery, refresh delivery, and exact approval binding. |
| Design quality | 10/10 | Smallest change at the provider-owned transaction boundary. |
| Code quality | 9/10 | Focused regression and full CLI coverage pass. |

## Failing Items

- None.

## Retest Steps

- Re-run: focused adoption regression and `bun run typecheck`.
- Re-check: `npm view archctx@0.5.5` and `npm view archctx-contracts@0.5.5` digests.

## Summary

- Pass. The root cause is fixed without relaxing validation or adding consumer-side inference, and the exact 0.5.5 artifacts are published and verified.
