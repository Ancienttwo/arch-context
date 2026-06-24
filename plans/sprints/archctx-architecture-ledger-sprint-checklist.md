# Sprint Checklist: ArchContext Architecture Ledger & Passive Architecture Control Loop

> **Status**: Executing - AL0 complete
> **Slug**: `archctx-architecture-ledger`
> **Created**: 2026-06-24
> **Updated**: 2026-06-25
> **Target location**: `plans/sprints/archctx-architecture-ledger-sprint.md`
> **Relationship to current roadmap**: follow-up workstream after the existing M0–M6 scaffold; may start in parallel with remaining M6 launch evidence where dependencies permit.
> **Goal**: turn architecture knowledge into a durable, queryable, reviewable ledger that passively follows code evolution, serves LLMs through CLI/MCP, and invokes subagents only when deterministic analysis cannot close an important uncertainty.

---

## 0. Recommended product decision

This checklist assumes a **hybrid architecture ledger**, not a SQL-only or filesystem-only design.

| Layer | Authority | Responsibility |
|---|---|---|
| Code + CodeGraph | Observed code facts | Files, symbols, imports, callers, changed edges; never the declared architecture truth |
| Local SQLite ledger | Operational architecture state | Events, snapshots, current graph, evidence bindings, recommendations, agent jobs, freshness and history |
| `.archcontext/` in Git | Review and collaboration boundary | Deterministic, portable projections that can be reviewed, merged, copied and rebuilt |
| Markdown / diagrams / ADRs | Human-facing projections | Generated or proposed documentation; not an independent source of truth |
| ChangeSet engine | Only mutation path | Preview, validate, approve, apply, rollback and rebuild projections |
| Claude/Codex subagent | Investigator and drafter | Produces typed evidence and proposals; never directly mutates authoritative architecture state |

**Do not switch authority from YAML to SQLite in one release.** First add the ledger, then run dual-read/dual-write, prove deterministic rebuild and rollback, and only then promote SQLite to operational authority.

---

## 1. Existing foundations to reuse

These are existing assets, not new backlog items:

- [x] Local SQLite store, migrations, WAL, foreign keys and busy timeout.
- [x] Repository sessions, snapshots, task state, observed evidence and review result persistence.
- [x] ChangeSet journal and crash recovery path.
- [x] Single-writer local runtime daemon.
- [x] YAML model store under `.archcontext/`.
- [x] Architecture domain, context compiler, pressure engine, decision engine, reconcile engine and review engine.
- [x] CLI and local MCP surfaces.
- [x] Static practice catalog and recommendation engine scaffold.
- [x] CodeGraph adapter boundary.
- [x] Claude Code and Codex repository contracts through `CLAUDE.md` and `AGENTS.md`.

The work below should extend these capabilities rather than introduce a second daemon, second database, second mutation protocol or parallel recommendation system.

---

## 2. Tracking conventions

### Status

- `◻` Not started
- `◐` In progress
- `☑` Done with linked verification evidence
- `⛔` Blocked; blocker and owner recorded
- `↺` Reopened after regression

### Priority

- `P0`: blocks the product loop or can create incorrect architecture state.
- `P1`: required for beta quality, reliability or usability.
- `P2`: useful after the critical path is working.

### Definition of Ready

A task may enter development only when:

- [ ] Its contract or expected behavior is written.
- [ ] Dependencies and package owner are identified.
- [ ] Test fixtures and negative cases are named.
- [ ] Privacy classification is known.
- [ ] Failure and rollback behavior is known.
- [ ] The task does not create a second source of truth.

### Definition of Done

A task is complete only when:

- [ ] Implementation, contract and migration are committed together.
- [ ] Unit tests include positive, negative and boundary cases.
- [ ] At least one integration or end-to-end path covers the behavior.
- [ ] Same input produces the same canonical output and digest.
- [ ] Stale HEAD/worktree inputs are rejected before mutation.
- [ ] Crash/retry behavior is idempotent.
- [ ] No source body or diff body is persisted accidentally.
- [ ] CLI JSON output and error codes remain stable.
- [ ] Documentation and agent contracts are updated.
- [ ] A verification artifact is linked from the sprint gate.

---

## 3. Proposed program metrics

These are target gates, not claims about current performance.

| Metric | Beta target | GA target |
|---|---:|---:|
| Ledger rebuild determinism | 100% on fixtures | 100% on representative repos |
| Lost or duplicate architecture events | 0 in 1,000 simulated events | 0 in 10,000 simulated events |
| Stale mutation rejection | 100% | 100% |
| Warm architecture query latency, p95 | ≤ 300 ms | ≤ 200 ms |
| Hook enqueue overhead, p95 | ≤ 150 ms | ≤ 100 ms |
| Incremental deterministic analysis for ≤200 changed files, p95 | ≤ 3 s | ≤ 2 s |
| No-label structural Top-3 recall | ≥ 90% | ≥ 92% |
| Held-out recommendation precision@3 | ≥ 80% | ≥ 85% |
| Hard-gate false positives | 0 | 0 |
| Projection drift after successful `complete_task` | 0 | 0 |
| Median subagent spawns per task | 0 | 0 |
| p95 subagent spawns per task | ≤ 1 | ≤ 1 |
| Direct subagent writes to architecture authority | 0 | 0 |

---

# Program overview

| Sprint | Outcome | Priority | Depends on | Status |
|---|---|---:|---|---|
| AL0 | Authority, contracts and ADR freeze | P0 | Existing M0–M3 | ☑ |
| AL1 | Recommendation evidence correctness | P0 | AL0 | ◻ |
| AL2 | SQLite architecture ledger foundation | P0 | AL0 | ◻ |
| AL3 | YAML ↔ ledger migration and dual mode | P0 | AL2 | ◻ |
| AL4 | Passive Git/runtime change capture | P0 | AL2, AL3 | ◻ |
| AL5 | Code diff → evidence → architecture delta pipeline | P0 | AL1, AL3, AL4 | ◻ |
| AL6 | Provider-neutral subagent orchestration | P1 | AL2, AL4, AL5 | ◻ |
| AL7 | LLM-first CLI/MCP retrieval surface | P0 | AL2, AL3, AL5 | ◻ |
| AL8 | Recommendation scheduler, suppression and feedback | P0 | AL1, AL5, AL6, AL7 | ◻ |
| AL9 | Documentation placement and deterministic projections | P0 | AL3, AL5, AL6 | ◻ |
| AL10 | Shadow rollout, migration and GA hardening | P0 | AL0–AL9 | ◻ |

**Critical path:** `AL0 → AL2 → AL3 → AL4 → AL5 → AL7 → AL8 → AL9 → AL10`
**Parallel path:** `AL0 → AL1`; `AL5 → AL6`.

---

# AL0 · Authority, contracts and ADR freeze

**Goal:** eliminate ambiguity about what is authoritative before adding another persistence model.

### Tasks

- [x] **AL0-01 · P0 · `docs/adr`** — Write `ADR-0040 Hybrid Architecture Ledger`.
  - Acceptance: declares operational authority, Git collaboration boundary, projection semantics and promotion conditions.
  - Evidence: `docs/adr/ADR-0040-hybrid-architecture-ledger.md`.
  - Note: the checklist draft named ADR-0026, but ADR-0026 is already assigned to Multi-repo Architecture Context; ADR-0040 preserves unique ADR IDs.
- [x] **AL0-02 · P0 · `architecture-domain`** — Publish an authority matrix for declared, observed, verified, proposed and projected facts.
  - Acceptance: every fact kind has one writer, one canonical ID rule and an explicit conflict policy.
  - Evidence: `docs/architecture/architecture-ledger-authority-matrix.md`, `packages/contracts/src/ledger.ts`.
- [x] **AL0-03 · P0 · `contracts`** — Define `ArchitectureEvent/v1`.
  - Required fields: event ID, repository/worktree identity, base and resulting digest, HEAD SHA, actor, source, timestamp, idempotency key, payload version and provenance.
  - Evidence: `schemas/runtime/architecture-event.schema.json`, `packages/contracts/fixtures/valid/architecture-event.json`.
- [x] **AL0-04 · P0 · `contracts`** — Define `ArchitectureSnapshot/v1` and snapshot digest rules.
  - Evidence: `schemas/runtime/architecture-snapshot.schema.json`, `packages/contracts/src/ledger.ts`.
- [x] **AL0-05 · P0 · `contracts`** — Define `EvidenceItem/v2` and typed `EvidenceBinding/v1`.
  - Acceptance: evidence is bound to entity, relation, constraint, recommendation or practice; free-text matching cannot grant authority.
  - Evidence: `schemas/runtime/evidence-item.schema.json`, `schemas/runtime/evidence-binding.schema.json`.
- [x] **AL0-06 · P0 · `contracts`** — Define `RecommendationRun/v1`, `Recommendation/v2` and lifecycle statuses.
  - Evidence: `schemas/runtime/recommendation-run.schema.json`, `schemas/runtime/recommendation.schema.json`.
- [x] **AL0-07 · P0 · `contracts`** — Define `AgentJob/v1` and typed `InvestigationReport/v1`.
  - Evidence: `schemas/runtime/agent-job.schema.json`, `schemas/runtime/investigation-report.schema.json`.
- [x] **AL0-08 · P0 · `runtime-daemon`** — Define repository, branch and worktree scoping rules.
  - Acceptance: branch switches and multiple worktrees cannot contaminate one another.
- [x] **AL0-09 · P0 · `changeset-engine`** — Confirm that all ledger-affecting mutations pass through ChangeSet or an equivalent transactional event append owned by the daemon.
  - Evidence: `docs/adr/ADR-0040-hybrid-architecture-ledger.md`, `docs/architecture/architecture-ledger-authority-matrix.md`.
- [x] **AL0-10 · P0 · `security`** — Extend the threat model for local database tampering, malicious repository content, prompt injection, hook recursion and agent output forgery.
  - Evidence: `docs/security/threat-model-v1.md`.
- [x] **AL0-11 · P1 · `docs/spec`** — Update product truth and remove contradictory wording about YAML versus SQL authority.
  - Evidence: `docs/spec.md`.
- [x] **AL0-12 · P1 · `AGENTS.md` / `CLAUDE.md`** — Add the ledger read/write contract and prohibit direct DB editing by coding agents.
  - Evidence: `AGENTS.md`, `CLAUDE.md`.
- [x] **AL0-13 · P1 · `scripts`** — Capture baseline timings for current `init`, `sync`, `context`, `checkpoint` and `complete` paths.
  - Evidence: `docs/verification/architecture-ledger-al0-baseline.md`.
- [x] **AL0-14 · P1 · `contracts`** — Add JSON Schema fixtures for forward compatibility, unknown fields and version rejection.
  - Evidence: `packages/contracts/fixtures/valid/`, `packages/contracts/fixtures/invalid/`, `packages/contracts/fixtures/boundary/`, `packages/contracts/test/contracts.test.ts`.
- [x] **AL0-15 · P1 · `docs/runbooks`** — Write feature-flag and rollback strategy: `yaml`, `dual`, `ledger-shadow`, `ledger-authoritative`.
  - Evidence: `docs/runbooks/architecture-ledger-rollout.md`.

### Exit gate

- [x] **AL0-EG1** — ADR and authority matrix approved.
  - Evidence: `docs/adr/ADR-0040-hybrid-architecture-ledger.md`, `docs/architecture/architecture-ledger-authority-matrix.md`.
- [x] **AL0-EG2** — All new schemas have positive, negative and boundary fixtures.
  - Evidence: `bun test packages/contracts/test/contracts.test.ts` passed with 134 tests.
- [x] **AL0-EG3** — No unresolved “which store wins?” case remains.
  - Evidence: ADR-0040 mode sequence keeps `.archcontext/` as current review boundary and SQLite as operational state until explicit promotion.
- [x] **AL0-EG4** — Branch/worktree identity and stale-write semantics are testable.
  - Evidence: ledger schemas require repository/worktree identity, HEAD SHA and worktree digest; AL0 matrix defines stale job behavior.
- [x] **AL0-EG5** — Product spec, CLI contract and agent contract agree.
  - Evidence: `docs/spec.md`, `docs/runbooks/schema-upgrade-guide.md`, `AGENTS.md`, `CLAUDE.md`.

### AL0 execution log

- 2026-06-25: Completed AL0 authority/contracts freeze on branch `codex/architecture-ledger-al0`.
- 2026-06-25: Contract verification passed: `bun test packages/contracts/test/contracts.test.ts` (134 pass, 0 fail).
- 2026-06-25: Baseline timing readback captured in `docs/verification/architecture-ledger-al0-baseline.md`.

---

# AL1 · Recommendation evidence correctness

**Goal:** remove known semantic paths that can generate confident but unsupported architecture advice.

### Tasks

- [ ] **AL1-01 · P0 · `practice-engine`** — Replace globally shared context evidence with practice-bound evidence.
- [ ] **AL1-02 · P0 · `contracts`** — Add `practiceId`, `triggerId`, `subject`, `provenance` and `coverage` to bound evidence.
- [ ] **AL1-03 · P0 · `practice-engine`** — Ensure unrelated `observed` or `verified` evidence cannot raise another practice’s score or enforcement level.
- [ ] **AL1-04 · P0 · `practice-engine`** — Remove practice identification through evidence ID or summary substring matching.
- [ ] **AL1-05 · P0 · `practice-engine`** — Split predicates into `import-edge-added`, `cross-boundary-import-added` and `declared-layer-violation-observed`.
- [ ] **AL1-06 · P0 · `architecture-domain`** — Add explicit boundary membership and direction evaluation required by layer-violation evidence.
- [ ] **AL1-07 · P0 · `practice-engine`** — Replace `missingTermPredicate` authority with typed absence probes and complete/partial/unknown coverage.
- [ ] **AL1-08 · P0 · `practice-engine`** — Apply negative path rules to individual subjects instead of suppressing an entire practice.
- [ ] **AL1-09 · P0 · `pressure-engine`** — Detect arbitrary-length cycles with SCC/DFS and distinguish new cycles from baseline cycles.
- [ ] **AL1-10 · P0 · `evals`** — Add no-label structural fixtures that prohibit practice IDs, aliases and titles in task, path, symbol and evidence text.
- [ ] **AL1-11 · P0 · `evals`** — Add evidence-shuffle mutation tests.
  - Acceptance: expected recommendation labels do not move with unrelated evidence payloads.
- [ ] **AL1-12 · P1 · `evals`** — Report precision@3, recall@3, benign advisory false-positive rate, per-practice support and confidence calibration.
- [ ] **AL1-13 · P0 · `policy-engine`** — Keep automatic checkpoint promotion disabled until all AL1 gates pass.
- [ ] **AL1-14 · P1 · `practice-engine`** — Add recommendation explanation output showing exact predicate, subject and evidence binding.

### Exit gate

- [ ] **AL1-EG1** — Unrelated evidence escalation is blocked in 100% of tests.
- [ ] **AL1-EG2** — Plain import edges never prove a declared layer violation.
- [ ] **AL1-EG3** — Incomplete context never produces observed absence.
- [ ] **AL1-EG4** — Three-node and longer new cycles are detected; pre-existing cycles are not reported as new.
- [ ] **AL1-EG5** — No-label structural Top-3 recall ≥ 90% and held-out precision@3 ≥ 80%.
- [ ] **AL1-EG6** — Hard-gate false positives = 0.

---

# AL2 · SQLite architecture ledger foundation

**Goal:** extend the existing local SQLite store into an appendable, replayable and queryable architecture ledger without creating a second database.

### Package direction

Prefer an internal module such as:

```text
packages/local-runtime/local-store-sqlite/src/ledger/
packages/core/architecture-ledger/
packages/contracts/src/ledger/
```

Do not create `architecture.sqlite` beside `runtime.sqlite` unless a measured isolation requirement proves necessary.

### Minimum schema checklist

- [ ] `architecture_events`
- [ ] `architecture_snapshots`
- [ ] `architecture_entities_current`
- [ ] `architecture_relations_current`
- [ ] `architecture_constraints_current`
- [ ] `evidence_items`
- [ ] `evidence_bindings`
- [ ] `recommendation_runs`
- [ ] `recommendations`
- [ ] `recommendation_feedback`
- [ ] `agent_jobs`
- [ ] `projection_state`
- [ ] `source_cursors`
- [ ] `waivers`

### Tasks

- [ ] **AL2-01 · P0 · `local-store-sqlite`** — Add forward-only migrations for all ledger tables.
- [ ] **AL2-02 · P0 · `local-store-sqlite`** — Scope every mutable row by repository and worktree identity; include branch/HEAD where semantically required.
- [ ] **AL2-03 · P0 · `architecture-ledger`** — Implement append-only event writes with unique idempotency keys.
- [ ] **AL2-04 · P0 · `architecture-ledger`** — Add `previous_event_hash` and canonical `event_hash` for tamper-evident sequencing.
- [ ] **AL2-05 · P0 · `architecture-ledger`** — Materialize current entity, relation and constraint tables in the same transaction as accepted event append.
- [ ] **AL2-06 · P0 · `architecture-ledger`** — Implement snapshot creation and canonical graph digest.
- [ ] **AL2-07 · P0 · `architecture-ledger`** — Implement replay from an empty database to a selected event or snapshot.
- [ ] **AL2-08 · P0 · `architecture-ledger`** — Verify replayed current state equals materialized current state byte-for-byte after canonicalization.
- [ ] **AL2-09 · P0 · `local-store-sqlite`** — Add foreign keys, uniqueness constraints and indexes for temporal and graph queries.
- [ ] **AL2-10 · P1 · `local-store-sqlite`** — Add FTS5 over summaries, rationale, decision titles and evidence summaries; exclude source body.
- [ ] **AL2-11 · P0 · `local-store-sqlite`** — Add source-storage schema guard for new tables.
- [ ] **AL2-12 · P0 · `architecture-ledger`** — Implement event batch transaction and rollback on any invalid payload.
- [ ] **AL2-13 · P0 · `runtime-daemon`** — Enforce single-writer ownership for event append and snapshot creation.
- [ ] **AL2-14 · P1 · `architecture-ledger`** — Add safe compaction: snapshot old events without losing auditability or rebuild ability.
- [ ] **AL2-15 · P1 · `local-store-sqlite`** — Add backup, integrity check and corruption recovery commands.
- [ ] **AL2-16 · P1 · `tests`** — Run the same migration/replay fixtures through Node `node:sqlite` and Bun SQLite adapters.
- [ ] **AL2-17 · P1 · `architecture-ledger`** — Add views for current graph, open recommendations, recent changes and unresolved evidence.
- [ ] **AL2-18 · P1 · `observability`** — Record local operation duration, row counts and rebuild reason without recording code content.

### Exit gate

- [ ] **AL2-EG1** — 1,000-event replay yields the expected graph and identical digest on repeated runs.
- [ ] **AL2-EG2** — Duplicate event retries do not create duplicate state.
- [ ] **AL2-EG3** — Injected failure at every transaction step leaves no partial graph mutation.
- [ ] **AL2-EG4** — Schema audit confirms no source or diff body columns.
- [ ] **AL2-EG5** — Database deletion and rebuild path is documented and tested.

---

# AL3 · YAML ↔ ledger migration and dual mode

**Goal:** migrate safely from filesystem-first authority without losing Git reviewability, portability or recovery.

### Tasks

- [ ] **AL3-01 · P0 · `model-store-yaml`** — Implement deterministic import of manifest, nodes, relations, constraints, ADR metadata and policies into ledger events.
- [ ] **AL3-02 · P0 · `renderer`** — Implement deterministic export from ledger current state to `.archcontext/` YAML.
- [ ] **AL3-03 · P0 · `architecture-domain`** — Define one canonical ordering and serialization for IDs, collections, metadata and timestamps.
- [ ] **AL3-04 · P0 · `reconcile-engine`** — Add bidirectional digest comparison and a typed drift report.
- [ ] **AL3-05 · P0 · `runtime-daemon`** — Add read modes: `yaml`, `dual-compare`, `ledger-shadow`, `ledger`.
- [ ] **AL3-06 · P0 · `runtime-daemon`** — Add write modes: `yaml`, `dual`, `ledger-with-projection`.
- [ ] **AL3-07 · P0 · `changeset-engine`** — In dual mode, append event and update projection atomically from the user’s perspective; recover both sides after crash.
- [ ] **AL3-08 · P0 · `git-adapter`** — Detect branch checkout, rebase, reset and worktree changes; select or rebuild the correct ledger cursor.
- [ ] **AL3-09 · P0 · `architecture-ledger`** — Define conflict behavior when Git projection changes outside ArchContext.
  - Suggested rule: import as a proposed external event, validate, compare base digest, then require explicit reconcile if conflict remains.
- [ ] **AL3-10 · P0 · `cli`** — Add `archctx ledger migrate --from-yaml --dry-run`.
- [ ] **AL3-11 · P0 · `cli`** — Add `archctx ledger rebuild --from-git` and `archctx ledger project --to-git`.
- [ ] **AL3-12 · P0 · `cli`** — Add `archctx ledger drift --json` with actionable reason codes.
- [ ] **AL3-13 · P1 · `migration`** — Preserve existing IDs and map legacy records without generating new semantic entities.
- [ ] **AL3-14 · P1 · `migration`** — Add backup and one-command rollback to YAML authority.
- [ ] **AL3-15 · P1 · `tests`** — Add fixtures for merge conflicts, rebase, detached HEAD and two simultaneous worktrees.
- [ ] **AL3-16 · P1 · `package-boundaries`** — Verify CLI, MCP and agents cannot bypass the daemon to mutate either store.

### Exit gate

- [ ] **AL3-EG1** — YAML → ledger → YAML has zero semantic drift.
- [ ] **AL3-EG2** — Deleting SQLite and rebuilding from Git reproduces the same architecture digest.
- [ ] **AL3-EG3** — Deleting generated YAML and projecting from SQLite reproduces the same files.
- [ ] **AL3-EG4** — Rebase and branch-switch fixtures never leak state across worktrees.
- [ ] **AL3-EG5** — Rollback to YAML mode succeeds without data loss.

---

# AL4 · Passive Git/runtime change capture

**Goal:** observe architecture-relevant development activity automatically while keeping hooks fast, deterministic and safe.

### Trigger policy

| Trigger | Default behavior | LLM allowed? | Blocking? |
|---|---|---:|---:|
| `post-checkout` | enqueue cursor refresh/rebuild check | No | No |
| `post-merge` | enqueue sync and architecture delta scan | No | No |
| `post-rewrite` | invalidate stale cursor and enqueue replay | No | No |
| `post-commit` | persist commit metadata and enqueue incremental scan | No | No |
| `pre-commit` | optional staged fast deterministic advisory | No | No by default |
| `pre-push` | optional full deterministic checkpoint | No by default | Configurable |
| Agent `prepare_task` | freshness check and context compilation | No | Yes for stale/invalid state |
| Agent `checkpoint` | deterministic analysis; may enqueue investigation | Conditional | Policy-dependent |
| Agent `complete_task` | reconcile, projection and final validation | Conditional | Yes for explicit complete gates |

### Tasks

- [ ] **AL4-01 · P0 · `git-adapter`** — Normalize commit, staged and worktree change metadata without persisting diff body.
- [ ] **AL4-02 · P0 · `git-adapter`** — Compute stable change fingerprints from repository ID, base SHA, head SHA, path set and CodeGraph digest.
- [ ] **AL4-03 · P0 · `runtime-daemon`** — Add a persistent local job queue backed by `agent_jobs` or a separate typed runtime queue table.
- [ ] **AL4-04 · P0 · `runtime-daemon`** — Implement enqueue, claim, lease, retry, cancel and dead-letter semantics.
- [ ] **AL4-05 · P0 · `runtime-daemon`** — Add debounce and coalescing for rapid file saves and sequential commits.
- [ ] **AL4-06 · P0 · `runtime-daemon`** — Deduplicate jobs by change fingerprint and analysis kind.
- [ ] **AL4-07 · P0 · `cli`** — Add `archctx hooks install`, `uninstall`, `status` and `doctor`.
- [ ] **AL4-08 · P0 · `hooks`** — Install thin wrappers that only validate runtime availability and enqueue work.
- [ ] **AL4-09 · P0 · `hooks`** — Add recursion guard so ArchContext-generated projection commits do not trigger an infinite loop.
- [ ] **AL4-10 · P0 · `runtime-daemon`** — Attach every job to HEAD SHA and worktree digest; cancel or supersede stale jobs.
- [ ] **AL4-11 · P1 · `policy-engine`** — Define advisory fail-open behavior and explicit fail-closed policy modes.
- [ ] **AL4-12 · P1 · `runtime-daemon`** — Add backpressure: queue cap, per-repository concurrency, priority and stale-job eviction.
- [ ] **AL4-13 · P1 · `cli`** — Add `archctx jobs list/show/cancel/retry` with structured JSON.
- [ ] **AL4-14 · P1 · `observability`** — Record local queue depth, enqueue latency, coalescing ratio and failure reason.
- [ ] **AL4-15 · P1 · `tests`** — Simulate 100 rapid commits, amend, rebase, reset and branch switches.
- [ ] **AL4-16 · P1 · `docs/runbooks`** — Document shell compatibility, hook chaining and recovery when another tool owns hooks.

### Exit gate

- [ ] **AL4-EG1** — Hook enqueue overhead p95 ≤ 150 ms on the reference machine.
- [ ] **AL4-EG2** — No hook invokes a network provider or LLM by default.
- [ ] **AL4-EG3** — No duplicate or lost jobs in the stress fixture.
- [ ] **AL4-EG4** — Stale jobs cannot append events or update projections.
- [ ] **AL4-EG5** — Existing user hooks remain chained and functional.

---

# AL5 · Code diff → evidence → architecture delta pipeline

**Goal:** turn code evolution into typed, reviewable architecture changes rather than free-form LLM summaries.

### Pipeline contract

```text
Git change cursor
  → CodeGraph incremental sync
  → normalized changed subjects and edges
  → typed evidence probes
  → evidence bindings
  → candidate architecture delta
  → deterministic validation and policy
  → optional subagent investigation
  → ChangeSet proposal
  → accepted ledger events
  → projections and recommendations
```

### Tasks

- [ ] **AL5-01 · P0 · `codegraph-adapter`** — Return changed symbols, edges and ownership-relevant subjects for a base/head pair.
- [ ] **AL5-02 · P0 · `contracts`** — Define stable subject selectors for repository, path, symbol, node, relation, API, datastore and external contract.
- [ ] **AL5-03 · P0 · `architecture-delta`** — Normalize added, removed, moved, renamed and materially changed subjects.
- [ ] **AL5-04 · P0 · `architecture-delta`** — Distinguish raw code facts from architecture interpretation.
- [ ] **AL5-05 · P0 · `architecture-delta`** — Bind every interpretation to one or more evidence items with coverage and confidence.
- [ ] **AL5-06 · P0 · `architecture-delta`** — Map changed code subjects to declared architecture entities with explicit match reasons.
- [ ] **AL5-07 · P0 · `architecture-delta`** — Represent unresolved mapping as ambiguity, never as a silently invented entity.
- [ ] **AL5-08 · P0 · `architecture-domain`** — Generate typed candidate deltas for node, relation, constraint, owner, lifecycle and migration-state changes.
- [ ] **AL5-09 · P0 · `architecture-domain`** — Separate target-state change from migration-state progress.
- [ ] **AL5-10 · P0 · `policy-engine`** — Define which candidate deltas may auto-accept, require checkpoint, require proof or require human approval.
- [ ] **AL5-11 · P0 · `changeset-engine`** — Convert accepted candidates into previewable ChangeSets and ledger event batches.
- [ ] **AL5-12 · P0 · `review-engine`** — Reject unsupported entity deletion, owner change, boundary relaxation and external-contract claims.
- [ ] **AL5-13 · P1 · `architecture-delta`** — Add rename/move correlation to avoid delete-plus-add churn.
- [ ] **AL5-14 · P1 · `architecture-delta`** — Add baseline comparison so pre-existing issues are not attributed to the current task.
- [ ] **AL5-15 · P1 · `fixtures`** — Add representative monolith-to-service, persistence boundary, public API, payment webhook, mapper removal and package-layer fixtures.
- [ ] **AL5-16 · P1 · `observability`** — Record mapping coverage, unresolved subjects and evidence strength distribution.

### Exit gate

- [ ] **AL5-EG1** — Same base/head pair always produces the same candidate delta and digest.
- [ ] **AL5-EG2** — No candidate architecture fact exists without typed evidence or an explicit heuristic marker.
- [ ] **AL5-EG3** — Rename and move fixtures do not create false entity deletion/addition.
- [ ] **AL5-EG4** — Baseline issues are separated from task-introduced issues.
- [ ] **AL5-EG5** — All accepted mutations are represented as ChangeSets and ledger events.

---

# AL6 · Provider-neutral subagent orchestration

**Goal:** use Claude/Codex as bounded investigators and document drafters, with predictable cost, frequency and provenance.

### Default spawn policy

A subagent is eligible only when all conditions are true:

1. Deterministic analysis found an architecture-relevant change or risk.
2. The impact is medium/high, or the policy explicitly requests investigation.
3. Confidence is below the action threshold, or documentation synthesis is materially useful.
4. No equivalent completed or active job exists for the same fingerprint.
5. Repository, task and daily budget allow execution.
6. Cooldown has expired.
7. The user/provider configuration explicitly enables the adapter.

### Tasks

- [ ] **AL6-01 · P0 · `contracts`** — Define `InvestigationRunnerPort` independent of Claude or Codex.
- [ ] **AL6-02 · P0 · `agent-orchestrator`** — Implement job state machine: queued, running, succeeded, failed, cancelled, superseded and expired.
- [ ] **AL6-03 · P0 · `agent-orchestrator`** — Implement per-task, per-repository and daily spawn budgets.
- [ ] **AL6-04 · P0 · `agent-orchestrator`** — Set safe defaults: maximum one investigative spawn per task and zero automatic spawns for low-risk changes.
- [ ] **AL6-05 · P0 · `agent-orchestrator`** — Add cooldown, deduplication, concurrency one per repository and cancellation on stale HEAD.
- [ ] **AL6-06 · P0 · `agent-orchestrator`** — Build a minimal context bundle from ledger query results and evidence references; do not dump the whole repository.
- [ ] **AL6-07 · P0 · `contracts`** — Require typed output: finding, hypothesis, evidence references, unknowns, falsifier, proposed delta and confidence.
- [ ] **AL6-08 · P0 · `agent-orchestrator`** — Validate output schema and reject unknown entity IDs or unverifiable evidence references.
- [ ] **AL6-09 · P0 · `security`** — Treat repository text and model output as untrusted; add prompt-injection and tool-escape tests.
- [ ] **AL6-10 · P0 · `changeset-engine`** — Prohibit direct agent write; agent output can only create a proposal awaiting deterministic validation.
- [ ] **AL6-11 · P1 · `adapters`** — Implement Claude Code adapter behind the port.
- [ ] **AL6-12 · P1 · `adapters`** — Implement Codex adapter behind the same port.
- [ ] **AL6-13 · P1 · `agent-orchestrator`** — Record provider, model identifier, prompt-template digest, input digest, output digest, duration and outcome.
- [ ] **AL6-14 · P1 · `agent-orchestrator`** — Add timeout, bounded retries and deterministic fallback to advisory-only output.
- [ ] **AL6-15 · P1 · `cli`** — Add `archctx investigate`, `archctx agents status` and `archctx agents budget`.
- [ ] **AL6-16 · P1 · `tests`** — Add fake provider fixtures for timeout, malformed output, hallucinated IDs, duplicate results and stale completion.

### Exit gate

- [ ] **AL6-EG1** — Low-risk commit path spawns zero agents.
- [ ] **AL6-EG2** — Default p95 agent spawns per task ≤ 1.
- [ ] **AL6-EG3** — Agent cannot mutate ledger, YAML or docs directly.
- [ ] **AL6-EG4** — Stale or malformed outputs are rejected with actionable reason codes.
- [ ] **AL6-EG5** — Provider adapter can be removed without changing domain behavior.

---

# AL7 · LLM-first CLI and MCP retrieval surface

**Goal:** let an LLM understand current architecture, history and risks quickly without scanning the entire filesystem.

### User-facing command proposal

Use **Book** as the user metaphor and **Ledger** as the internal architecture term:

```text
archctx book status
archctx book query --task "..." --json
archctx book show <entity-id> --json
archctx book neighbors <entity-id> --depth 2 --json
archctx book timeline [<entity-id>] --since <ref> --json
archctx book diff --from <ref> --to <ref> --json
archctx book evidence <finding-or-entity-id> --json
archctx book recommendations --open --json
archctx book export --format yaml|markdown|json
```

### Tasks

- [ ] **AL7-01 · P0 · `architecture-ledger`** — Implement current-state query API for nodes, relations, constraints and migration state.
- [ ] **AL7-02 · P0 · `architecture-ledger`** — Implement graph-neighborhood queries using indexed joins or recursive CTEs.
- [ ] **AL7-03 · P0 · `architecture-ledger`** — Implement temporal queries by event, commit, timestamp and snapshot.
- [ ] **AL7-04 · P0 · `architecture-ledger`** — Implement architecture diff between two refs with reason and evidence links.
- [ ] **AL7-05 · P0 · `retrieval`** — Rank results by task relevance, graph distance, recency, declared importance and evidence strength.
- [ ] **AL7-06 · P0 · `retrieval`** — Enforce byte/item budgets and deterministic truncation.
- [ ] **AL7-07 · P0 · `retrieval`** — Return freshness metadata: repository, HEAD SHA, worktree digest, ledger cursor and projection digest.
- [ ] **AL7-08 · P0 · `cli`** — Implement the Book commands with stable JSON envelopes and reason codes.
- [ ] **AL7-09 · P0 · `mcp-local`** — Expose architecture state, timeline, diff and recommendations primarily as MCP resources.
- [ ] **AL7-10 · P0 · `mcp-local`** — Keep the existing small tool surface; route mutations through existing plan/apply tools rather than adding one tool per query.
- [ ] **AL7-11 · P0 · `context-compiler`** — Consume ledger queries first, then request only missing code facts from CodeGraph.
- [ ] **AL7-12 · P1 · `retrieval`** — Add explain mode showing why each entity or recommendation was selected.
- [ ] **AL7-13 · P1 · `retrieval`** — Add FTS fallback for architecture prose and ADR summaries; do not add a vector database yet.
- [ ] **AL7-14 · P1 · `benchmarks`** — Benchmark cold and warm queries on small, medium and large fixtures.
- [ ] **AL7-15 · P1 · `privacy`** — Assert responses contain selectors, summaries and digests but no unintended source body.

### Exit gate

- [ ] **AL7-EG1** — Warm query p95 ≤ 300 ms in beta benchmark.
- [ ] **AL7-EG2** — Every response carries freshness and provenance.
- [ ] **AL7-EG3** — An LLM can answer “what changed, why, what depends on it and what remains risky?” from Book output alone on acceptance fixtures.
- [ ] **AL7-EG4** — MCP and CLI return semantically equivalent results.
- [ ] **AL7-EG5** — Context budget overflow is deterministic and explicit.

---

# AL8 · Recommendation scheduler, suppression and feedback

**Goal:** recommend at the right moments, avoid repeated noise, and invoke subagents only for high-value uncertainty.

### Proposed analysis levels

| Level | Trigger | Cost | Output | Agent policy |
|---|---|---:|---|---|
| L0 Freshness | prepare/status | Very low | cursor and drift state | Never |
| L1 Fast | staged change / checkpoint | Low | deterministic candidate practices and new risks | Never |
| L2 Deep deterministic | architectural delta / pre-push / complete | Medium | graph, baseline and policy analysis | Never |
| L3 Investigation | high impact + low confidence | High | typed investigation report | Budgeted, at most one by default |
| L4 Full audit | manual or release gate | Highest | repository-wide findings | Explicit only |

### Tasks

- [ ] **AL8-01 · P0 · `recommendation-engine`** — Store every run with input cursor, engine version, catalog digest and output digest.
- [ ] **AL8-02 · P0 · `recommendation-engine`** — Generate stable recommendation fingerprints from practice, subject, evidence and baseline.
- [ ] **AL8-03 · P0 · `recommendation-engine`** — Deduplicate unchanged recommendations across commits.
- [ ] **AL8-04 · P0 · `recommendation-engine`** — Model lifecycle: open, acknowledged, accepted, rejected, deferred, waived, resolved, superseded and expired.
- [ ] **AL8-05 · P0 · `policy-engine`** — Implement scheduling levels L0–L4 and explicit trigger matrix.
- [ ] **AL8-06 · P0 · `policy-engine`** — Compute architecture risk from boundary changes, ownership changes, persistence, external contracts, security/payment domains, cycles, migration state and hotspot growth.
- [ ] **AL8-07 · P0 · `policy-engine`** — Separate risk from uncertainty; only high-value uncertainty is eligible for L3 investigation.
- [ ] **AL8-08 · P0 · `policy-engine`** — Add per-practice and per-subject cooldowns.
- [ ] **AL8-09 · P0 · `waivers`** — Add scoped waiver with owner, reason, expiry, evidence and review date.
- [ ] **AL8-10 · P0 · `review-engine`** — Prevent advisory recommendations from becoming complete-stage gates without explicit policy eligibility.
- [ ] **AL8-11 · P1 · `cli`** — Add acknowledge, accept, reject, defer, waive and resolve commands.
- [ ] **AL8-12 · P1 · `feedback`** — Capture user outcome and reason without using implicit acceptance as truth.
- [ ] **AL8-13 · P1 · `evals`** — Measure repeated-noise rate, time-to-resolution, accepted recommendation rate and agent-assisted resolution rate.
- [ ] **AL8-14 · P1 · `recommendation-engine`** — Add explanation tree: trigger → subject → evidence → baseline → score → policy outcome.
- [ ] **AL8-15 · P1 · `practice-catalog`** — Require positive, near-negative, mixed-change and baseline fixtures before a practice can be enforcement-eligible.
- [ ] **AL8-16 · P1 · `policy-engine`** — Add repository-local configuration for frequency and budgets with safe defaults.

### Exit gate

- [ ] **AL8-EG1** — Re-running on unchanged architecture creates no new recommendation noise.
- [ ] **AL8-EG2** — L3 agent investigation occurs only when risk and uncertainty thresholds both qualify.
- [ ] **AL8-EG3** — Waiver scope and expiry are enforced.
- [ ] **AL8-EG4** — Hard gates remain zero false-positive on the release suite.
- [ ] **AL8-EG5** — Explanation tree reproduces the engine decision from persisted inputs.

---

# AL9 · Documentation placement and deterministic projections

**Goal:** keep architecture documentation current in appropriate repository locations without letting agents overwrite human-owned prose.

### Tasks

- [ ] **AL9-01 · P0 · `contracts`** — Define `ProjectionTarget/v1`: type, entity scope, path, ownership, generated region and renderer version.
- [ ] **AL9-02 · P0 · `model-store-yaml`** — Add manifest mapping from architecture entity kinds/scopes to target paths.
- [ ] **AL9-03 · P0 · `renderer`** — Generate architecture index, entity summaries, relation summaries, decision index and architecture changelog.
- [ ] **AL9-04 · P0 · `renderer`** — Generate Mermaid/Structurizr/LikeC4 projections from the same ledger snapshot.
- [ ] **AL9-05 · P0 · `renderer`** — Preserve human-authored regions and reject ambiguous file ownership.
- [ ] **AL9-06 · P0 · `reconcile-engine`** — Track projection source digest, renderer version and output digest.
- [ ] **AL9-07 · P0 · `reconcile-engine`** — Detect stale, missing, manually edited and orphaned projections.
- [ ] **AL9-08 · P0 · `changeset-engine`** — Apply projection updates through previewable ChangeSets.
- [ ] **AL9-09 · P0 · `agent-orchestrator`** — Let a subagent draft rationale or ADR prose only after deterministic delta selection.
- [ ] **AL9-10 · P0 · `agent-orchestrator`** — Store agent draft separately from accepted projection until validation/approval.
- [ ] **AL9-11 · P1 · `renderer`** — Add placement rules for monorepo package docs, service docs and repository-level architecture docs.
- [ ] **AL9-12 · P1 · `renderer`** — Add obsolete-projection cleanup with tombstone/redirect behavior where links may exist.
- [ ] **AL9-13 · P1 · `cli`** — Add `archctx docs plan`, `preview`, `apply`, `drift` and `clean`.
- [ ] **AL9-14 · P1 · `complete_task`** — Reconcile accepted architecture changes and validate projections before completion.
- [ ] **AL9-15 · P1 · `tests`** — Add mixed human/generated documents, rename, move, deletion and renderer-upgrade fixtures.
- [ ] **AL9-16 · P1 · `docs/runbooks`** — Document review ownership and how to recover from a bad projection.

### Exit gate

- [ ] **AL9-EG1** — Accepted architecture change appears in all configured projections before successful completion.
- [ ] **AL9-EG2** — Human-authored text is never overwritten in the fixture suite.
- [ ] **AL9-EG3** — Same snapshot and renderer version produce byte-identical outputs.
- [ ] **AL9-EG4** — Projection drift after successful `complete_task` = 0.
- [ ] **AL9-EG5** — Agent-written prose remains traceable to its job and input digest.

---

# AL10 · Shadow rollout, migration and GA hardening

**Goal:** prove the new loop on real repositories and promote authority safely.

### Rollout phases

1. **Shadow** — YAML authoritative; ledger records and compares only.
2. **Dual** — YAML and ledger both updated; drift blocks promotion but not development by default.
3. **Ledger operational authority** — runtime reads ledger; Git projections remain rebuild and collaboration boundary.
4. **Enforcement opt-in** — selected practices may gate complete/checks after quality thresholds pass.
5. **GA** — default mode chosen only after representative evidence.

### Tasks

- [ ] **AL10-01 · P0 · `feature-flags`** — Implement explicit phase flags and safe downgrade path.
- [ ] **AL10-02 · P0 · `migration`** — Create one-command backup, migrate, verify and rollback workflow.
- [ ] **AL10-03 · P0 · `fixtures`** — Run full loop on at least three representative repositories: small app, medium monorepo and architecture-heavy service project.
- [ ] **AL10-04 · P0 · `benchmarks`** — Measure hook, sync, query, checkpoint, complete, projection and replay performance.
- [ ] **AL10-05 · P0 · `chaos`** — Inject daemon crash, DB lock, disk-full, corrupt row, interrupted rebase and provider timeout.
- [ ] **AL10-06 · P0 · `security`** — Run prompt injection, path traversal, symlink escape, forged evidence, event tamper and stale replay tests.
- [ ] **AL10-07 · P0 · `privacy`** — Audit SQLite, logs, CLI output, MCP output and agent job payloads for source/diff leakage.
- [ ] **AL10-08 · P0 · `evals`** — Freeze a blind, no-label recommendation set and publish per-practice support.
- [ ] **AL10-09 · P0 · `evals`** — Compare deterministic-only versus deterministic-plus-agent outcomes and cost.
- [ ] **AL10-10 · P0 · `release`** — Add migration compatibility matrix across supported versions.
- [ ] **AL10-11 · P0 · `release`** — Verify packaged CLI includes migrations, hooks, renderers and agent adapter contracts.
- [ ] **AL10-12 · P1 · `runbooks`** — Write incident, corruption recovery, drift recovery, provider disable and full rollback runbooks.
- [ ] **AL10-13 · P1 · `telemetry`** — Produce local opt-in beta report: runs, drift, recommendations, agent spawn frequency, resolution and failures.
- [ ] **AL10-14 · P1 · `product`** — Interview beta users about whether Book answers replace manual filesystem browsing.
- [ ] **AL10-15 · P1 · `governance`** — Require an independent reviewer for authority promotion and enforcement enablement.
- [ ] **AL10-16 · P1 · `release`** — Record final Go/No-Go decision and unresolved risks.

### Beta exit gate

- [ ] **AL10-BETA-1** — Dual-mode drift = 0 across representative replay runs.
- [ ] **AL10-BETA-2** — No event loss/duplication in 1,000-event stress suite.
- [ ] **AL10-BETA-3** — No source/diff leakage in privacy audit.
- [ ] **AL10-BETA-4** — Recommendation quality meets AL1 targets.
- [ ] **AL10-BETA-5** — Default task path has median zero subagent spawns.
- [ ] **AL10-BETA-6** — Full rollback to YAML authority is demonstrated.

### GA exit gate

- [ ] **AL10-GA-1** — No event loss/duplication in 10,000-event stress suite.
- [ ] **AL10-GA-2** — Warm query p95 ≤ 200 ms on representative repositories.
- [ ] **AL10-GA-3** — Incremental deterministic analysis p95 ≤ 2 s for ≤200 changed files.
- [ ] **AL10-GA-4** — Stale writes, path escapes and forged evidence blocked 100%.
- [ ] **AL10-GA-5** — Hard-gate false positives = 0.
- [ ] **AL10-GA-6** — External/independent architecture and security review accepted.
- [ ] **AL10-GA-7** — Production rollback drill completed.

---

# Explicit non-goals and rejected directions

Keep these visible so the implementation does not drift:

- [ ] **Do not commit the SQLite database to Git.** Commit deterministic projections and migrations, not WAL/database binaries.
- [ ] **Do not make SQL the only recoverable copy.** A user must be able to rebuild local state from Git projections plus observed code facts.
- [ ] **Do not run Claude/Codex in every Git hook.** Hooks enqueue deterministic work only.
- [ ] **Do not let subagents directly update the ledger or files.** They return typed proposals.
- [ ] **Do not persist full source code or diff bodies in the ledger.** Store selectors, hashes, summaries, provenance and bounded evidence.
- [ ] **Do not add a vector database before FTS5 and graph/temporal queries are proven insufficient.**
- [ ] **Do not add a new MCP tool for every Book query.** Prefer resources and the existing small mutation surface.
- [ ] **Do not auto-promote advisory recommendations to completion gates.** Promotion requires quality evidence and explicit policy.
- [ ] **Do not create parallel YAML and SQL domain models.** Both must use the same contracts and canonical IDs.
- [ ] **Do not make provider-specific prompts part of domain logic.** Provider adapters remain replaceable.
- [ ] **Do not treat an LLM summary as observed evidence.** It is a hypothesis until linked to verifiable evidence.

---

# Pull request checklist

Use this on every PR in the workstream:

- [ ] Linked sprint task ID.
- [ ] Contract/schema impact documented.
- [ ] Migration included or explicitly not required.
- [ ] Determinism test added.
- [ ] Idempotency/retry test added where relevant.
- [ ] Stale HEAD/worktree test added where relevant.
- [ ] Positive, negative and boundary fixtures added.
- [ ] Privacy/storage audit updated.
- [ ] Package-boundary audit passes.
- [ ] CLI/MCP envelopes remain compatible.
- [ ] Crash/rollback behavior tested.
- [ ] Agent output treated as untrusted where relevant.
- [ ] Docs and runbook updated.
- [ ] Verification evidence linked.

---

# Weekly progress template

```markdown
## Week of YYYY-MM-DD

**Active sprint:** ALx
**Sprint goal:**
**Overall state:** Green / Yellow / Red

### Completed
- [x] ALx-xx — evidence link

### In progress
- [ ] ALx-xx — owner — expected gate

### Blocked
- [ ] ALx-xx — blocker — decision owner — unblock condition

### Metrics
- Hook enqueue p95:
- Incremental analysis p95:
- Warm query p95:
- Ledger drift count:
- Duplicate/lost events:
- Recommendation precision@3 / recall@3:
- Subagent spawns per task p50 / p95:
- Projection drift count:

### Decisions made
- Decision:
- Reason:
- ADR / issue:

### Risks
- Risk:
- Probability / impact:
- Mitigation:

### Next week
- [ ]
```

---

# Recommended GitHub Project fields

| Field | Values |
|---|---|
| Task ID | `ALx-xx` |
| Sprint | AL0–AL10 |
| Status | Not started / In progress / Blocked / In review / Done |
| Priority | P0 / P1 / P2 |
| Owner package | contracts / core / local-runtime / surfaces / docs / security / evals |
| Dependency | Task IDs |
| Estimate | Team-defined |
| Risk | Low / Medium / High |
| Evidence | Test, benchmark, runbook or readback link |
| Exit gate | Gate ID |
| Feature mode | yaml / dual / shadow / ledger |

---

# First implementation slice

For the smallest valuable sequence, start here:

1. [ ] AL0 authority and schemas.
2. [ ] AL1 evidence correctness before further enforcement work.
3. [ ] AL2 event, snapshot, current graph and evidence-binding tables.
4. [ ] AL3 YAML import/export and dual-compare mode.
5. [ ] AL4 thin post-commit queue plus stale-job cancellation.
6. [ ] AL5 deterministic architecture delta for imports, ownership and persistence boundaries.
7. [ ] AL7 `book status/query/diff` CLI.
8. [ ] AL9 deterministic architecture changelog projection.
9. [ ] Only then add AL6 automatic subagent investigation.

This sequence delivers a useful SQL-backed Book and passive documentation loop before taking on provider orchestration complexity.
