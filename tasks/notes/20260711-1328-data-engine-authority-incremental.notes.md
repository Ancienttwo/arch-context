# Implementation Notes: data-engine-authority-incremental

> **Status**: DE0 Complete
> **Plan**: plans/plan-20260711-1328-data-engine-authority-incremental.md
> **Contract**: tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md
> **Review**: tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md
> **Last Updated**: 2026-07-11 16:05
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

- None for DE0. DE1 remains the next bounded phase in the accepted program plan.

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

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
- Candidate: never use SQLite `INSERT OR REPLACE` for a parent row with live FK
  dependents; use UPSERT to preserve row identity.
