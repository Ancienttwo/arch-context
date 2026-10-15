# Plan: reuse Linux full verification for Governance

> **Status**: Review
> **Owner**: delegated Codex sole writer
> **Base**: be19d8ec1fb8767a2edff4de92188f43557cb958
> **Task Contract**: tasks/contracts/20261015-1200-ci-governance-dedup.contract.md
> **Task Review**: tasks/reviews/20261015-1200-ci-governance-dedup.review.md
> **Implementation Notes**: tasks/notes/20261015-1200-ci-governance-dedup.notes.md

## Approved scope

User approved the coordinator's independent CI deduplication proposal. Extract the existing ubuntu-latest / Node22.22.x full worker without changing its commands or20-minute budget. Preserve the Governance Verify name and15-minute budget. Governance consumes provider-confirmed current-run/current-attempt success, bound to the same source HEAD and actual checkout, before the original23 inspections. Local verify:governance remains full verify plus23. Manual dispatch executes only the shared Linux full worker and Governance. Keep contents:read, all nine target verdicts, existing ledger conditions and exact inspection ordering. Missing, failed, skipped, cancelled, duplicate, stale or mismatched prerequisite evidence refuses before inspections. No user boolean or artifact grants success.

PR360's clean8272951e worktree is isolated. Its ordinary push still waits for run38724679198 terminal; its merge additionally needs the coordinator's exact-new-HEAD independent review and all CI gates. No product change, dependency, timeout, skip or release operation belongs to this CI PR.

## Task Breakdown

- [x] Read rules/current CI and create independent worktree from latest main.
- [x] Add deterministic negative/positive prerequisite and command-order regressions.
- [x] Extract the Linux full worker and implement the hosted inspection gate.
- [x] Verify complete affected test files, syntax/type and unchanged command/permission/coverage invariants.
- [x] Complete one independent read-only review, repair confirmed findings.
- [x] Prepare the exact verified patch and independent review for ordinary branch publication as one Draft PR.
- [ ] Receive hosted CI and coordinator acceptance before any main integration; publication readback is retained in the operations delivery record.

## Verification

Run bun test --timeout60000 on both complete CI workflow test files, bun run typecheck, and focused Node syntax checks. Test the real local/CI command selection, original23 arguments/ledger skip/failure propagation, nine-target collector missing/duplicate/non-success/head/run/attempt refusals, actual-checkout/source-head distinction, malformed/missing provider evidence, manual-only two-job path and unchanged budgets/contents:read. No full-root repeat just to seek green; hosted Draft PR supplies the actual matrix evidence.
