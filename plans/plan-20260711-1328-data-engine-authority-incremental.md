# Plan: Data Engine Authority, Delta, and Incremental Execution

> **Status**: Executing
> **Created**: 20260711-1328
> **Slug**: data-engine-authority-incremental
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: complex-engineering-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: risk_boundary
> **Verification Boundary**: DE0-DE5 each require focused tests, typecheck, Explorer readback, full bun run verify, and phase acceptance evidence; final closeout requires clean contract/worktree state
> **Rollback Surface**: Code rollback plus rebuild of disposable subject/feed/projection indexes and cache; authoritative events/snapshots are never deleted or SQL-reversed
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md`
> **Task Review**: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md`
> **Implementation Notes**: `tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md`

Phase contracts:

- DE0: `tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md` (complete)
- DE1: `tasks/contracts/20260711-1605-data-engine-de1-change-feed.contract.md` (complete)
- DE2: `tasks/contracts/20260711-1720-data-engine-de2-snapshot-replay.contract.md` (complete)
- DE3: `tasks/contracts/20260711-1749-data-engine-de3-manifest-cache.contract.md` (complete)
- DE4: `tasks/contracts/20260711-1836-data-engine-de4-bounded-read-planner.contract.md` (complete)

## Agentic Routing
- Selected route: gstack:plan-eng-review
- Routing reason: Captured from repo-harness-plan planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260711-1328-data-engine-authority-incremental.md`
- Sprint contract: `tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md`
- Sprint review: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md`
- Implementation notes: `tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree; `.claude/.active-plan` is a legacy fallback during transition. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260711-1328-data-engine-authority-incremental.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260711-1328-data-engine-authority-incremental.md`.

## Approach
### Strategy
Use the captured planning output below as the execution source of truth.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| See captured planning output | Follow | Implement only the approved scope named below |

### Code Snippets
See captured planning output.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Captured plan lacks enough detail | Medium | Execution may need clarification | Stop before implementation if the captured output contradicts repo rules or lacks concrete file targets |

## Task Contracts
- Contract file: `tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md`
- Review file: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md`
- Implementation notes file: `tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan`, the owning worktree is written to `.ai/harness/active-worktree`, and the plan is mirrored to `.claude/.active-plan` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260711-1328-data-engine-authority-incremental.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Code rollback plus rebuild of disposable subject/feed/projection indexes and cache; authoritative events/snapshots are never deleted or SQL-reversed
- **Verification boundary**: DE0-DE5 each require focused tests, typecheck, Explorer readback, full bun run verify, and phase acceptance evidence; final closeout requires clean contract/worktree state
- **Review/acceptance boundary**: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: risk_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260711-1328-data-engine-authority-incremental.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260711-1328-data-engine-authority-incremental.contract.md`, `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md`, and `tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Code rollback plus rebuild of disposable subject/feed/projection indexes and cache; authoritative events/snapshots are never deleted or SQL-reversed

## Captured Planning Output

# Objective

Build a complete data-engine program that makes ArchContext's ledger, evidence,
projection, invalidation, replay, and cache paths authority-correct and bounded at
scale. The program deliberately excludes Explorer Global Subject Search: this is
the engine underneath every view and read model, not a search feature.

## Outcome

The finished engine has five independently testable properties:

1. A fact change is derived only from authoritative ledger state, an evidence
   change only from authoritative evidence/binding state, and a projection change
   only from compiler output. Pagination or budget displacement can never be
   reported as a fact deletion.
2. Every committed ledger mutation creates a typed, transactional change record
   in the same SQLite transaction. Consumers invalidate by cursor and subject,
   rather than discovering changes by recompiling a projection or watching files.
3. Normal historical reads restore a verified snapshot and replay only its tail;
   full genesis replay remains an explicit integrity-audit mode.
4. Projection compilation declares a content-addressed input manifest and executes
   a bounded read plan. Focused/detail views do not load the full graph first.
5. Derived caches have deterministic ownership, dependency pins, retention limits,
   garbage collection, and observable hit/miss/rebuild behavior.

## P1 · Architecture Map

### Real components and authority boundaries

| Component | Responsibility | Authority |
|---|---|---|
| `packages/contracts` | Wire and port contracts for cursors, deltas, manifests, change feed, read plans, and cache policy | Public shape authority |
| `packages/core/architecture-ledger` | Event validation, deterministic state transition, snapshot verification, integrity replay | Ledger semantics authority |
| `packages/core/architecture-delta` | Pure comparison of authoritative base/head states | Delta semantics authority |
| `packages/local-runtime/local-store-sqlite` | Single-writer transaction, materialized current state, snapshots, indexes, outbox, derived cache | Operational persistence authority |
| `packages/local-runtime/runtime-daemon` | Scope resolution, read-plan orchestration, compiler inputs, token-gated API/SSE | Runtime orchestration authority |
| `packages/surfaces/*` | Thin read clients and mutation triggers | No data authority |
| `.archcontext/` | Current Git-visible architecture truth | Product architecture authority until a separately accepted ledger promotion |

### Existing scale signals

- The Explorer compiler currently constructs and sorts the complete entity,
  observed-symbol, relation, constraint, and backlink sets before applying node and
  relation budgets.
- SQLite already has normalized current-state tables, snapshots, a recursive-CTE
  neighborhood reader, and a projection dependency/cache index.
- Snapshot compaction currently marks events but normal replay still reads from
  genesis.
- Projection cache rows are digest-addressed but have no automatic retention or GC.
- Event backlinks are rebuilt by parsing historical event payloads instead of using
  a typed subject index.

### Strong dependencies

- Every ledger write continues through ChangeSet or daemon-owned transactional
  event append.
- Event append, current-state materialization, subject-change indexing, and change
  feed append are one atomic transaction.
- Snapshot hashes, event-chain hashes, repository/worktree identity, and compiler
  version remain fail-closed preconditions.

### Weak dependencies

- SSE transport, HTML rendering, and cache contents are replaceable projections.
- Cache eviction cannot affect ledger, evidence, or snapshot correctness.
- Oh My Mermaid's recursive perspectives, reference navigation, and watcher/SSE
  ergonomics are inspiration only; its filesystem watcher and regex diff parser are
  not suitable authorities for ArchContext.

## P2 · Concrete Data Flows

### Write and invalidation path

```text
ChangeSet / daemon mutation trigger
  -> validate ArchitectureEventV1
  -> BEGIN IMMEDIATE
  -> append architecture_events
  -> apply current-state materialization
  -> append architecture_event_subjects
  -> append architecture_change_feed (cursor, class, subjects, input digests)
  -> COMMIT
  -> daemon polls/reads committed feed cursor
  -> invalidate only dependent projection keys
  -> digest-only SSE notification
  -> authenticated client refetches
```

Source of truth is the committed event and its verified transition. A crash before
commit produces no visible event or feed row. A crash after commit is recoverable
because the durable feed row remains unread; SSE is never the durable queue.

### Historical read and delta path

```text
base/head request
  -> resolve repository + worktree + authoritative cursors
  -> verify cursor order and snapshot/event-chain identity
  -> load nearest verified snapshot <= cursor
  -> replay ordered tail events to cursor
  -> compare ledger graph states            => architecture-fact delta
  -> compare evidence/binding states         => evidence delta
  -> compile matching projection manifests
  -> compare returned occurrences/relations  => projection delta
  -> return three explicitly separated channels
```

Budget, focus, semantic level, expanded occurrences, and query digest are part of
projection compatibility. They never affect fact/evidence classification.

### Projection read path

```text
ExplorerProjectionQueryV2
  -> ProjectionReadPlanV1
       overview: aggregate/group reads
       context:  bounded current-state rows + relation frontier
       detail:   focused neighborhood + constraints + bindings + backlinks
  -> ProjectionInputManifestV1
  -> content-addressed cache lookup
       hit: return immutable projection
       miss: compile, index dependencies, persist, enforce retention
  -> response with manifest digest + projection digest
```

The compiler receives only the selected read set and explicit totals; it does not
silently expand beyond the plan's budget.

## P3 · Design Decision

### Core decision: separate truth domains before optimizing them

The engine must not infer one authority class from another. The current composite
projection diff is convenient but semantically unsafe: a bounded projection can
drop a still-existing subject when a newly sorted subject takes its slot. Therefore
the first slice fixes delta authority before adding change-feed or replay speedups.

### Why this shape exists

The existing full replay and full compilation paths are simple deterministic
foundations that made AL0-AL10 and Explorer V2 auditable. They should not be
replaced wholesale. The program adds explicit anchors, indexes, manifests, and
bounded planners around those semantics while retaining genesis replay as the
independent verification path.

### Invariants to preserve

- Git-visible `.archcontext/` remains architecture truth until an accepted ADR
  explicitly promotes ledger authority.
- SQLite databases, WAL files, runtime directories, and generated projections are
  never edited as a mutation shortcut.
- No compatibility fallback, shadow parser, or synthesized fact/evidence state.
- Event chain order is total within repository/worktree scope.
- Public deltas are deterministic for identical authoritative cursors and manifest.
- SSE exposes digests/cursors only; clients refetch through token-gated routes.
- Raw source, raw diffs, prompts/completions, secrets, and full CodeGraph output are
  never persisted in ledger/change-feed/cache artifacts.

### 10x behavior

At 10x current representative size, the first failure today is CPU/memory from
full graph construction/sort and O(history) replay/backlink scans; unbounded cache
growth follows. The target design makes hot focused reads proportional to selected
neighborhood plus tail events, while integrity audit remains deliberately O(history).

## Public Contracts

### `AuthorityCursorV1`

- repository and worktree identity
- `eventSequence`, `eventId`, `eventChainHash`
- optional verified `snapshotId` and `snapshotDigest`
- rejects a snapshot from another scope or a head before base

### `ArchitectureDeltaV2`

- `factChanges`: derived from authoritative ledger graph states only
- `evidenceChanges`: derived from evidence items/bindings at the same cursors only
- `projectionChanges`: derived from compatible projection manifestations only
- base/head authority cursors and projection-manifest digests are returned as
  provenance; no legacy mixed-class response is preserved

### `EvidenceLifecycleOperationV1`

- Explicit `create`, `update`, and `remove` operations for both evidence items and
  evidence bindings; every update/remove carries the previous canonical digest.
- `create` rejects an existing live ID, `update` rejects a missing/tombstoned ID or
  digest mismatch, and `remove` writes a tombstone rather than deleting history.
- `EvidenceStateAtCursorV1` is the deterministic fold of these operations by event
  sequence. State includes live items, live bindings, and tombstones so removal and
  later re-creation cannot be confused.
- The migration boundary is explicit: historical ArchitectureEvent payload V1
  `evidenceItems`/`evidenceBindings` are immutable create operations; a duplicate ID
  is accepted only when its canonical digest is identical. New writers emit the
  payload V2 lifecycle contract under the existing event envelope. This is a bounded historical replay rule, not a runtime
  heuristic or best-effort fallback.

### `ArchitectureChangeFeedRecordV1`

- monotonic `feedSequence` scoped by storage repository/workspace
- event sequence/id/chain hash
- typed affected subjects: kind, id, operation, authority class
- input-domain digests changed by the transaction
- committed timestamp; no raw source/event payload copy

### `ProjectionInputManifestV1`

- graph authority cursor/digest
- observed facts digest and availability
- evidence/binding digest
- event-subject index cursor/digest
- drift/pressure/task-session digests when required by the view
- canonical query digest, view-definition digest, compiler version
- manifest digest over the complete canonical object
- This contract and canonical compiler are part of DE0 because Delta V2 compatibility
  depends on them. DE3 hardens manifest-addressed cache ownership after the
  transactional change feed exists.

### `ProjectionReadPlanV1`

- plan kind: `overview-aggregate`, `bounded-context`, `focused-neighborhood`
- exact row/node/relation/depth limits
- required domains (graph, observed, bindings, events, drift, pressure, task)
- stable ordering and truncation semantics
- planner version included in the manifest

### `ProjectionCachePolicyV1`

- maximum entries and bytes per repository/worktree/view/query scope
- maximum age for unpinned rows
- pins for explicit delta bases, active clients, and verified snapshot readbacks
- deterministic LRU/age eviction, dependency cascade, and orphan cleanup

## SQLite Data Model

### `architecture_event_subjects`

Append-only rows keyed by `(storage_repository_id, storage_workspace_id,
event_sequence, subject_kind, subject_id, operation)`. Indexed both by event and by
subject. Rows are generated from validated graph operations, evidence lifecycle
operations, and evidence-binding lifecycle operations inside the append transaction;
consumers never regex/JSON-scan event bodies.

### `architecture_change_feed`

Append-only transactional outbox keyed by scope and monotonic feed sequence. A
consumer checkpoint is operational state, not part of the event authority. Multiple
daemon restarts can replay unread rows idempotently.

### Snapshot anchors

Snapshots record a verified state body/digest containing graph state, evidence
state, binding state, and evidence tombstones, plus last event sequence/id/hash and
scope. Normal replay selects the newest verified snapshot at or before the target
cursor and reads only `(snapshot_sequence, target_sequence]`. Integrity mode ignores
the optimization and proves genesis -> target equivalence for every authority domain.

### Cache accounting

Projection cache rows gain byte size, created/last-access timestamps, pin count or
pin relation, manifest digest, and planner version. Retention runs after insert and
on daemon startup; it deletes dependency rows transactionally with cache rows.

## Program Phases

### DE0 · Authority-separated delta (first implementation slice)

- [x] Add a critical regression proving budget displacement is a projection change,
      never an architecture-fact removal.
- [x] Add the complete canonical `ProjectionInputManifestV1` contract/compiler and
      require manifest compatibility for projection delta.
- [x] Add ArchitectureEvent payload V2 evidence lifecycle operations plus deterministic
      `EvidenceStateAtCursorV1` replay with create/update/remove tombstone semantics.
- [x] Introduce authoritative base/head cursor inputs for fact/evidence deltas.
- [x] Move fact/evidence comparison to pure state comparison in
      `architecture-delta`; keep occurrence/relation comparison in the projection
      compiler.
- [x] Replace the mixed V1 delta response with V2; do not add a compatibility path.
- [x] Migrate delta query/schema/CLI/MCP/runtime callers together to authoritative
      cursors and Delta V2; retain no digest-only query compatibility path.
- [x] Add contract schema tests, pure unit tests, SQLite historical-state tests,
      daemon route tests, malformed/stale/cross-scope/illegal-evidence-transition
      negative tests.
- [x] Acceptance: no compiler code can emit fact/evidence deltas from bounded
      projection presence; `bun run typecheck`, focused tests, `bun run
      verify:explorer`, and full `bun run verify` pass.

### DE1 · Transactional subject index and change feed

- [x] Add migrations for `architecture_event_subjects` and
      `architecture_change_feed` with scope/event/subject indexes.
- [x] Generate typed affected subjects from graph operations, evidence items, and
      evidence bindings, including evidence-only events.
- [x] Append event, materialized state, subject rows, and feed row atomically.
- [x] Move event backlinks to the typed index.
- [x] Drive cache invalidation/SSE from durable committed feed cursors.
- [x] Prove crash-before-commit, crash-after-commit, restart replay, duplicate poll,
      and subject-selective invalidation.
- [x] Prove an evidence-only event invalidates binding-dependent projections.

### DE2 · Snapshot-anchored replay and scope reads

- [x] Add verified graph+evidence+tombstone snapshot state, anchor selection, and
      tail-range event query.
- [x] Keep explicit full-genesis integrity replay and compare it to anchored output.
- [x] Add direct composite scope lookup with `LIMIT 1`; remove event JSON scan.
- [x] Add corruption, wrong-scope, missing-anchor, out-of-order, and equivalence tests.
- [x] Benchmark replay by tail length and prove normal read cost is independent of
      compacted history length.

### DE3 · Manifest-addressed cache and input-domain hardening

- [x] Require every view to declare required/optional input domains.
- [x] Fail closed when a required digest/input is unavailable or mismatched.
- [x] Key cache and delta compatibility by the manifest digest.
- [x] Add determinism, digest sensitivity, cross-worktree, stale-task, and missing
      domain tests.

### DE4 · Bounded projection read planner

- [x] Add `ProjectionReadPlanV1` with stable planner version and hard row limits.
- [x] Reuse the existing recursive-CTE neighborhood reader for focus/context.
- [x] Add aggregate reads for overview counts/groups and targeted binding/backlink
      selectors for detail.
- [x] Refactor compiler input to accept bounded read sets plus authoritative totals.
- [x] Prove no unplanned full-graph read on focus/detail paths and preserve output
      determinism/truncation semantics.

### DE5 · Cache lifecycle and operational evidence

- [ ] Add cache policy contract, access/size accounting, pins, deterministic GC,
      orphan cleanup, and startup retention.
- [ ] Add feed lag, replay tail length, plan rows read, compile time, cache hit/miss,
      evictions, and rebuild reason metrics without source content.
- [ ] Prove pinned delta bases survive, unpinned rows evict, crash recovery is safe,
      and cache deletion cannot affect authoritative results.
- [ ] Add representative 10k/100k readback and operations/runbook evidence.

## Sequencing and Worktree Strategy

The complete program is intentionally split into bounded work packages. Each phase
lands sequentially because DE1-DE5 share SQLite schema/runtime ports and depend on
the authority contracts established earlier. Inside a phase, pure contract/core
tests may be developed in parallel with SQLite fixtures only when they do not share
the same files; merge and verify before touching daemon integration.

| Step | Modules | Depends on |
|---|---|---|
| DE0 | contracts, architecture-delta, architecture-ledger, runtime-daemon, SQLite history reads, CLI/MCP | Explorer V2 |
| DE1 | contracts, SQLite append/migrations, runtime-daemon | DE0 |
| DE2 | architecture-ledger, SQLite replay/scope | DE1 |
| DE3 | runtime-daemon/compiler, cache keys | DE0, DE1 |
| DE4 | SQLite read planner, runtime-daemon/compiler | DE2, DE3 |
| DE5 | SQLite cache, telemetry, runbooks/readback | DE1-DE4 |

Execution is one active contract/worktree at a time. This prevents concurrent schema
and port edits from bypassing the repository's single active plan/worktree markers.

## Migration and Rollback

- All new operational tables/columns are additive SQLite migrations first.
- Backfill of event-subject rows replays validated typed events in a bounded local
  migration/readback step; malformed historical events fail closed and block use of
  the new index for that scope.
- Cutovers are one-way within this pre-1.0 program: old mixed delta and JSON-scan
  runtime paths are removed after tests/readback, not retained as fallbacks.
- Rollback is code rollback plus deletion/rebuild of disposable change-feed indexes
  and projection caches. Authoritative events and verified snapshots are never
  deleted by rollback.
- A migration that has appended authoritative ledger events is not reversed by SQL;
  semantic reversal requires a new validated event/ChangeSet.

## Failure Modes and Required Handling

| Failure | Handling | Verification |
|---|---|---|
| Budget pushes a subject out of top N | classify only as projection change | critical regression test |
| Base/head query or manifest differs | reject `incompatible-delta` | unit + route negative tests |
| Snapshot belongs to another scope | reject before replay | SQLite integration test |
| Snapshot body/hash corrupted | reject; do not tail-replay | integrity test |
| Crash before event transaction commit | no event/feed/materialization visible | transaction fault test |
| Crash after commit before SSE | durable feed is replayed after restart | restart integration test |
| Duplicate feed poll | idempotent dependency invalidation | integration test |
| Required projection input unavailable | explicit precondition error, no synthesized input | compiler/route tests |
| Read plan exceeds hard budget | reject/return explicit bounded truncation per contract | planner tests |
| Cache row/dependency orphaned | startup GC removes it | SQLite recovery test |
| All cache rows evicted | deterministic rebuild from authority | integration test |

No listed failure is allowed to become a silent semantic fallback.

## Performance and Acceptance Budgets

- Delta correctness is invariant under any valid node/relation budget.
- Feed append adds one bounded set of subject rows and one outbox row in the existing
  event transaction; no second commit window.
- Anchored replay reads at most the chosen snapshot plus tail events; the benchmark
  records tail length and verifies no genesis query in normal mode.
- Focused/detail projection SQL rows are bounded by declared plan limits and do not
  scale with total graph size beyond indexed traversal cost.
- 100k representative fixture retains the existing Explorer response budget and
  does not regress p95 by more than 10% in phases that do not intentionally replace
  the read path; DE4 must improve focused/detail p95 and peak RSS against its stored
  baseline.
- Cache storage remains within configured per-scope count/byte limits after repeated
  query/view/worktree churn.

## Test Coverage Plan

```text
CODE PATHS                                      OPERATOR / CLIENT FLOWS
DE0 delta
  authoritative state diff [unit]                compare base/head [integration]
  projection diff [unit]                         budget displacement [CRITICAL]
  compatibility guards [unit]                    stale/cross-scope cursor [negative]
DE1 append/feed
  atomic append [SQLite integration]             mutation -> refetch SSE [integration]
  subject extraction [unit]                      restart unread feed [recovery]
DE2 replay
  anchor selection [unit]                        historical read [integration]
  tail replay [integration]                      integrity full replay [readback]
DE3 manifest cache hardening
  canonical digest [unit]                        cache hit/miss [integration]
  required-domain guards [unit]                  unavailable input [negative]
DE4 planner
  plan selection [unit]                          overview/context/detail [integration]
  hard bounds [SQLite integration]               10k/100k fixture [benchmark]
DE5 retention
  eviction/pins [SQLite integration]             churn/restart [recovery]
  metrics privacy [unit/readback]                 ops diagnosis [runbook readback]
```

Test framework is Bun's built-in test runner. Each phase runs focused unit and
SQLite/daemon integration tests, typecheck, package-boundary audit, Explorer
readback, and full `bun run verify`. No LLM prompt/eval path is changed.

## What Already Exists and Is Reused

- `architecture_events` total order, chain hashes, current-state materialization,
  and snapshot tables: extended, not replaced.
- `architecture-delta` pure delta machinery: becomes the owner of authoritative
  state comparison rather than duplicating comparison in the Explorer compiler.
- `readArchitectureLedgerNeighborhoodFromDb` recursive CTE: becomes a DE4 planner
  primitive rather than adding a second graph traversal implementation.
- Explorer V2 query budgets, deterministic ordering, cursor checks, dependency
  index, digest cache, and token-gated digest-only SSE: hardened and reused.
- Existing AL7/AL10 representative benchmark, privacy, chaos, and runbook readback
  patterns: extended for new evidence.

## NOT in Scope

- Explorer Global Subject Search, FTS/Jieba/vector retrieval, or search ranking: a
  separate product slice; this program only provides trustworthy bounded inputs.
- UI redesign, Mermaid rendering, recursive documentation generation, or onboarding
  guides: consumer/product work after engine guarantees exist.
- Filesystem watcher as authority: ledger mutations use a transactional feed.
- Regex/heuristic Mermaid or event-body diffing: conflicts with typed authority.
- Cloud synchronization, multi-writer consensus, or remote collaboration.
- Promotion of SQLite ledger state to product authority; ADR-0040 remains unchanged.
- Persisting raw source, raw diffs, prompts/completions, or full CodeGraph output.
- A generic event bus framework: one SQLite transactional feed is sufficient.

## Documentation and Evidence

- Add an accepted ADR for authority-separated delta, transactional change feed,
  snapshot-anchor replay, manifests, bounded planners, and disposable cache policy.
- Maintain this program checklist as the full accepted scope; each DE phase receives
  a bounded contract/review/notes/readback artifact before implementation.
- Add phase-specific verification documents and final representative benchmark,
  privacy, failure-recovery, and operations evidence.

## Task Breakdown

- [x] DE0: Land manifest-compatible authority-separated delta V2, evidence
      lifecycle, and the budget-displacement regression.
- [x] DE1: Land transactional subject index/change feed and feed-driven invalidation.
- [x] DE2: Land verified snapshot-anchor tail replay and direct scope resolution.
- [x] DE3: Land manifest-addressed cache keys and required-domain hardening.
- [x] DE4: Land bounded projection read planner and partial SQLite reads.
- [ ] DE5: Land cache retention/GC, metrics, 10k/100k readback, and runbooks.
- [ ] Complete ADR/index, program notes, acceptance evidence, full verification, and
      contract/worktree closeout.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | Backend engine scope already fixed by user |
| Codex Review | outside voice | Independent second opinion | 1 | issues folded | 6 findings; 3 structural choices explicitly resolved by user, 3 objective defects corrected |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 6 issues, 0 critical gaps, 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not applicable | No UI scope |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not required | No CLI workflow redesign beyond V2 migration |

**CROSS-MODEL:** Outside voice found the DE0/DE3 manifest dependency, undefined evidence history, over-broad contract, missing V2 caller paths, evidence-only feed gap, and damaged task-breakdown tail. The user selected full manifest in DE0, explicit evidence lifecycle, and a bounded DE0 contract; the remaining defects were corrected without widening product scope.

**VERDICT:** ENG CLEARED — complete program is durable; bounded DE0 execution may proceed.

NO UNRESOLVED DECISIONS
