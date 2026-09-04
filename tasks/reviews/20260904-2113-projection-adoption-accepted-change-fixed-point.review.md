# Task Review: projection-adoption-accepted-change-fixed-point

> **Status**: Complete
> **Plan**: plans/plan-20260904-2113-projection-adoption-accepted-change-fixed-point.md
> **Contract**: tasks/contracts/20260904-2113-projection-adoption-accepted-change-fixed-point.contract.md
> **Notes File**: tasks/notes/20260904-2113-projection-adoption-accepted-change-fixed-point.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-04 22:00
> **Recommendation**: pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: pending
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: pending

## Human Review Card

- Verdict: pass
- Change type: code-change
- Intended files changed: provider adoption fixed-point, CLI regression, current package/release authorities, and workflow evidence
- Actual files changed: contract allowed paths; the branch also carries the separately verified live `refactor record` response-identity fix released in the same 0.5.6 pair
- Commands passed: focused adoption regression, full CLI suite, contracts/adoption tests, typecheck, release lifecycle checks, packaged smoke, registry-installed capabilities smoke, registry readback
- Residual risks: npm registry propagation was eventually consistent; the final readback matches both exact 0.5.6 package identities and `latest`
- Reviewer action required: none
- Rollback: revert the provider/release commits together and leave consumers on the prior exact pin

## Mode Evidence

- Selected route: bugfix
- P1/P2/P3 evidence: CLI `projection adopt` enters `runArchitectureDocsAdoptionCommand`, crosses projection simulation and daemon commit, and terminates in durable apply receipt plus refresh delivery; the invariant is one accepted reference consumed once in one transaction.
- Root cause or plan evidence: `docs/verification/20260904-projection-adoption-accepted-change-fixed-point-pre-fix.txt` and the contract Root Cause Evidence

## Verification Evidence

- Waza `/check` run: focused and full release checks passed
- Commands run: full CLI suite; focused adoption regression; `bun run typecheck`; release lifecycle and packaged CLI smokes
- Manual checks: npm registry readback matched `archctx@0.5.6`, `archctx-contracts@0.5.6`, and both `latest` tags
- Supporting artifacts: `docs/verification/archctx-0.5.6-release.json`
- Implementation notes reviewed: yes
- Run snapshot: `.ai/harness/checks/latest.json`

## Manual Check Evidence

Copy each non-built-in contract `manual_checks` requirement exactly. Check it only after
the observation is complete and replace the placeholder with concrete command output,
screenshot/artifact path, or reviewer observation.

- [ ] Exact manual_checks requirement
  - Evidence: concrete observation, command output, screenshot path, or reviewer note

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
- Re-check: exact npm 0.5.6 digests and dist-tags.

## Summary

- Pass. The root cause is fixed without relaxing validation or adding consumer-side inference, and the exact 0.5.6 artifacts are published and verified.
