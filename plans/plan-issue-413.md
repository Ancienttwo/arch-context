# Issue 413: Reject invalid ChangeSet bases with actionable diagnostics

Status: Review

## Authorization

The user approved continued issue cleanup on 2026-10-27. This slice fixes the
confirmed plan/apply mismatch in #413, with GitHub CI, review and merge. Baseline:
main `5dc25c88`. #412 is validated separately before the final base is frozen.

## Task Breakdown

- [x] Reject blocking base validation before storing a plan, using the same repair-aware rule as apply.
- [x] Project bounded path/code diagnostics from validation-owned metadata; omit raw error bodies and explicitly count unavailable diagnostics.
- [x] Make plan/apply/ledger refusals non-retryable with repair-model guidance.
- [x] Verify real production composition before/after ADR repair, metadata budgets/privacy, and existing repair exceptions.
- [ ] Complete independent review, publish a PR and merge only after GitHub CI succeeds.

## Boundaries

No user model/ledger repair, release, deployment or service administration. The
validation authority supplies diagnostic paths/codes; consumers never parse error
text to invent them. Existing ADR/node/manifest repair exemptions remain intact.
Unknown validation errors stay blocking with an explicit omitted diagnostic count.

## Verification

The production-composition regression failed before the repair. The focused CLI,
contracts and ledger metadata checks passed; project/rollback refusal and existing
ADR/node-restoration and manifest-layer repair guards also passed. The final
four contract tests passed 13 assertions, including escaped-path byte budgets.
Independent read-only tests-and-implementation review passed. Full verification
runs in GitHub CI, against pinned #412 head `85c66626`; after that parent lands,
retarget only if the main model/source tree is identical to that verified base.
