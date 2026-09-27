# Task Review: linux-arm64-descriptor-flags

> **Status**: Scoped implementation accepted; hosted PR CI pending
> **Plan**: plans/plan-20260927-1318-linux-arm64-descriptor-flags.md
> **Contract**: tasks/contracts/20260927-1318-linux-arm64-descriptor-flags.contract.md
> **Notes File**: tasks/notes/20260927-1318-linux-arm64-descriptor-flags.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-27 13:29 +0800
> **Recommendation**: blocked-for-ship; scoped-pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: pending final PR head
> **Reviewed Subject Scope**: current isolated worktree, including source, focused CI and bugfix evidence
> **Reviewed Target Revision**: 331c526a560bc5d770df31ef941044ed98694c89

## Human Review Card

- Verdict: scoped PASS for the Linux flag fix; final merge remains blocked until the PR's Linux arm64 job and regular hosted Verify matrix pass.
- Change type: security-sensitive cross-architecture bugfix and focused CI coverage.
- Intended files changed: descriptor-relative writer, verify workflow, root-cause research, plan/contract/notes/review and pre-fix guard artifact.
- Actual files changed: inspect `git diff origin/main...HEAD` plus uncommitted workflow artifacts before PR publication.
- Commands passed: Mac pinned Bun typecheck and changeset tests; full `verify` 2,148/2,148 with eval PASS; Linux arm64 same guard failed before and passed after, full changeset 25/25; fixed cold tarball 7/7; contract 17/17.
- Residual risks: the new hosted ARM job has not yet run; npm publication is a separate action; current-main architecture projection has an unrelated model `responsibilities` error.
- Reviewer action required: check final PR-head CI, update this card and record the typed AcceptanceReceipt if the baseline architecture gate permits.
- Rollback: revert source/CI fix before npm publication.

## Mode Evidence

- Selected route: bugfix with pre-fix behavior evidence and a focused ARM runner.
- P1/P2/P3 evidence: `docs/researches/20260927-linux-arm64-descriptor-flags.md` and the active plan.
- Root cause: hard-coded x86_64 directory/no-follow flags are invalid on Linux arm64; platform-owned `fs.constants` values are used and validated before the native write.

## Verification Evidence

- `tasks/notes/20260927-1318-linux-arm64-descriptor-flags.pre-fix.txt`: real Linux arm64 guard failure and `PRE_FIX_EXIT=1`.
- Same guard after the fix: PASS on Linux arm64. The full changeset suite on that container passed 25/25, preserving symlink, expected-hash, private-mode and atomic-write assertions.
- Source-built 0.5.12 tarball in `_ops/npm/linux-open-fixed/`: dry-run verified; SHA-256 `354b683d122908305c45fcddff5a0c30e599480a18d97f4630f868d1e0001952` before final commit; cold Node 24 arm64 CLI/daemon/CodeGraph flow passed 7/7.
- Pinned Bun 1.4.0 on Mac: `bun run typecheck` passed; `bun run verify` exit 0 with 2,148 tests and configured eval verdict PASS.
- `repo-harness run verify-contract --contract tasks/contracts/20260927-1318-linux-arm64-descriptor-flags.contract.md --strict`: 17/17 Fulfilled with pinned Bun on PATH.
- Local architecture projection preflight rejects pre-existing `.archcontext/model/nodes/capability.architecture.context.yaml` because `responsibilities` is absent; this PR does not edit that model file. Hosted PR CI remains the release check for this scoped fix.

## Manual Check Evidence

No non-built-in manual checks are declared. The Linux arm64 cold-install matrix compared public 0.5.11, the narrow tag-based 0.5.12 candidate and merged-main 0.5.12 before the fix; only merged-main failed. The fixed source-built tarball then passed the same flow. No npm package was published.

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

- Summary: No typed AcceptanceReceipt is recorded before PR-head CI and the unrelated baseline architecture-model repair.
- Findings: no source-level regression in the scoped fix found by the independent read-only review; final hosted check pending.

## Behavior Diff Notes

- Linux `O_DIRECTORY` and `O_NOFOLLOW` come from Node's running-platform constants, with a fail-closed check when unavailable.
- Darwin numeric flags and Windows handle-based writer are unchanged.
- The focused `ubuntu-24.04-arm` job runs the existing 25-test behavior suite; no test is skipped from the existing matrix.

## Residual Risks / Follow-ups

- The publication agent must rebuild from the exact merged fix and repeat the cold installed-package test before registry release.
- The current-main architecture model's missing `responsibilities` field remains outside this bugfix.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 9/10 | Cold Linux arm64 flow now passes; hosted ARM check pending. |
| Product depth | 9/10 | Fixes the actual native boundary rather than masking its error. |
| Design quality | 9/10 | Two platform-owned constants and one fail-closed guard. |
| Code quality | 9/10 | ARM red/green plus Mac full verify; CI pending. |

## Failing Items

- No failing scoped local check. PR-head hosted Linux arm64 and regular Verify jobs have not run yet.

## Retest Steps

- Review the exact PR-head Linux arm64 descriptor job and regular Verify matrix.
- Rebuild from the merged commit and repeat the cold installed 7-check flow before npm publication.

## Summary

Scoped PASS; not yet merge-ready until hosted PR checks complete. The pre-existing architecture-model error is not introduced by this fix.
