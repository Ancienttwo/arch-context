# Task Review: fix-111-descriptor-relative

> **Status**: Accepted
> **Plan**: plans/plan-20260903-0008-fix-111-descriptor-relative.md
> **Contract**: tasks/contracts/20260903-0008-fix-111-descriptor-relative.contract.md
> **Notes File**: tasks/notes/20260903-0008-fix-111-descriptor-relative.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-03 00:08
> **Recommendation**: pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: sha256:1ec2e44da07761fa5d9c39c02314a2b48936d354e7efc76c2f7289201a45b0a6
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 24071f3401841cbb532ace89e2a53505b4ac5a36

## Human Review Card

- Verdict: implementation and local verification pass; typed acceptance and hosted OS matrix remain pending.
- Change type: code-change
- Intended files changed: changeset write boundary, focused regression, exact native dependency, one-product packaging projection, and workflow artifacts.
- Actual files changed: matches the contract allowlist.
- Commands passed: focused no-follow suite, typecheck, package boundary audit, Node-only tarball lifecycle/docs-pin smoke, root verify, strict task workflow, and diff check.
- Residual risks: Windows handle-pinning semantics require hosted Windows confirmation; a POSIX parent moved after the final pre-commit identity check cannot redirect outside but may cause a post-commit identity error after writing only into the pinned original directory.
- Reviewer action required: freeze the final subject, issue the typed AcceptanceReceipt, and require exact-head hosted Verify before merge.
- Rollback: revert the single work-package merge; no migration or external data mutation exists.

## Mode Evidence

- Selected route: regression-first security hardening in an isolated worktree.
- P1/P2/P3 evidence: captured in the approved plan and implementation notes.
- Root cause or plan evidence: contract Root Cause Evidence and pre-fix failure artifact.

## Verification Evidence

- Waza `/check` run: not invoked; no explicit request.
- Commands run: listed in the Human Review Card and implementation notes.
- Manual checks: Koffi 3.1.6 loaded under Bun 1.4.0 and Node 26 locally; packaged Node-only approved docs pin exercised the actual native write boundary.
- Supporting artifacts: pre-fix failure artifact, full verify output, and tarball smoke output.
- Implementation notes reviewed: yes.
- Run snapshot: pending final `verify-sprint --prepare-acceptance`.

## Manual Check Evidence

Copy each non-built-in contract `manual_checks` requirement exactly. Check it only after
the observation is complete and replace the placeholder with concrete command output,
screenshot/artifact path, or reviewer observation.

- No contract `manual_checks` requirements.

## Acceptance Receipt Projection

> **Disposition**: external_pass
> **Reviewer**: Codex
> **Source**: codex-review
> **Actor**: not-applicable
> **Reviewed Subject SHA256**: sha256:1ec2e44da07761fa5d9c39c02314a2b48936d354e7efc76c2f7289201a45b0a6
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 24071f3401841cbb532ace89e2a53505b4ac5a36
> **Verification Evidence SHA256**: sha256:6ac6b1a91b52fe0bf41b92eecebfba71d62bcc65497a84c7e13c8f9f49fa8389
> **Issued At**: 2026-09-02T16:54:22.066Z

- Summary: Descriptor-relative POSIX writes and Windows parent-handle pinning close the named concurrent parent-to-symlink redirection; focused, packaged Node-only, and full local verification pass.
- Findings: P2: Hosted Windows remains the authoritative confirmation of CreateFileW marshalling and no-FILE_SHARE_DELETE behavior; merge remains gated on the exact-head CI matrix.

## Behavior Diff Notes

- Parent replacement after validation changes from an outside-directed successful write to a fail-closed result with the outside target byte-for-byte unchanged.
- Static/dangling symlink rejection, expected-hash checks, atomic rename, private mode, and durability remain intact.
- The installed Node-only CLI now proves the native dependency is present by executing an approved Context7 docs pin.

## Residual Risks / Follow-ups

- Hosted Windows is the authoritative proof for `CreateFileW` structure marshalling and sharing semantics; merge is blocked until that matrix passes.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | pass | Named concurrent parent replacement no longer reaches the outside target. |
| Product depth | pass | Release packaging and the real Context7 runtime path are covered. |
| Design quality | pass | One native authority; no pathname fallback on POSIX and no custom addon release surface. |
| Code quality | pass | Focused and full deterministic gates pass locally. |

## Failing Items

- Typed AcceptanceReceipt and exact-head hosted Verify are not yet present.

## Retest Steps

- Re-run: commands under contract Exit Criteria.
- Re-check: exact PR head on Linux/macOS/Windows Node 22.22/24/25 and outside-target invariance.

## Summary

- Local evidence supports accepting #111 once the hosted matrix confirms the Windows native branch and the typed receipt binds the final subject.
