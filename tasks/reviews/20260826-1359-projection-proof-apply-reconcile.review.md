# Task Review: projection-proof-apply-reconcile

> **Status**: Passed
> **Plan**: plans/plan-20260826-1359-projection-proof-apply-reconcile.md
> **Contract**: tasks/contracts/20260826-1359-projection-proof-apply-reconcile.contract.md
> **Notes File**: tasks/notes/20260826-1359-projection-proof-apply-reconcile.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-08-26 17:01
> **Recommendation**: pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: sha256:8c015580f1e0507be1e44e9b5511fee337e23a0d66994b3317bde890db5be696
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 7a795e90def4c2e91ca21d48d0dc5ed8a097205a

## Human Review Card

- Verdict: pass through the exact-subject external AcceptanceReceipt.
- Change type: code-change and SQLite migration
- Intended files changed: exact selector proof, projection-result/v2, durable apply receipt persistence/reconcile, CLI/daemon plumbing, migration/readback fixtures, and bounded workflow evidence.
- Actual files changed: 21 reviewed product/schema/test/readback paths plus workflow artifacts, all inside `allowed_paths`.
- Commands passed: all ten contract criteria, Change Assessment with deterministic/runtime oracles, final receipt verification, and downstream provider integration acceptance.
- Residual risks: AXR3 remains revision-pin blocked on this checkout and main; release/CI must provide the real `codegraph` binary.
- Reviewer action required: none.
- Rollback: revert the two behavior commits before publication; after publication, issue a forward patch because v2 has no compatibility fallback.

## Mode Evidence

- Selected route: structured-index exact proof plus ChangeSet-bound durable acknowledgement/reconcile.
- P1/P2/P3 evidence: P1 maps CodeGraph adapter → semantic compiler and CLI projection → SQLite receipt store → daemon/result boundary. P2 traces exact source/sink proof and accepted write → post-check race → receipt → retry signal → no-op. P3 preserves fail-closed negative/ambiguous proof, concurrent mutation visibility, Human authority, and exactly-once delivery.
- Root cause or plan evidence: whole-symbol display truncation was incorrectly reused as selector completeness; committed projection apply lacked durable acknowledgement state.

## Verification Evidence

- Waza `/check` run: Claude gatekeeper completed the repair review; the resulting external pass is recorded below.
- Commands run: exact `commands_succeed` entries in the contract plus final `repo-harness run verify-sprint` receipt verification.
- Manual checks: repo-harness accepted tarball SHA-256 `16fa6ba0c9b61f3f1dabc6bcfc5961ebccf243a591f737bffc988c94b866556b` through its provider path.
- Supporting artifacts: `.ai/harness/checks/latest.json`, AL10 release-packaging readback, pinned semantic evidence, and the typed AcceptanceReceipt.
- Implementation notes reviewed: `tasks/notes/20260826-1359-projection-proof-apply-reconcile.notes.md`.
- Run snapshot: `.ai/harness/runs/run-20260826T170100-70176-20260826-1359-projection-proof-apply-reconcile.json`.

## Manual Check Evidence

Copy each non-built-in contract `manual_checks` requirement exactly. Check it only after
the observation is complete and replace the placeholder with concrete command output,
screenshot/artifact path, or reviewer observation.

- Not applicable: the contract declares no non-built-in `manual_checks`.

## Acceptance Receipt Projection

> **Disposition**: external_pass
> **Reviewer**: Claude
> **Source**: claude-review
> **Actor**: not-applicable
> **Reviewed Subject SHA256**: sha256:8c015580f1e0507be1e44e9b5511fee337e23a0d66994b3317bde890db5be696
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 7a795e90def4c2e91ca21d48d0dc5ed8a097205a
> **Verification Evidence SHA256**: sha256:a5ac53b694835e28ad372408c05c847bca6aa9f37012aefc650d978524b73b53
> **Issued At**: 2026-08-26T09:01:29.932Z

- Summary: Claude gatekeeper passed the repaired exact-selector and projection-result/v2 implementation; repo-harness independently accepted the packed provider integration, with no contract-field gap or blocking finding.
- Findings: none

## Behavior Diff Notes

- Unique exact selector proof is stable under unrelated fanout; missing/ambiguous evidence remains fail-closed and call sites use source semantics.
- Committed post-check races return `applied-reconcile-required`; retry is write/acceptance-idempotent, consumes refresh exactly once, then returns no-op.
- Pre-write stale snapshots remain ordinary fail-closed failures with no receipt.

## Residual Risks / Follow-ups

- AXR3 pin mismatch is intentionally retained as visible non-blocking evidence; do not relax it.
- CI/release images must include `codegraph` for the real-index integration test.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 10/10 | Both upstream issues and negative/idempotency cases passed downstream acceptance. |
| Product depth | 10/10 | The protocol represents failure, reconcile-required commit, and reconciled no-op distinctly. |
| Design quality | 9/10 | Evidence and acknowledgement authority are explicit with no semantic fallback. |
| Code quality | 9/10 | Contracts, migration, real-index test, and readbacks cover cross-module invariants. |

## Failing Items

- None blocking.

## Retest Steps

- Re-run: `repo-harness run verify-sprint --prepare-acceptance --contract tasks/contracts/20260826-1359-projection-proof-apply-reconcile.contract.md`.
- Re-check: `repo-harness run acceptance-receipt -- verify --contract tasks/contracts/20260826-1359-projection-proof-apply-reconcile.contract.md --verification .ai/harness/checks/latest.json`.

## Summary

- Exact selector proof and projection-result/v2 durable reconciliation satisfy the ArchContext handoff and repo-harness provider acceptance. Ready for the 0.4.5 release cut.
