# Task Review: data-engine-authority-incremental

> **Status**: DE0-DE2 Passed
> **Plan**: plans/plan-20260711-1328-data-engine-authority-incremental.md
> **Contract**: tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md
> **Notes File**: tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-07-11 17:40
> **Recommendation**: pass DE2; continue to DE3

## Human Review Card

- Verdict: pass for the bounded DE0 contract.
- Change type: code-change + migration + shared contract.
- Intended files changed: DE0 contract paths only; the contract Allowed Paths list
  was expanded only for migration/readback compatibility files required by full verify.
- Actual files changed: contracts/schemas, architecture delta/ledger, SQLite store,
  daemon HTTP/RPC, CLI, Explorer fixtures/tests, ADR, readback, and workflow artifacts.
- Commands passed: contract preflight; focused 394-test matrix; `bun run typecheck`;
  package-boundary audit; DE0 readback; `bun run verify` with 1030 tests.
- External acceptance: not applicable to this local data-engine phase.
- Residual risks: none inside DE0; DE1-DE5 remain deliberately open in the program plan.
- Rollback: revert the DE0 checkpoint commit; do not edit authoritative event history.

## Mode Evidence

- Selected route: `$check` Deep review with architecture and security specialists.
- Scope: on target. No new dependency, authority promotion, cloud sync, global search,
  or UI redesign entered the diff.
- P1/P2/P3 evidence: master plan sections `P1`, `P2`, and `P3`, plus ADR-0045.
- Root cause: bounded projection presence was being mislabeled as fact/evidence, while
  evidence history lacked explicit update/remove authority.

## Verification Evidence

- Waza `$check` run: Deep review, 5 findings, 5 fixed, 0 deferred.
- Architecture re-review: all five original findings fixed.
- Security re-review: both original HIGH findings fixed.
- Commands run:
  - `bun run typecheck`
  - `node scripts/package-boundary-audit.mjs`
  - focused DE0 test matrix: 394 pass, 0 fail
  - `bun run record:de0:data-engine`
  - `bun run readback:de0:data-engine`
  - `bun run verify`: 1030 pass, 0 fail
- Manual checks:
  - Budget displacement emits projection changes only.
  - Projection/event cursor mismatch fails with `projection-authority-mismatch`.
  - Missing and reversed cursors expose stable typed reason codes.
  - V2 lifecycle create/update/remove and tombstones replay deterministically.
  - New legacy evidence writer input is rejected at SQLite and TestLocalStore boundaries.
  - Delta V1 has no package, schema, daemon, HTTP/RPC, or CLI consumer.
- Supporting artifact: `docs/verification/data-engine-de0-readback.json` (PASS).
- Explorer readback: 10k p95 24.33ms; 100k p95 886.33ms; privacy PASS.

## Findings Closed

1. Projection was not bound to an exact authority event. Fixed by storing the full
   `AuthorityCursorV1` in cursor/manifest and exact cursor digest comparison in Delta.
2. Explorer used a legacy evidence shadow replay. Fixed by deriving bindings from
   `replayArchitectureLedgerEvidenceState`.
3. Active YAML writers still emitted legacy evidence arrays. Fixed by lifecycle diff
   compilation and append-boundary rejection of new legacy shapes.
4. ArchitectureEvent schema accepted empty lifecycle values and wrong versions. Fixed
   with local `$ref` validation, complete evidence schemas, and version-shape symmetry.
5. Old cached projection JSON could crash the V2 reader. Fixed by migration cleanup and
   fail-closed stored-projection shape validation.

## Behavior Diff Notes

- Fact changes compare replayed graph state at explicit authority cursors.
- Evidence changes compare the live lifecycle fold plus tombstones.
- Projection changes compare compatible complete manifests and cannot emit fact or
  evidence classes.
- Cached projections are cryptographically paired with the authority event used to
  build their graph/evidence/backlink inputs.
- Delta V2 is intentionally breaking; no digest-only V1 compatibility path remains.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 10/10 | All DE0 contract paths and negative cases pass. |
| Product depth | 9/10 | Authority, writer migration, cache upgrade, and caller migration closed together. |
| Design quality | 9/10 | Fact/evidence/projection ownership is explicit and fail closed. |
| Code quality | 9/10 | Pure comparisons, one lifecycle fold, typed schemas/reason codes, focused tests. |

## Failing Items

- None for DE0.

## Retest Steps

1. `bun run readback:de0:data-engine`
2. `bun run verify`
3. Inspect `docs/verification/data-engine-de0-readback.json` for `verdict: PASS`.

## Summary

DE0, DE1, and DE2 satisfy their bounded contracts. DE1 adds an atomic typed subject/feed
boundary, indexed backlinks, restart-safe feed consumption, and digest-only Explorer
invalidation; DE2 adds verified Snapshot V2 anchors and O(tail) normal replay without
promoting SQLite over Git-visible authority. The complete program is not done: DE3-DE5
remain unchecked and must land sequentially before final
merge/cleanup back to main.

## DE1 Acceptance Addendum

- Verdict: pass for `tasks/contracts/20260711-1605-data-engine-de1-change-feed.contract.md`.
- Readback: `docs/verification/data-engine-de1-readback.json` verdict PASS.
- Full verification: 1033 tests passed, 0 failed; Explorer/privacy/readback gates PASS.
- Atomicity/recovery: crash rollback exposes zero event/subject/feed rows; committed
  unread rows replay after restart; duplicate poll/ack remains idempotent and scoped.
- Integrity: poll checkpoints resolve to in-scope feed rows; backfill revalidates event
  sequence, scope, payload/provenance, event hash, and previous-hash chain; backlink
  digests bind logical event ID plus typed subjects.
- `$check`: 7 findings fixed, 0 deferred. The fixes cover old/new reference union,
  steady-state history replay removal, bounded backfill, durable completion marker,
  historical row/hash verification, cursor validation, and backlink ID integrity.
- At the DE1 gate, snapshot-anchored replay remained open by design; it is now closed
  by the DE2 addendum below. No DE1 finding or failing check remains.

## DE2 Acceptance Addendum

- Verdict: pass for `tasks/contracts/20260711-1720-data-engine-de2-snapshot-replay.contract.md`.
- Readback: `docs/verification/data-engine-de2-readback.json` verdict PASS; focused
  matrix: 384 pass, 0 fail.
- Full verification: 1038 tests passed, 0 failed; Explorer 10k p95 23.55ms and 100k
  p95 537.81ms; privacy and acceptance gates PASS.
- Authority: snapshot creation independently replays genesis, compares materialized
  graph/evidence, applies privacy guards, and builds only from verified replay state.
- Restore: explicit snapshot refs verify in anchored and genesis modes; automatic
  selection uses the newest in-scope V2 anchor at or before target and reads only tail.
- Cost: cursor eventCount binds the transactionally maintained scoped event count;
  tail counts advance strictly and hot replay uses anchor count plus tail length.
- Integrity: typed event row/JSON/hash, logical target ID, complete snapshot row,
  cursor, scope, body, evidence/tombstone, and compact anchor all fail closed.
- `$check`: eight unique findings fixed, 0 deferred; architecture and security re-review
  both pass.
- Residual scope: cache manifest ownership and required-domain hardening remain DE3;
  no DE2 finding or failing check remains.
