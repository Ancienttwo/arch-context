---
schemaVersion: archcontext.adr/v1
id: adr.0045.authority-separated-data-engine
title: Authority-Separated Data Engine
status: accepted
decidedAt: 2026-07-11
appliesTo:
  - packages/contracts
  - packages/core/architecture-delta
  - packages/core/architecture-ledger
  - packages/local-runtime/local-store-sqlite
  - packages/local-runtime/runtime-daemon
supersedes: []
---

# ADR-0045: Authority-Separated Data Engine

## Context

Explorer V2 originally compared two bounded projections and classified rendered
subject changes as architecture facts or evidence. A deterministic top-N shift could
therefore report a still-live architecture subject as removed. The same engine also
replayed ledger history from genesis, parsed event JSON for backlinks, compiled full
graphs before truncation, and retained derived projections without lifecycle limits.

Oh My Mermaid demonstrates useful recursive perspectives, reference navigation,
incremental refresh, and digest metadata. ArchContext cannot adopt its filesystem
watcher or regex diff as authority because architecture facts, evidence, and rendered
projections have different owners and failure semantics.

## Decision

### 1. Separate delta authority

- `architecture-fact` changes compare authoritative graph states at explicit
  `AuthorityCursorV1` base/head cursors.
- `evidence` changes compare `EvidenceStateAtCursorV1`, including lifecycle
  tombstones.
- `projection` changes compare compatible `ProjectionInputManifestV1` compiler
  outputs only.
- Projection presence can never create a fact/evidence change.
- Delta query/response V2 replaces V1 without a product compatibility path.

### 2. Make evidence lifecycle explicit

The ArchitectureEvent envelope remains V1; its payload evolution boundary uses
`archcontext.architecture-evidence-lifecycle/v2`.

- `create` requires an unused, non-tombstoned ID.
- `update` requires a live ID and matching canonical previous digest.
- `remove` requires a live ID, matching previous digest, and reason code; removal
  writes a tombstone.
- An evidence item cannot be removed while a live binding references it.
- Historical payload-V1 evidence arrays replay as immutable creates. Identical
  duplicates are idempotent; conflicting duplicates fail closed.

SQLite validates the complete candidate lifecycle fold before inserting the event.
Event, materialized evidence/binding rows, and tombstones share the event transaction.

### 3. Address projections by complete input manifest

`ProjectionInputManifestV1` contains canonical digests for query, graph, observed
facts/availability, bindings, event backlinks, drift, pressure, task session, view
definition, compiler, repository/worktree identity, evidence state, authority source,
and token mode. Each view declares a typed required/optional/not-used policy for every
input domain. It exposes:

- `manifestDigest`: changes when any compiler input changes.
- `compatibilityDigest`: stable only for projections whose repository/worktree,
  query, view definition, and compiler semantics are comparable.

Authority is explicit rather than inferred from cursor presence. `git` authority
requires a null ledger cursor and retains Git-visible `.archcontext/` as product truth.
`ledger` authority requires a cursor bound to the exact repository, worktree, graph
digest, and evidence-state digest. Exact cache lookup uses the full manifest digest;
stored rows are revalidated against the strict Projection V2 schema, privacy policy,
canonical body digests, scope, and authority binding before use.

### 4. Use a transactional change feed

Every committed ledger event appends typed affected subjects and a durable change-feed
record in the same SQLite transaction. Extraction covers both sides of graph and
evidence reference changes, evidence bindings, and entity-delete relation cascades.
Steady append derives evidence transitions from materialized current state plus one
validated event, not historical event replay.

Migration backfill revalidates stored event rows, scope, sequence, event hash, and
previous-hash chain; it advances per-scope state in one pass and commits derived rows
in bounded batches. A durable completion marker is written only after final graph and
evidence materialized-state verification. Indexed backlink digests bind logical event
ID plus typed subjects. Consumer checkpoints are scoped, monotonic, and must resolve to
delivered feed rows. SSE remains a digest-only notification; the durable feed is the
recovery source.

### 5. Anchor normal replay, retain genesis audit

Normal historical reads restore a V2 snapshot containing graph, evidence, bindings,
and tombstones, then replay only the ordered tail. Snapshot creation first performs a
genesis replay inside the write transaction, proves materialized graph/evidence
equivalence, applies the persistence privacy guard, and serializes only the verified
replay state.

Every explicit snapshot reference is fully verified even when the caller selects
genesis mode; genesis ignores the state optimization, not the cursor/scope contract.
The cursor binds global event sequence/id/hash plus a scoped event count checkpoint.
Tail rows must advance both the hash chain and scoped count by one. Authority-bearing
event columns are immutable after append; deletion is forbidden and migration receives
one bounded NULL-to-typed scope backfill path. Compaction marks rows without deleting
history. This lets the
hot anchored path compute total count as anchor count plus tail length without a
prefix `COUNT(*)`. Integrity audit retains full genesis replay and proves identical
graph/evidence/tombstone state and digests.

### 6. Plan bounded reads and bound disposable cache

Explorer overview/context/detail requests will compile an explicit read plan and use
aggregate or indexed-neighborhood SQLite reads. Derived projection cache entries are
content-addressed, dependency-indexed, size/count/age bounded, pin-aware, and safe to
delete/rebuild.

## Invariants

- Git-visible `.archcontext/` remains product architecture truth until a separate
  accepted ledger-authority promotion.
- Ledger writes cross ChangeSet or daemon-owned transactional append only.
- No heuristic, regex, shadow parser, compatibility fallback, or synthesized
  fact/evidence state.
- Raw source, raw diffs, prompts/completions, secrets, and full CodeGraph output are
  not persisted in events, manifests, feed, cache, metrics, or readback.
- Cross-repository/worktree, reversed cursor, missing event, corrupted snapshot, and
  required-input mismatch fail closed.

## Consequences

- Delta V2 is intentionally breaking before 1.0.
- Evidence lifecycle adds a tombstone table and rejects ID reuse.
- DE2 snapshot anchoring makes normal replay O(tail) after a verified anchor while
  keeping snapshot creation and explicit integrity replay O(history).
- Focused projection latency and cache storage become bounded and observable in
  later phases without weakening authority semantics.

## Verification

- Budget displacement regression produces projection changes only.
- Manifest determinism and input-domain sensitivity tests.
- Evidence create/update/remove, stale digest, missing target, live-binding, legacy
  duplicate, rollback, and tombstone tests.
- Delta V2 schema, daemon HTTP/RPC, CLI, stale/cross-scope/reversed cursor tests.
- DE1-DE5 phase readbacks and final 10k/100k benchmark/privacy/recovery evidence.
