# Implementation Notes: data-engine-authority-incremental

> **Status**: DE0-DE5 Complete
> **Plan**: plans/plan-20260711-1328-data-engine-authority-incremental.md
> **Contract**: tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md
> **Review**: tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md
> **Last Updated**: 2026-07-11 20:58
> **Lifecycle**: notes

## Design Decisions

- The durable master plan remains DE0-DE5, while the active contract is narrowed to
  DE0 only. Later phases require new bounded contracts after the previous gate passes.
- `ProjectionInputManifestV1` is in DE0, not DE3. It hashes every current compiler
  input domain and carries a separate compatibility digest for stable query/view/
  compiler identity; changing graph/evidence inputs changes the manifest without
  making a legitimate base/head projection comparison incompatible.
- Projection delta is projection-only. Fact/evidence channels will be produced from
  explicit authority-cursor state, never reverse-engineered from rendered occurrences.
- Evidence lifecycle uses the existing ArchitectureEvent envelope with payload version
  `archcontext.architecture-evidence-lifecycle/v2`; the envelope itself is not forked.
- Historical evidence arrays are immutable creates. Conflicting duplicate IDs fail
  closed. V2 create/update/remove operations require canonical previous digests and
  removals persist tombstones; removed IDs cannot be silently reused.
- SQLite validates the candidate evidence transition by replay before insert, then
  persists the event, current evidence rows, and tombstones in the existing event
  transaction. `UPSERT DO UPDATE` replaces `INSERT OR REPLACE` so updating an evidence
  item does not transiently delete it and violate live binding foreign keys.
- Every cached projection now binds the exact authority event sequence/hash, graph
  digest, and evidence-state digest captured by the same replay. Delta rejects a
  projection paired with any other event even when the graph digest is unchanged.
- YAML/ChangeSet writers diff live evidence state into V2 lifecycle operations;
  append boundaries reject new legacy arrays. Book and Explorer consume the same
  lifecycle replay instead of maintaining local last-write-wins scans.
- Migration `0013_evidence_lifecycle` clears pre-manifest projection cache rows, and
  cache reads validate the new cursor/manifest shape before returning a projection.
- DE1 migration `0014_architecture_change_feed` adds typed event-subject rows, a
  monotonic durable feed, scoped consumer checkpoints, and a durable backfill-complete
  marker. Event/current-state/subject/feed writes remain one `BEGIN IMMEDIATE` unit.
- Affected-subject extraction records both sides of moved graph/evidence references,
  including relation/constraint targets, live bindings, and entity-delete cascades.
- Steady append reads materialized evidence/binding/tombstone state and applies only
  the candidate event; it no longer replays historical event JSON while holding the
  single-writer transaction.
- Historical backfill verifies event row, scope, sequence, payload/provenance, hash,
  and previous-hash chain; it advances per-scope state in one pass and commits derived
  rows in bounded 500-row batches. The completion marker is written only after final
  graph/evidence materialized-state verification.
- Explorer backlinks now come from the typed index with eventId-bound subject digests.
  Daemon invalidation consumes unread feed rows idempotently, marks latest projections
  stale while preserving digest-addressed Delta bases, and emits metadata-only SSE.
- DE2 migration `0015_snapshot_anchor_v2` removes old digest-only snapshots, adds V2
  graph/evidence/tombstone state, direct scope columns/indexes, and a scoped event-count
  checkpoint. Authority columns are immutable after append, event deletion is
  forbidden, and compaction remains a non-destructive mark.
- Snapshot creation performs verified genesis replay inside the transaction, compares
  it with materialized graph/evidence state, applies the persistence privacy guard, and
  serializes only replay authority. A self-consistent snapshot over corrupted derived
  tables is rejected before INSERT.
- Every explicit snapshot ref verifies schema/body/digests/row metadata/scope/cursor
  before target resolution in both anchored and genesis modes. Normal replay selects
  the newest verified anchor and queries only `(anchorSequence, targetSequence]`.
- Tail replay validates complete typed event rows against hashed event JSON, exact
  logical target IDs, previous-hash continuity, and scoped event-count continuity.
  Total count is `anchor.eventCount + tail.length`; no prefix count remains on the hot
  path. Explorer Delta now replays exact base/head authority cursors through this path.
- DE3 makes authority and evidence first-class required manifest domains. Git authority
  explicitly carries a null ledger cursor; ledger authority must bind the exact complete
  repository/worktree identity plus graph and evidence-state digests. This preserves
  Git-visible product authority without accepting unbound ledger projections.
- Every Explorer view now owns a typed required/optional/not-used domain policy, and
  that policy contributes to `viewDefinitionDigest`. Missing optional inputs differ
  canonically from known-empty inputs; missing/unavailable required inputs fail before
  cache access or compilation.
- Migration `0016_manifest_addressed_projection_cache` removes old rows and keys exact
  hits by complete scope plus manifest digest. Production SQLite and TestLocalStore use
  the same strict schema/privacy/body/scope/authority integrity validator; invalidated,
  corrupt, cross-worktree, or nondeterministic rows cannot become cache hits.

## Deviations From Plan Or Spec

- The outside voice found that the first captured plan deferred the manifest to DE3,
  left evidence historical semantics undefined, and attached one broad contract to
  all phases. The user explicitly selected full manifest in DE0, explicit lifecycle,
  and a separate DE0 contract; the plan and contract were corrected before continuing.
- The plan wording originally said `ArchitectureEventV2`; implementation uses payload
  V2 under ArchitectureEvent V1 because `payloadVersion` is the existing evolution
  boundary and avoids an unnecessary envelope fork.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Query digest only vs full manifest | Full manifest in DE0 | Explicit user choice; removes the DE0 -> DE3 forward dependency. |
| LWW vs explicit lifecycle | Explicit create/update/remove | Explicit user choice; makes deletion, stale updates, and tombstones authoritative. |
| New event envelope vs payload version | Existing envelope + payload V2 | Smallest coherent contract; preserves event-chain identity while making lifecycle explicit. |
| SQLite `REPLACE` vs UPSERT | `ON CONFLICT DO UPDATE` | Preserves FK identity when a live binding references an updated evidence item. |

## Open Questions

- None. DE0-DE5 are implemented; no program finding is deferred.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Focused verification: 394 passing tests across contracts, architecture-delta,
  architecture-ledger, SQLite, daemon, CLI, Explorer UI, and governance/readback.
- Full verification: `bun run verify` — 1030 passing tests, 0 failures.
- Explorer benchmark: 10k p95 24.33ms; 100k p95 886.33ms; privacy PASS.
- Readback: `docs/verification/data-engine-de0-readback.json` verdict PASS.
- Independent `$check`: five findings found and fixed; architecture and security
  re-review both report all original findings closed.
- DE1 focused readback: `docs/verification/data-engine-de1-readback.json` PASS.
- DE1 full verification: `bun run verify` — 1033 passing tests, 0 failures; Explorer
  10k p95 27.06ms and 100k p95 525.92ms; privacy PASS.
- DE1 independent `$check`: seven verified findings found and fixed. Architecture
  and security re-review report every original and follow-up finding closed.
- DE2 focused readback: `docs/verification/data-engine-de2-readback.json` PASS; 384
  focused tests pass with 0 failures.
- DE2 full verification: `bun run verify` — 1038 passing tests, 0 failures;
  Explorer 10k p95 23.55ms and 100k p95 537.81ms; privacy PASS.
- DE2 independent `$check`: eight unique findings (nine reviewer reports including one
  overlap) found and fixed. Architecture and security re-review report no open finding.
- DE3 focused readback: `docs/verification/data-engine-de3-readback.json` PASS; the
  contract/SQLite/daemon/CLI/package matrix passes with 0 failures.
- DE3 full verification: `bun run verify` — 1046 tests passed, 0 failed; Explorer
  10k p95 34.48ms and 100k p95 490.83ms; packaged CLI/privacy/eval gates PASS.
- DE3 independent `$check`: eleven unique findings fixed, 0 deferred; final
  architecture and security re-reviews both report no remaining verified finding.
- DE4 adds one canonical planner authority shared by compiler and SQLite executor.
  Self-digested plans are not authorization: query caps and the complete plan must
  equal `canonicalProjectionReadPlanV1` before any graph/metadata read.
- Graph and evidence authority are now separable. Git graph drift retains verified
  ledger bindings/backlinks through `evidenceAuthorityCursor`; the cursor is included
  in projection cursor, manifest, authority digest, strict schema, and cache integrity.
- Verified-ledger focus avoids `openSession`, full ledger state, replay, all-backlink
  scans, and (outside drift-pressure) Git YAML materialization. Its recursive CTE uses
  a plan-derived internal `limit + 1` probe; exact-fit succeeds and overflow fails
  closed with `explorer-projection-neighborhood-budget-exceeded`.
- Selected materialized graph rows are matched to their immutable materializing event
  payload and latest subject record. Evidence/binding rows additionally verify stored
  digest and denormalized columns. Backlink title/rationale comes from verified event
  payload after change-feed event/hash/scope/subjects-digest validation.
- DE4 poisoning regressions cover current graph, evidence JSON, and change-feed
  decision metadata. All are rejected before a projection/cache write.
- DE4 focused readback is PASS. Full `bun run verify` passes 1050 tests with 0
  failures; Explorer compiler readback reports 10k p95 1.83ms and 100k p95 0.55ms,
  with packaged CLI, privacy, governance, acceptance-ledger, and eval gates PASS.
- DE4 independent `$check` closed every review-round finding. Final architecture and
  security verdicts are PASS; the final coordinated derived-subject/feed-digest poison
  is filtered by immutable event-payload direct-subject authority.
- DE5 migration `0017_explorer_cache_lifecycle` adds byte/access accounting, bounded
  expiring delta pins, a stable GC index, and numeric aggregate runtime metrics. The
  cache remains a disposable child of Git/ledger authority.
- Retention runs after each save and at startup. It removes dependency orphans,
  clears expired pins, collects invalid/expired unpinned rows, then applies per-scope
  count/byte pressure in LRU/created/digest order.
- Delta requests pin exact base/head projection digests for ten minutes, within the
  policy maximum of eight digests and fifteen minutes. Pins cannot authorize a cache
  body or survive their explicit expiry.
- Metrics cover feed lag, anchored replay tail length, bounded plan rows, compile time,
  hit/miss, eviction, and rebuild. Metric names/reason codes are allow-listed and
  values are non-negative numeric aggregates only.
- DE5 independent `$check` found nine unique issues across review rounds; all were
  fixed. Final reviewers report PASS. Regression coverage includes GC fault rollback,
  source-digest readback staleness, offset/invalid/overlong pins, metric content and
  overflow, mutable byte accounting, TestLocalStore rollback, and 160-manifest churn.
- Final holistic hardening validates a duplicate append by re-reading the complete
  stored event row through the canonical row/JSON/hash/scope validator. A forged
  `event_json` can no longer become an accepted idempotent success.
- Evidence-state authority now has one immutable append-only checkpoint per event,
  written in the same event/feed transaction and reconstructed only after verified
  historical replay. It binds scope, global sequence, scope count, event/hash, and
  evidence digest. Explorer cross-checks the latest authority in O(1), while backfill
  rejects any existing feed/checkpoint row that differs from replay authority.
- Final full `bun run verify` passes 1062 tests with 0 failures. The new migration is
  included in AL10 migration/package signatures, and all privacy, acceptance-ledger,
  sprint-status, packaged CLI, Explorer, governance, and eval gates pass.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
- Candidate: never use SQLite `INSERT OR REPLACE` for a parent row with live FK
  dependents; use UPSERT to preserve row identity.
