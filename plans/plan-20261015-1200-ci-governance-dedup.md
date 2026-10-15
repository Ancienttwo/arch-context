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
- [x] Fresh-read #362 exact head/base/threads/provider43of43success, Ready+squash, confirm358 remains open.
- [x] Fetch accepted main and ordinary merge into clean PR361 without changing any CI logic.
- [x] Install this worktree's own frozen1.6.2 dependencies; verify complete affected CI files, types, syntax, exact Linux22full/manual and23inspection invariants.
- [x] Refresh only required projection stamps through public docs apply and actual AL9 record/readback; complete bounded composition acceptance and prepare ordinary push with provider readback retained in operations.
- [ ] Receive new exact-head hosted CI and coordinator readback before any PR361 merge.

## Verification

Run bun test --timeout60000 on both complete CI workflow test files, bun run typecheck, and focused Node syntax checks. Test the real local/CI command selection, original23 arguments/ledger skip/failure propagation, nine-target collector missing/duplicate/non-success/head/run/attempt refusals, actual-checkout/source-head distinction, malformed/missing provider evidence, manual-only two-job path and unchanged budgets/contents:read. No full-root repeat just to seek green; hosted Draft PR supplies the actual matrix evidence.

## Accepted main integration after #362

Coordinator explicitly authorized ordinary merge of accepted main e18e0428b9dc51aa4ecf30fafd76def3f7cff27b into this existing PR361 branch after #362 Ready+squash. Local merge e7928b24d7e45a37f7ef5b70d6f3852a2eede936 has parents b3875dc83bfae7d141292e7fe0da0aca96d42c30 and e18e0428b9dc51aa4ecf30fafd76def3f7cff27b; all5CI implementation/test files are byte-identical to the independently reviewed b387 source. Main's exact1.6.2 dependency/contracts/fixtures and accepted DNT/AL9 fixes arrive only through this normal merge. No new CodeGraph implementation or runtime replacement is introduced here.


PR363 remains the existing Claude writer's responsibility. Shared CI files must be semantically integrated serially under coordinator owner alignment; this task does not adopt or duplicate its Windows sharding work. Root does not rerun/cancel/dispatch CI or change budgets/permissions/skips. A shorter old-bundle runtime is a possibility to measure, not a pre-asserted outcome.
