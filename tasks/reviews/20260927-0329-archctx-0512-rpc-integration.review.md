# Task Review: archctx-0512-rpc-integration

> **Status**: Accepted for version PR merge; pre-existing architecture drift delegated to #223
> **Plan**: plans/plan-20260927-0329-archctx-0512-rpc-integration.md
> **Contract**: tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md
> **Notes File**: tasks/notes/20260927-0329-archctx-0512-rpc-integration.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-27 04:50 +0800
> **Recommendation**: pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: sha256:49ea0a72654b8ad7a5a1f19274e125114acc5b2f427db3a7b988008e476cd8b0
> **Reviewed Subject Scope**: normalized current-main release integration, excluding this review record
> **Reviewed Target Revision**: b706b6bcf3fd02daa1f2df3344d12c07cfa0d686

## Human Review Card

- Verdict: PASS for this PR's version integration and hosted checks; the current-main architecture model ID remains a separate #223 repair.
- Change type: release metadata and documentation.
- Intended files changed: product/package versions, lockfile, fixtures, catalog digest, runner examples/action, release research, plan/contract/notes/review.
- Actual files changed: see `git diff origin/main...HEAD` plus the workflow artifacts in this branch.
- Commands passed: pinned Bun full `verify` (2,022/2,022), contract 11/11, npm dry-run, installed tarball smoke, typecheck and RPC client tests; PR-head hosted Verify 10/10 successful.
- Residual risks: PR #223 overlaps four version files and owns the existing invalid architecture capability ID; npm publication belongs to another agent.
- Reviewer action required: orchestrator confirms the existing model-ID issue is owned by #223 and merges this already-green PR; publication is separate.
- Rollback: revert the version integration before npm publication.

## Mode Evidence

- Selected route: current-main version integration after the source fix was already merged as #180.
- P1/P2/P3 evidence: `docs/researches/20260927-rpc-keepalive-hotfix-0512.md` and the active plan.
- Root cause or plan evidence: the published 0.5.10/0.5.11 tarballs omit the merged `Connection: close` fix; the integration aligns all current-main release anchors to 0.5.12 without publishing.

## Verification Evidence

- Full pinned Bun `verify`: `/tmp/archctx-main-0512-verify.log`, exit 0, 2,022 tests and configured eval verdict PASS.
- `repo-harness run verify-contract --contract tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md --strict`: 11/11 Fulfilled.
- `_ops/npm/main-0512/evidence.json`: release dry-run `verified`, no failures.
- `/tmp/archctx-main-0512-smoke.log`: installed CLI and daemon smoke exit 0, version 0.5.12.
- `repo-harness architecture-projection plan --json` is blocked by current main's existing `.archcontext/model/nodes/capability.architecture-context.yaml` ID `capability.architecture-context`. This branch does not edit that file; draft #223 owns it.
- PR #227 first hosted Governance Verify found stale no-provider evidence, refreshed by official FG4/FG6 generators. The second hosted run hit the prior 20-minute Windows/Node 25 job limit; the matrix limit was raised to 30 minutes without skipping tests. Final PR head `b706b6b` completed all 10 required hosted Verify checks successfully; GitHub reports `mergeStateStatus: CLEAN`.

## Manual Check Evidence

No non-built-in manual checks are declared in this contract. Registry readback confirms neither `archctx@0.5.12` nor `archctx-contracts@0.5.12` is published.

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

- Summary: No typed AcceptanceReceipt can be recorded through local `verify-sprint` while current main's existing architecture capability ID fails the projection preflight. The exact baseline repair belongs to #223; hosted PR CI and scoped contract evidence are green.
- Findings: no product-diff defect observed; pre-existing local projection gate remains outside this PR.

## Behavior Diff Notes

- Main already sends `Connection: close` for loopback RPCs and tests distinct connections. This PR changes package/release identity only.
- `@archcontext/contracts` source remains `private: true`; the release stage emits the public package.
- Main-based tarball hashes differ from the separate tag-based hotfix candidate. Publisher must rebuild from the exact merged main.

## Residual Risks / Follow-ups

- The baseline architecture model ID and PR #223 merge order remain outside this PR's scope.
- Publication agent must perform fresh exact-source pack, registry auth, publish and readback, then update `repo-harness`'s exact dependency closure.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 9/10 | All version anchors and installed runtime identity align locally. |
| Product depth | 9/10 | Exact-source publication boundary is recorded. |
| Design quality | 9/10 | No new transport abstraction; main fix reused. |
| Code quality | 9/10 | Full verification and all hosted checks passed; baseline model repair remains in #223. |

## Failing Items

- No failing check on #227's final product head. Current-main architecture projection still rejects pre-existing `capability.architecture-context` ID; #223 owns that repair.

## Retest Steps

- Recheck PR #227 head/base and hosted checks immediately before merge.
- After #223 repairs the baseline model, rerun `repo-harness architecture-projection plan --json` and `repo-harness run verify-sprint --prepare-acceptance` for the wider program.

## Summary

PASS for the scoped 0.5.12 version integration. User authorized merging after review; hosted CI is green. The baseline architecture model repair and npm publication remain separate work.
