# Implementation Notes: projection-proof-apply-reconcile

> **Status**: Active
> **Plan**: plans/plan-20260826-1359-projection-proof-apply-reconcile.md
> **Contract**: tasks/contracts/20260826-1359-projection-proof-apply-reconcile.contract.md
> **Review**: tasks/reviews/20260826-1359-projection-proof-apply-reconcile.review.md
> **Last Updated**: 2026-08-26 17:01
> **Lifecycle**: notes

## Design Decisions

- Exact selector proof comes from structured CodeGraph node/edge identity, not the capped human display. A complete unique positive match remains proven while truncated negative search remains unprovable and multiple identities remain ambiguous.
- `ProjectionResultV2` separates pre-write failure from committed-but-unacknowledged apply. The durable receipt binds ChangeSet commit identity, owned-path pre/post digests, and the original refresh signals.
- Reconcile is keyed by durable apply identity: retry performs no second owned write or Human acceptance, returns the original refresh signal exactly once, and later returns no-op.
- The producer, schemas, fixtures, CLI, daemon, and store move atomically to v2. No v1 compatibility fallback or concurrent-mutation suppression is present.

## Deviations From Plan Or Spec

- The original contract placed package test files under `tests_pass`, but the current verifier requires a package-local `scripts.test`; these packages intentionally delegate testing to the root. The same deterministic scopes are therefore recorded as explicit `commands_succeed` entries.
- `verify:axr3-semantic-pilot` remains visibly blocked because its repo-harness fixture pins revision `1eaf6301` while the local checkout is `2df3a38e`; main has the same mismatch. The pin was not weakened.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Raise CodeGraph display limits | Rejected | Display capacity is not evidence completeness. |
| Ignore post-write snapshot mismatch | Rejected | Concurrent non-owned mutation must remain visible. |
| Add projection-result/v1 fallback | Rejected | The shared contract intentionally cuts over atomically and fails closed. |

## Open Questions

- None. repo-harness confirmed the v2 fields are sufficient for provider reconciliation.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Final prepared run: `.ai/harness/runs/run-20260826T170100-70176-20260826-1359-projection-proof-apply-reconcile.json`
- Downstream acceptance tarball SHA-256: `16fa6ba0c9b61f3f1dabc6bcfc5961ebccf243a591f737bffc988c94b866556b`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- None. The reusable invariants are encoded in contracts, migration, receipt storage, and regression tests.
