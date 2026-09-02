# Task Review: audit-residuals-108-117-remediation

> **Status**: Accepted
> **Plan**: plans/plan-20260902-2222-audit-residuals-108-117-remediation.md
> **Contract**: tasks/contracts/20260902-2222-audit-residuals-108-117-remediation.contract.md
> **Notes File**: tasks/notes/20260902-2222-audit-residuals-108-117-remediation.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-09-02 22:42
> **Recommendation**: pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: sha256:a1166f00579432e7f66a1167277f810d74cbce553d453b6d7cab83112f4090ac
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 961f965b18d2196fdc3950082414f82b4bf47b29

## Human Review Card

- Verdict: implementation and local verification pass; typed acceptance receipt remains pending.
- Change type: code-change
- Intended files changed: runtime-daemon, local-store-sqlite, CLI cleanup call sites, one existing negative-matrix script, focused tests, and task artifacts.
- Actual files changed: matches intended scope; no source outside the contract allowlist.
- Commands passed: focused 29-test run, affected 323-test run, `bun run typecheck`, root 1304-test run, and `git diff --check`.
- Residual risks: #111 remains conditional against a malicious same-UID concurrent parent-directory swap; absolute closure needs a separately approved native descriptor-relative filesystem contract.
- Reviewer action required: inspect the corrected eight-path subject `sha256:a1166f00579432e7f66a1167277f810d74cbce553d453b6d7cab83112f4090ac` and issue a typed AcceptanceReceipt or explicit waiver.
- Rollback: revert this isolated candidate; it has no migration, deployment, or external state mutation.

## Mode Evidence

- Selected route: regression-first main-thread implementation in an isolated worktree.
- P1/P2/P3 evidence: recorded in the plan Agentic Routing section and implementation notes.
- Root cause or plan evidence: contract Root Cause Evidence plus the captured pre-fix failure artifact.

## Verification Evidence

- Waza `/check` run: not invoked; no matching explicit request.
- Commands run: see Human Review Card and implementation notes.
- Manual checks: macOS descriptor-path probe returned `ENOENT`; no cross-platform `openat`/`renameat` helper exists in the repository.
- Supporting artifacts: pre-fix log and post-fix test output summarized in implementation notes.
- Implementation notes reviewed: yes.
- Run snapshot: `.ai/harness/runs/run-20260902T231400-44859-20260902-2222-audit-residuals-108-117-remediation.json`; deterministic criteria and corrected Change Assessment pass.

## Manual Check Evidence

Copy each non-built-in contract `manual_checks` requirement exactly. Check it only after
the observation is complete and replace the placeholder with concrete command output,
screenshot/artifact path, or reviewer observation.

- No contract `manual_checks` requirements.

## Acceptance Receipt Projection

> **Disposition**: external_pass
> **Reviewer**: Claude
> **Source**: claude-review
> **Actor**: not-applicable
> **Reviewed Subject SHA256**: sha256:a1166f00579432e7f66a1167277f810d74cbce553d453b6d7cab83112f4090ac
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 961f965b18d2196fdc3950082414f82b4bf47b29
> **Verification Evidence SHA256**: sha256:c1ead155937ae3ff95960c35332c91ff524c283ba7b579ec875ef6690dfa5280
> **Issued At**: 2026-09-02T15:30:58.922Z

- Summary: Independent Claude review found no P1; deterministic verification and corrected eight-path Change Assessment pass. Six P2 residuals are recorded for follow-up.
- Findings: P2: restoreLandscape reloads only landscape.local while public loadLandscape can persist another active landscape id.; P2: Developer Review recovery rejects a daemon-owned manifest when its lock file is missing, which can leave a challenge unavailable until manual repair.; P2: An invalid persisted landscape fails daemon startup without a daemon-accessible repair path.; P2: Bearer DLP detection now requires authorization context and deliberately permits a bare Bearer token-shaped value.; P2: deleteRepositorySession remains as a second unused deletion API after commitRepositoryRemoval became the repoRemove authority.; P2: The new cleanup identity-mismatch RPC rejection path lacks a direct regression test.

## Behavior Diff Notes

- Authenticated cleanup callers can no longer submit deletion paths; they submit identity and the daemon rehydrates its own authority.
- Restarted daemons now restore persisted landscape state, and repository removal is durable and atomic across the session/landscape pair.
- Secret preflight catches fine-grained and refresh-token GitHub prefixes while allowing benign Bearer terminology.

## Residual Risks / Follow-ups

- #111 is not upgraded to an unconditional guarantee. The existing static symlink guards pass, but a malicious same-UID concurrent parent swap remains outside the standard runtime's provable boundary.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | pass | Exact regressions and root suite pass. |
| Product depth | pass | Authority and durability defects are fixed at their owning layers. |
| Design quality | pass | One public identity shape; one durable transaction; no fallback. |
| Code quality | pass | Typecheck and 1304-test suite pass. |

## Failing Items

- Typed acceptance receipt is not yet present; verification and deterministic Change Assessment are frozen and ready for semantic review.

## Retest Steps

- Re-run: contract commands in order.
- Re-check: frozen diff fingerprint and bounded #111 residual wording.

## Summary

- Local implementation evidence supports accepting #108, #113, and #117. #111 remains conditional by design; no push, PR, publish, release, or deployment occurred.
