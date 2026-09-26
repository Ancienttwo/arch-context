# Task Review: archctx-0512-rpc-integration

> **Status**: Pending PR CI and baseline architecture repair
> **Plan**: plans/plan-20260927-0329-archctx-0512-rpc-integration.md
> **Contract**: tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md
> **Notes File**: tasks/notes/20260927-0329-archctx-0512-rpc-integration.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-27 03:36 +0800
> **Recommendation**: blocked
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: pending final PR head
> **Reviewed Subject Scope**: current-main release integration
> **Reviewed Target Revision**: b4976adc1ff6750883cc45fd8c1fc5f3166f4f00

## Human Review Card

- Verdict: version integration appears correct; ship remains blocked until PR #227 checks and the current-main architecture model gate pass.
- Change type: release metadata and documentation.
- Intended files changed: product/package versions, lockfile, fixtures, catalog digest, runner examples/action, release research, plan/contract/notes/review.
- Actual files changed: see `git diff origin/main...HEAD` plus the workflow artifacts in this branch.
- Commands passed: pinned Bun full `verify` (2,022/2,022), contract 9/9, npm dry-run, installed tarball smoke, typecheck and RPC client tests.
- Residual risks: PR #223 overlaps four version files and owns the existing invalid architecture capability ID; npm publication belongs to another agent.
- Reviewer action required: re-review final PR head and CI after baseline architecture model repair, then record typed AcceptanceReceipt.
- Rollback: revert the version integration before npm publication.

## Mode Evidence

- Selected route: current-main version integration after the source fix was already merged as #180.
- P1/P2/P3 evidence: `docs/researches/20260927-rpc-keepalive-hotfix-0512.md` and the active plan.
- Root cause or plan evidence: the published 0.5.10/0.5.11 tarballs omit the merged `Connection: close` fix; the integration aligns all current-main release anchors to 0.5.12 without publishing.

## Verification Evidence

- Full pinned Bun `verify`: `/tmp/archctx-main-0512-verify.log`, exit 0, 2,022 tests and configured eval verdict PASS.
- `repo-harness run verify-contract --contract tasks/contracts/20260927-0329-archctx-0512-rpc-integration.contract.md --strict`: 9/9 Fulfilled.
- `_ops/npm/main-0512/evidence.json`: release dry-run `verified`, no failures.
- `/tmp/archctx-main-0512-smoke.log`: installed CLI and daemon smoke exit 0, version 0.5.12.
- `repo-harness architecture-projection plan --json` is blocked by current main's existing `.archcontext/model/nodes/capability.architecture-context.yaml` ID `capability.architecture-context`. This branch does not edit that file; draft #223 owns it.
- PR #227 first hosted Governance Verify failed because the recorded no-provider `modelDigest` was stale after the 0.5.12 version change. The official FG4/FG6 generators refreshed only the evidence timestamps and digest; local `bun run verify:governance` passed. Hosted CI must run again on the new head.

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

- Summary: No typed AcceptanceReceipt has been recorded while the baseline architecture gate and PR CI remain open.
- Findings: no product-diff defect observed; ship gate not met.

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
| Code quality | 9/10 | Full verification passed; CI and baseline gate pending. |

## Failing Items

- Current-main architecture projection rejects pre-existing `capability.architecture-context` ID.
- PR #227 requires a new hosted CI run on the regenerated evidence head; the first head's Governance Verify failed on stale evidence.

## Retest Steps

- Rebase on main after the model fix lands, then run `repo-harness architecture-projection plan --json` and `repo-harness run verify-sprint --prepare-acceptance`.
- Verify PR #227 checks on the final head, record AcceptanceReceipt, run final `verify-sprint`, then merge.

## Summary

BLOCKED for merge at this snapshot. The scoped 0.5.12 version integration is locally verified; the remaining gates are CI and the pre-existing architecture model repair.
