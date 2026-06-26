# Sprint Checklist: ArchContext Architecture Ledger & Passive Architecture Control Loop

> **Status**: Executing - AL0 through AL9 complete; AL10 rollout hardening in progress
> **Slug**: `archctx-architecture-ledger`
> **Created**: 2026-06-24
> **Updated**: 2026-06-26
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
| AL1 | Recommendation evidence correctness | P0 | AL0 | ☑ |
| AL2 | SQLite architecture ledger foundation | P0 | AL0 | ☑ |
| AL3 | YAML ↔ ledger migration and dual mode | P0 | AL2 | ☑ |
| AL4 | Passive Git/runtime change capture | P0 | AL2, AL3 | ☑ |
| AL5 | Code diff → evidence → architecture delta pipeline | P0 | AL1, AL3, AL4 | ☑ |
| AL6 | Provider-neutral subagent orchestration | P1 | AL2, AL4, AL5 | ☑ |
| AL7 | LLM-first CLI/MCP retrieval surface | P0 | AL2, AL3, AL5 | ☑ |
| AL8 | Recommendation scheduler, suppression and feedback | P0 | AL1, AL5, AL6, AL7 | ☑ |
| AL9 | Documentation placement and deterministic projections | P0 | AL3, AL5, AL6 | ☑ |
| AL10 | Shadow rollout, migration and GA hardening | P0 | AL0–AL9 | ◐ |

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

- [x] **AL1-01 · P0 · `practice-engine`** — Replace globally shared context evidence with practice-bound evidence.
  - Evidence: `packages/core/practice-engine/src/index.ts` uses typed `practiceBindings` through `boundPracticeEvidence`; `bun test packages/core/practice-engine/test/practice-engine.test.ts`.
- [x] **AL1-02 · P0 · `contracts`** — Add `practiceId`, `triggerId`, `subject`, `provenance` and `coverage` to bound evidence.
  - Evidence: `packages/contracts/src/ports.ts`; direct-reference fixtures in `evals/practices/direct-practice-reference.jsonl`.
- [x] **AL1-03 · P0 · `practice-engine`** — Ensure unrelated `observed` or `verified` evidence cannot raise another practice’s score or enforcement level.
  - Evidence: `requires typed practice binding before observed context evidence can promote a candidate` test.
- [x] **AL1-04 · P0 · `practice-engine`** — Remove practice identification through evidence ID or summary substring matching.
  - Evidence: `recommendations follow the typed practice binding, not stale label text in evidence` test.
- [x] **AL1-05 · P0 · `practice-engine`** — Split predicates into `import-edge-added`, `cross-boundary-import-added` and `declared-layer-violation-observed`.
  - Evidence: `splits generic import-edge evidence from typed boundary violation predicates` test.
- [x] **AL1-06 · P0 · `architecture-domain`** — Add explicit boundary membership and direction evaluation required by layer-violation evidence.
  - Evidence: `parseArchitectureDirectionViolationSubject` and `isArchitectureDirectionalEdgeViolationSubject` in `packages/core/architecture-domain/src/index.ts`; domain test covers membership and `source->target` direction.
- [x] **AL1-07 · P0 · `practice-engine`** — Replace `missingTermPredicate` authority with typed absence probes and complete/partial/unknown coverage.
  - Evidence: `typedAbsenceProbeEvidence` in `packages/core/practice-engine/src/index.ts`; telemetry absence test proves complete coverage can promote and partial coverage remains advisory.
- [x] **AL1-08 · P0 · `practice-engine`** — Apply negative path rules to individual subjects instead of suppressing an entire practice.
  - Evidence: `inputForEligibleSubjects` and `filters negative scopes per subject instead of suppressing mixed source and test changes` test.
- [x] **AL1-09 · P0 · `practice-engine` / `check-registry`** — Detect arbitrary-length cycles with DFS and distinguish new cycles from baseline cycles.
  - Evidence: `detects import cycles longer than two nodes` and `registered complete checker blocks only new cycle evidence` tests. Implementation lives in practice structural evidence and deterministic checker; `pressure-engine` remains a broad signal source.
- [x] **AL1-10 · P0 · `evals`** — Add no-label structural fixtures that prohibit practice IDs, aliases and titles in task, path, symbol and evidence text.
  - Evidence: `evals/practices/no-keyword-structural-positive.jsonl`; gate reports 30 cases and 100.0% recall.
- [x] **AL1-11 · P0 · `evals`** — Add evidence-shuffle mutation tests.
  - Acceptance: expected recommendation labels do not move with unrelated evidence payloads.
  - Evidence: `scorePracticeEvidenceShuffle` in `evals/run.ts`; gate reports 0.0% contamination.
- [x] **AL1-12 · P1 · `evals`** — Report precision@3, recall@3, benign advisory false-positive rate, per-practice support and confidence calibration.
  - Evidence: `docs/verification/m6-representative-eval-report.md`.
- [x] **AL1-13 · P0 · `policy-engine`** — Keep automatic checkpoint promotion disabled until all AL1 gates pass.
  - Evidence: `docs/runbooks/architecture-ledger-rollout.md` enabling rule 3; enforcement remains repo policy opt-in in `packages/core/practice-engine/src/enforcement.ts` and tests cover policy-disabled advisory behavior.
- [x] **AL1-14 · P1 · `practice-engine`** — Add recommendation explanation output showing exact predicate, subject and evidence binding.
  - Evidence: `recommendationEvidenceExplanation` in `packages/core/practice-engine/src/index.ts`; typed binding test asserts `Evidence binding: unit-test:symbol.service:checkpoint:complete`.

### Exit gate

- [x] **AL1-EG1** — Unrelated evidence escalation is blocked in 100% of tests.
  - Evidence: `bun test packages/core/practice-engine/test/practice-engine.test.ts` (23 pass, 0 fail).
- [x] **AL1-EG2** — Plain import edges never prove a declared layer violation.
  - Evidence: `plain import edges do not prove declared layer violations during recommendation` test.
- [x] **AL1-EG3** — Incomplete context never produces observed absence.
  - Evidence: telemetry absence test covers heuristic fallback and partial-coverage advisory behavior.
- [x] **AL1-EG4** — Three-node and longer new cycles are detected; pre-existing cycles are not reported as new.
  - Evidence: cycle DFS and baseline comparison tests in `packages/core/practice-engine/test/practice-engine.test.ts`.
- [x] **AL1-EG5** — No-label structural Top-3 recall ≥ 90% and held-out precision@3 ≥ 80%.
  - Evidence: `bun evals/run.ts --check` reports 100.0% no-keyword structural recall and 100.0% recommendation precision@3.
- [x] **AL1-EG6** — Hard-gate false positives = 0.
  - Evidence: `bun evals/run.ts --check` reports heuristic-only hard-gate rate 0.0% and dynamic-doc hard-gate rate 0.0%.

### AL1 execution log

- 2026-06-25: Completed AL1 recommendation evidence correctness on branch `codex/architecture-ledger-al1`.
- 2026-06-25: Focused tests passed: `bun test packages/core/architecture-domain/test/domain.test.ts` (10 pass, 0 fail) and `bun test packages/core/practice-engine/test/practice-engine.test.ts` (23 pass, 0 fail).
- 2026-06-25: Eval gate passed: `bun evals/run.ts --check` with Top-3 recall 100.0%, evidence-bound non-advisory precision@3 100.0%, no-keyword structural recall 100.0%, evidence-shuffle contamination 0.0%, hard-gate false positives 0.0%.
- 2026-06-25: Typecheck passed: `bun run typecheck`.
- 2026-06-25: Full verification passed: `bun run verify` exited 0 after 688 tests, package-boundary/privacy/readback ledgers, sprint-status check, and representative eval. Non-fatal local daemon diagnostic observed for an existing user-data `runtime.sqlite`.
- 2026-06-25: AL1 verification note captured in `docs/verification/architecture-ledger-al1-evidence-correctness.md`; representative eval report refreshed in `docs/verification/m6-representative-eval-report.md`.

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

- [x] `architecture_events`
- [x] `architecture_snapshots`
- [x] `architecture_entities_current`
- [x] `architecture_relations_current`
- [x] `architecture_constraints_current`
- [x] `evidence_items`
- [x] `evidence_bindings`
- [x] `recommendation_runs`
- [x] `recommendations`
- [x] `recommendation_feedback`
- [x] `agent_jobs`
- [x] `projection_state`
- [x] `source_cursors`
- [x] `waivers`

### Tasks

- [x] **AL2-01 · P0 · `local-store-sqlite`** — Add forward-only migrations for all ledger tables.
- [x] **AL2-02 · P0 · `local-store-sqlite`** — Scope every mutable row by repository and worktree identity; include branch/HEAD where semantically required.
- [x] **AL2-03 · P0 · `architecture-ledger`** — Implement append-only event writes with unique idempotency keys.
- [x] **AL2-04 · P0 · `architecture-ledger`** — Add `previous_event_hash` and canonical `event_hash` for tamper-evident sequencing.
- [x] **AL2-05 · P0 · `architecture-ledger`** — Materialize current entity, relation and constraint tables in the same transaction as accepted event append.
- [x] **AL2-06 · P0 · `architecture-ledger`** — Implement snapshot creation and canonical graph digest.
- [x] **AL2-07 · P0 · `architecture-ledger`** — Implement replay from an empty database to a selected event or snapshot.
- [x] **AL2-08 · P0 · `architecture-ledger`** — Verify replayed current state equals materialized current state byte-for-byte after canonicalization.
- [x] **AL2-09 · P0 · `local-store-sqlite`** — Add foreign keys, uniqueness constraints and indexes for temporal and graph queries.
- [x] **AL2-10 · P1 · `local-store-sqlite`** — Add FTS5 over summaries, rationale, decision titles and evidence summaries; exclude source body.
- [x] **AL2-11 · P0 · `local-store-sqlite`** — Add source-storage schema guard for new tables.
- [x] **AL2-12 · P0 · `architecture-ledger`** — Implement event batch transaction and rollback on any invalid payload.
- [x] **AL2-13 · P0 · `runtime-daemon`** — Enforce single-writer ownership for event append and snapshot creation.
- [x] **AL2-14 · P1 · `architecture-ledger`** — Add safe compaction: snapshot old events without losing auditability or rebuild ability.
- [x] **AL2-15 · P1 · `local-store-sqlite`** — Add backup, integrity check and corruption recovery commands.
- [x] **AL2-16 · P1 · `tests`** — Run the same migration/replay fixtures through Node `node:sqlite` and Bun SQLite adapters.
- [x] **AL2-17 · P1 · `architecture-ledger`** — Add views for current graph, open recommendations, recent changes and unresolved evidence.
- [x] **AL2-18 · P1 · `observability`** — Record local operation duration, row counts and rebuild reason without recording code content.

### Exit gate

- [x] **AL2-EG1** — 1,000-event replay yields the expected graph and identical digest on repeated runs.
- [x] **AL2-EG2** — Duplicate event retries do not create duplicate state.
- [x] **AL2-EG3** — Injected failure at every transaction step leaves no partial graph mutation.
- [x] **AL2-EG4** — Schema audit confirms no source or diff body columns.
- [x] **AL2-EG5** — Database deletion and rebuild path is documented and tested.

### AL2 execution log

- 2026-06-25: Completed SQLite architecture ledger foundation on branch `codex/architecture-ledger-al2`.
- 2026-06-25: Focused SQLite tests passed: `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 30000` (21 pass, 0 fail).
- 2026-06-25: Node/Bun adapter readback passed: `node scripts/architecture-ledger-sqlite-adapter-readback.mjs` with matching graph digest `sha256:0b526aeac5b37b8153a608d0bda661ac52c9027cd50f7670cae6a76b62da16f1`.
- 2026-06-25: Typecheck passed: `bun run typecheck`.
- 2026-06-25: Package boundary and sprint status checks passed: `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`.
- 2026-06-25: PR #41 is the AL2 review surface; remote Verify covers Governance plus Ubuntu/macOS/Windows on Node 24.x and 25.x. Windows cleanup failures were fixed in the AL2 readback tests and adapter script without changing ledger runtime semantics.
- 2026-06-25: AL2 verification note captured in `docs/verification/architecture-ledger-al2-sqlite-foundation.md`.

---

# AL3 · YAML ↔ ledger migration and dual mode

**Goal:** migrate safely from filesystem-first authority without losing Git reviewability, portability or recovery.

### Tasks

- [x] **AL3-01 · P0 · `model-store-yaml`** — Implement deterministic import of manifest, nodes, relations, constraints, ADR metadata and policies into ledger events.
  - Evidence: `listModelFiles` includes `.archcontext/manifest.yaml`, model records, policies, practices, decisions and `docs/adr/ADR-*.md`; `planYamlToArchitectureLedgerImport` parses ADR Markdown frontmatter and imports manifest/policy/ADR metadata as digest-backed declared evidence while nodes, relations and constraints remain graph mutations. Real repo dry-run imported 44 records, including 40 ADR metadata records, with 0 unsupported files and clean drift.
- [x] **AL3-02 · P0 · `renderer`** — Implement deterministic export from ledger current state to `.archcontext/` YAML.
  - Evidence: `projectArchitectureLedgerStateToYamlFiles` in `packages/core/architecture-ledger/src/index.ts`; daemon/CLI `ledger project --to-git` tests restore missing Git projection files from SQLite current state.
- [x] **AL3-03 · P0 · `architecture-domain`** — Define one canonical ordering and serialization for IDs, collections, metadata and timestamps.
  - Evidence: `canonicalArchitectureJson`, `canonicalArchitectureYaml`, and exported `parseJsonOrStableYaml` in `packages/core/architecture-domain/src/index.ts`.
- [x] **AL3-04 · P0 · `reconcile-engine`** — Add bidirectional digest comparison and a typed drift report.
  - Evidence: `reconcileArchitectureLedgerDrift` emits `archcontext.architecture-ledger-reconcile/v1` with ledger-to-Git projection and Git-to-ledger semantic digest directions; daemon and CLI `ledger drift --json` expose the typed reconcile report with authority-scoped candidate reconcile actions.
- [x] **AL3-05 · P0 · `runtime-daemon`** — Add read modes: `yaml`, `dual-compare`, `ledger-shadow`, `ledger`.
  - Evidence: `RuntimeArchitectureLedgerModes` now reports real read authority; ledger-authoritative runtime reads use a daemon-owned ledger-backed `ModelStore` for `validate`, `context`, `prepare`, `checkpoint`, `complete`, landscape context and explorer projection while ChangeSet writes still validate against YAML before ledger append.
- [x] **AL3-06 · P0 · `runtime-daemon`** — Add write modes: `yaml`, `dual`, `ledger-with-projection`.
  - Evidence: `RuntimeArchitectureLedgerModes` in `packages/local-runtime/runtime-daemon/src/index.ts`; dual and ledger-with-projection apply tests in `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts`.
- [x] **AL3-07 · P0 · `changeset-engine`** — In dual mode, append event and update projection atomically from the user’s perspective; recover both sides after crash.
  - Evidence: `ChangeSetEngine.apply` passes the active journal ID to the validate-before-commit hook; runtime dual/ledger-with-projection apply records the planned ledger event before append and append summary after success; SQLite startup recovery keeps the applied projection and commits the pending journal when the ledger idempotency event already exists, while append failure before commit still rolls back YAML writes.
- [x] **AL3-08 · P0 · `git-adapter`** — Detect branch checkout, rebase, reset and worktree changes; select or rebuild the correct ledger cursor.
  - Evidence: `architectureLedgerGitCursor` records a stable `source.git.current` cursor, SQLite/TestLocalStore expose cursor readback, and CLI fixture `CLI refreshes ledger cursor across branch, reset, rebase, and worktree changes` proves graph state stays stable while cursor events advance.
- [x] **AL3-09 · P0 · `architecture-ledger`** — Define conflict behavior when Git projection changes outside ArchContext.
  - Evidence: `planExternalProjectionChangeToArchitectureLedgerEvent` imports external Git projection drift as `architecture.projection.external_change.proposed` without semantic operations; daemon `ledger rebuild --from-git` requires `--accept-external-projection` before applying the external projection to current state.
- [x] **AL3-10 · P0 · `cli`** — Add `archctx ledger migrate --from-yaml --dry-run`.
  - Evidence: `runLedgerCommand` in `packages/surfaces/cli/src/main.ts`; CLI dry-run test in `packages/surfaces/cli/test/cli.test.ts`.
- [x] **AL3-11 · P0 · `cli`** — Add `archctx ledger rebuild --from-git` and `archctx ledger project --to-git`.
  - Evidence: `runLedgerCommand` in `packages/surfaces/cli/src/main.ts`; CLI test covers rebuild from Git, missing projection drift, and project back to Git.
- [x] **AL3-12 · P0 · `cli`** — Add `archctx ledger drift --json` with actionable reason codes.
  - Evidence: `compareArchitectureLedgerStateToYaml` reason codes include `semantic-drift`, `projection-file-missing`, `projection-file-digest-mismatch` and `projection-file-extra`; CLI test covers `projection-file-missing`.
- [x] **AL3-13 · P1 · `migration`** — Preserve existing IDs and map legacy records without generating new semantic entities.
  - Evidence: `preserves declared semantic IDs from legacy file paths and projects canonical paths` keeps semantic IDs from YAML `id` fields, maps legacy filenames to canonical projection paths, and does not invent replacement entities.
- [x] **AL3-14 · P1 · `migration`** — Add backup and one-command rollback to YAML authority.
  - Evidence: `archctx ledger rollback --to-yaml --dry-run|--write` is daemon-owned, writes only after fresh worktree digest validation, backs up existing managed projection files under `.archcontext/backups/ledger-rollback/`, removes stale managed files, projects SQLite current state back to Git YAML, and returns the recommended `ARCHCONTEXT_LEDGER_MODE=yaml` switch surface.
- [x] **AL3-15 · P1 · `tests`** — Add fixtures for merge conflicts, rebase, detached HEAD and two simultaneous worktrees.
  - Evidence: CLI tests cover branch/reset/rebase/worktree cursor refresh, detached HEAD cursor refresh, linked worktree scope isolation with shared runtime state, and merge-conflict YAML rejection without ledger mutation.
- [x] **AL3-16 · P1 · `package-boundaries`** — Verify CLI, MCP and agents cannot bypass the daemon to mutate either store.
  - Evidence: `scripts/package-boundary-audit.mjs` now rejects production surface code that directly appends/rebuilds ledger state or directly writes/removes `.archcontext/model`; verification passed with `node scripts/package-boundary-audit.mjs`.

### Exit gate

- [x] **AL3-EG1** — YAML → ledger → YAML has zero semantic drift.
  - Evidence: `plans deterministic YAML import and projects back with zero semantic drift`; ADR/policy/manifest metadata import does not affect graph digest when only ADR metadata changes.
- [x] **AL3-EG2** — Deleting SQLite and rebuilding from Git reproduces the same architecture digest.
  - Evidence: `CLI rebuild reproduces graph after SQLite deletion and project restores deleted YAML` deletes the runtime SQLite files and rebuilds the same graph digest from Git.
- [x] **AL3-EG3** — Deleting generated YAML and projecting from SQLite reproduces the same files.
  - Evidence: `CLI rebuild reproduces graph after SQLite deletion and project restores deleted YAML` removes a generated node projection and `ledger project --to-git --write` restores the exact previous file body with clean drift.
- [x] **AL3-EG4** — Rebase and branch-switch fixtures never leak state across worktrees.
  - Evidence: `CLI refreshes ledger cursor across branch, reset, rebase, and worktree changes`; `CLI keeps ledger cursor scoped across detached HEAD and simultaneous worktrees`.
- [x] **AL3-EG5** — Rollback to YAML mode succeeds without data loss.
  - Evidence: runtime and CLI rollback tests verify backup manifest/files, stale managed-file removal, canonical projection restoration, clean drift, and YAML validation after rollback.

### AL3 execution log

- 2026-06-25: Completed AL3 dry-run bridge on branch `codex/architecture-ledger-al3`.
- 2026-06-25: Added stable YAML/JSON parser exports and canonical architecture serialization in `architecture-domain`.
- 2026-06-25: Added read-only YAML → ledger event plan, ledger graph → YAML projection, and typed semantic drift report in `architecture-ledger`.
- 2026-06-25: Hardened dry-run migration so schema-valid but invalid YAML records are reported as `invalid-record` drift instead of aborting the whole import.
- 2026-06-25: Added `archctx ledger migrate --from-yaml --dry-run`; command does not append to SQLite or write projection files.
- 2026-06-25: Focused verification passed: `bun test packages/core/architecture-ledger/test/architecture-ledger.test.ts packages/core/architecture-domain/test/domain.test.ts --timeout 30000`; `bun test packages/surfaces/cli/test/cli.test.ts --timeout 30000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`.
- 2026-06-25: Full verification passed after final hardening: `bun test --timeout 60000` (695 pass); `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-25: Remote PR #42 Windows readback exposed hosted-runner daemon startup and installed-CLI child process timeouts; platform-specific Windows budgets were added while preserving Linux/macOS defaults.
- 2026-06-25: Added runtime architecture-ledger mode contract and status readback for `yaml`, `dual`, `ledger-shadow`, and `ledger-authoritative` rollout modes; this first slice kept runtime read authority on YAML until ledger-current-state reads landed.
- 2026-06-25: Added `dual` and `ledger-with-projection` apply paths: successful ChangeSet apply appends a daemon-owned ledger event, stores only digests/metadata instead of YAML bodies, and keeps Git `.archcontext/` projection updates reviewable.
- 2026-06-25: Added ChangeSet validate-before-commit hook so ledger append failure aborts the journal and rolls back YAML writes before success is reported.
- 2026-06-25: Focused runtime verification passed: `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "architecture ledger mode" --timeout 30000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger-authoritative write mode" --timeout 30000`; `bun test packages/core/architecture-domain/test/domain.test.ts -t "YAML parser" --timeout 30000`; `bun run typecheck`.
- 2026-06-25: Full runtime write-mode module verification passed: `bun test --timeout 60000` (699 pass); `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-25: Added ledger current-state readback and CLI rebuild/project/drift module: `ledger state` can read SQLite current state, `ledger rebuild --from-git` rebuilds from Git YAML with delete support and no-op behavior when current state already matches, `ledger project --to-git --write` restores Git projection files from ledger state, and `ledger drift --json` reports actionable projection reason codes.
- 2026-06-25: Focused ledger readback verification passed: `bun test packages/core/architecture-ledger/test/architecture-ledger.test.ts --timeout 30000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger" --timeout 30000`; `bun test packages/surfaces/cli/test/cli.test.ts -t "ledger" --timeout 60000`; `bun run typecheck`.
- 2026-06-25: Full ledger readback CLI module verification passed: `bun run verify`; `bun test --timeout 60000` (705 pass); `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-25: Added ledger-backed runtime `ModelStore` reads for ledger-authoritative mode: Git/YAML still owns manifest, product, policies, practices and decisions, but `.archcontext/model/{nodes,relations,constraints}` reads are projected from SQLite current state for `validate`, `context`, `prepare`, `checkpoint`, `complete`, landscape context and explorer projection.
- 2026-06-25: Focused runtime read-mode verification passed: `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 60000`; `bun run typecheck`.
- 2026-06-25: Full runtime read-mode module verification passed with isolated runtime state: `ARCHCONTEXT_STATE_DIR="$(mktemp -d /tmp/archctx-verify.XXXXXX)" bun run verify`; `bun test --timeout 60000` (706 pass); `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-25: Added ChangeSet dual-write crash recovery: runtime records planned/appended ledger recovery metadata in the ChangeSet journal, and SQLite pending-journal recovery preserves applied projection files when the ledger idempotency event was already appended before journal commit.
- 2026-06-25: Focused ChangeSet recovery verification passed: `bun test packages/core/changeset-engine/test/changeset-engine.test.ts --timeout 30000`; `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 60000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger" --timeout 60000`.
- 2026-06-25: Full ChangeSet recovery module verification passed: `ARCHCONTEXT_STATE_DIR="$(mktemp -d /tmp/archctx-verify.XXXXXX)" bun run verify`; `bun test --timeout 60000` (707 pass); `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-25: Added Git cursor and external projection conflict module: rebuild records stable `source.git.current` cursor refresh events for checkout/reset/rebase/worktree changes, and external Git projection semantic drift is stored as a proposed event until explicit `--accept-external-projection` reconcile.
- 2026-06-25: Focused cursor/conflict verification passed: `bun test packages/core/architecture-ledger/test/architecture-ledger.test.ts --timeout 30000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger" --timeout 60000`; `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 60000`; `bun test packages/surfaces/cli/test/cli.test.ts -t "ledger|cursor" --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-25: Full cursor/conflict module verification passed after rerunning the root gate with isolated runtime state: `ARCHCONTEXT_STATE_DIR="$(mktemp -d /tmp/archctx-verify.XXXXXX)" bun run verify`; independent full test readback `bun test --timeout 60000` passed with 710 tests.
- 2026-06-25: Added AL3 rollback/worktree/bypass module: daemon/RPC/CLI rollback restores YAML authority projection from SQLite current state with backup, CLI fixtures cover merge conflicts, detached HEAD and simultaneous worktrees, and package-boundary audit blocks production surfaces from direct ledger/projection mutation.
- 2026-06-25: Focused rollback/worktree verification passed: `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger" --timeout 90000`; `bun test packages/surfaces/cli/test/cli.test.ts -t "ledger|worktree|merge|rollback|cursor" --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `git diff --check`.
- 2026-06-25: Full rollback/worktree module verification passed: `bun run verify` exited 0 with 714 tests, packaged CLI smoke, privacy/security/readback ledgers, sprint-status check and representative eval; isolated-state practice verification also passed with `ARCHCONTEXT_STATE_DIR="$(mktemp -d /tmp/archctx-practice-verify.XXXXXX)" bun run verify:practices`.
- 2026-06-25: Added AL3 import-completeness module: ADR Markdown frontmatter is collected from `docs/adr/ADR-*.md`, evidence-only manifest/policy/ADR records preserve declared IDs without graph mutation, and legacy YAML filenames project back to canonical semantic-ID paths.
- 2026-06-25: Focused import-completeness verification passed: `bun test packages/core/architecture-ledger/test/architecture-ledger.test.ts --timeout 90000`; `bun test packages/surfaces/cli/test/cli.test.ts -t "SQLite deletion|ledger|rollback|worktree|merge|cursor" --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger" --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; real repo `ledger migrate --from-yaml --dry-run` imported 44 records, including 40 ADR metadata records, with 0 unsupported files and clean drift.
- 2026-06-25: Full import-completeness module verification passed with isolated runtime state: `ARCHCONTEXT_STATE_DIR="$(mktemp -d /tmp/archctx-verify.XXXXXX)" bun run verify`; full test suite passed with 717 tests, packaged CLI smoke, privacy/security/readback ledgers, sprint-status check and representative eval.
- 2026-06-25: Remote PR #49 Windows readback exposed `EBUSY` when the SQLite deletion fixture removed `runtime.sqlite` immediately after daemon shutdown; the fixture now retries transient Windows cleanup errors while preserving the real SQLite deletion/rebuild assertion. Local focused test and full isolated `bun run verify` passed after the fix.
- 2026-06-25: Added AL3 reconcile-engine integration: `reconcileArchitectureLedgerDrift` wraps the existing architecture-ledger drift facts into a bidirectional typed report, and runtime/CLI ledger drift/project/rollback/rebuild outputs now include `reconcile` alongside the raw drift report.
- 2026-06-25: Focused reconcile verification passed: `bun test packages/core/reconcile-engine/test/reconcile-engine.test.ts --timeout 30000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger project restores" --timeout 90000`; `bun test packages/surfaces/cli/test/cli.test.ts -t "CLI rebuilds ledger" --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `git diff --check`.
- 2026-06-25: Full AL3 reconcile module verification passed with isolated runtime state: `ARCHCONTEXT_STATE_DIR="$(mktemp -d /tmp/archctx-verify.XXXXXX)" bun run verify`; full test suite passed with 720 tests, packaged CLI smoke, privacy/security/readback ledgers, sprint-status check and representative eval.

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

- [x] **AL4-01 · P0 · `git-adapter`** — Normalize commit, staged and worktree change metadata without persisting diff body.
  - Evidence: `packages/local-runtime/git-adapter/src/index.ts`; `bun test packages/local-runtime/git-adapter/test/git-adapter.test.ts --timeout 30000`.
- [x] **AL4-02 · P0 · `git-adapter`** — Compute stable change fingerprints from repository ID, base SHA, head SHA, path set and CodeGraph digest.
  - Evidence: `computeGitChangeFingerprint`; stable/reordered path test in `packages/local-runtime/git-adapter/test/git-adapter.test.ts`.
- [x] **AL4-03 · P0 · `runtime-daemon`** — Add a persistent local job queue backed by `agent_jobs` or a separate typed runtime queue table.
  - Evidence: `0007_runtime_job_queue` migration in `packages/local-runtime/local-store-sqlite/src/index.ts`; `runtime_job_queue` intentionally separates mutable operational queue state from immutable ledger `agent_jobs`.
- [x] **AL4-04 · P0 · `runtime-daemon`** — Implement enqueue, claim, lease, retry, cancel and dead-letter semantics.
  - Evidence: SQLite queue lifecycle tests in `packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts`.
- [x] **AL4-05 · P0 · `runtime-daemon`** — Add debounce and coalescing for rapid file saves and sequential commits.
  - Evidence: `enqueueRuntimeAgentJob` coalesces queued jobs by `coalesceKey`; covered by `runtime job queue deduplicates fingerprints and coalesces queued jobs`.
- [x] **AL4-06 · P0 · `runtime-daemon`** — Deduplicate jobs by change fingerprint and analysis kind.
  - Evidence: queue partial unique index and daemon boundary test `runtime jobs enqueue Git metadata through daemon boundary and claim a lease`.
- [x] **AL4-07 · P0 · `cli`** — Add `archctx hooks install`, `uninstall`, `status` and `doctor`.
  - Evidence: `runHooksCommand` now supports install/status/remove/uninstall/doctor; `CLI renders central hook adapter install status and remove configuration` covers install, status, remove, uninstall and doctor.
- [x] **AL4-08 · P0 · `hooks`** — Install thin wrappers that only validate runtime availability and enqueue work.
  - Evidence: hook adapter contract now points to `archctx hook enqueue`; `hook enqueue uses the runtime job queue with fail-open and generated projection guards` proves the wrapper calls `jobsEnqueueGitHook`, returns fail-open on runtime outage, records only hashed hook logs, and declares `egress: none`.
- [x] **AL4-09 · P0 · `hooks`** — Add recursion guard so ArchContext-generated projection commits do not trigger an infinite loop.
  - Evidence: CLI skips `.archcontext/generated/**` hook paths before runtime; daemon `jobsEnqueueGitHook` also returns `archcontext.runtime-agent-job-skip/v1` without queue insertion for generated projection-only metadata.
- [x] **AL4-10 · P0 · `runtime-daemon`** — Attach every job to HEAD SHA and worktree digest; cancel or supersede stale jobs.
  - Evidence: `jobsEnqueueGitHook` attaches current scope and calls `cancelStaleRuntimeAgentJobs`; stale cancellation covered in `runtime job queue expires stale head or worktree jobs before new analysis can append`.
- [x] **AL4-11 · P1 · `policy-engine`** — Define advisory fail-open behavior and explicit fail-closed policy modes.
  - Evidence: practice policy schema and contract now accept `advisory`, legacy `active`, explicit `fail-open` and explicit `fail-closed`; `evaluatePracticeEnforcement` normalizes `active` to fail-closed, keeps advisory disabled/fail-open by default, reports fail-open failures as `nonBlockingViolations`, and `completeTaskGate` surfaces them as warnings without `practiceViolations` or `actionsRequired`.
- [x] **AL4-12 · P1 · `runtime-daemon`** — Add backpressure: queue cap, per-repository concurrency, priority and stale-job eviction.
  - Evidence: `0008_runtime_job_queue_hardening` adds queue priority and claim ordering; `enqueueRuntimeAgentJob` enforces queue caps with priority-aware eviction/rejection; `jobsClaim` enforces per-repository running concurrency.
- [x] **AL4-13 · P1 · `cli`** — Add `archctx jobs list/show/cancel/retry` with structured JSON.
  - Evidence: `runJobsCommand` exposes list/show/cancel/retry over daemon RPC; `CLI exposes runtime agent jobs list show cancel and retry operations` covers status filters, job lookup, cancel reason and retry reason.
- [x] **AL4-14 · P1 · `observability`** — Record local queue depth, enqueue latency, coalescing ratio and failure reason.
  - Evidence: `archctx jobs stats` exposes queue/running depth, coalesced job count, coalescing ratio and last failure reason; hook enqueue keeps `hookLog.elapsedMs`.
- [x] **AL4-15 · P1 · `tests`** — Simulate 100 rapid commits, amend, rebase, reset and branch switches.
  - Evidence: `runtime job queue stress fixture preserves 100 rapid git cursor changes without duplicate active jobs` covers 100 commit/amend/rebase/reset/branch-switch cursor variants.
- [x] **AL4-16 · P1 · `docs/runbooks`** — Document shell compatibility, hook chaining and recovery when another tool owns hooks.
  - Evidence: `docs/runbooks/runtime-hook-queue.md`.

### Exit gate

- [x] **AL4-EG1** — Hook enqueue overhead p95 ≤ 150 ms on the reference machine.
  - Evidence: `docs/verification/architecture-ledger-al4-closeout-readback.json` records `p95Ms: 120` across 24 fast-path `archctx hook enqueue` samples.
- [x] **AL4-EG2** — No hook invokes a network provider or LLM by default.
  - Evidence: `scripts/architecture-ledger-al4-closeout-readback.ts run` verifies generated-projection skip, hook samples and `hooks doctor --host codex` all declare `egress: none` and `network: forbidden`.
- [x] **AL4-EG3** — No duplicate or lost jobs in the stress fixture.
  - Evidence: `runtime job queue stress fixture preserves 100 rapid git cursor changes without duplicate active jobs` asserts 100 distinct job IDs, one active queued job and 99 terminal superseded jobs.
- [x] **AL4-EG4** — Stale jobs cannot append events or update projections.
  - Evidence: `runtime jobs reject stale successful completion before worker side effects` and `docs/verification/architecture-ledger-al4-closeout-readback.json` prove stale worker `jobsComplete(... status: succeeded)` is rejected with `AC_CONTEXT_STALE` and the job is expired.
- [x] **AL4-EG5** — Existing user hooks remain chained and functional.
  - Evidence: `docs/verification/architecture-ledger-al4-closeout-readback.json` executes a POSIX `post-commit` wrapper that calls `archctx hook enqueue` and then preserves `.git/hooks/post-commit.local`, writing the chained marker with exit code 0.

### Execution log

- 2026-06-25 — AL4 queue foundation completed as one reviewable module:
  - Git metadata readers: commit, staged and worktree paths/statuses only; no source body or diff body persisted.
  - Stable fingerprint: repository/storage identity, base/head SHA, normalized path set, CodeGraph digest and analysis kind.
  - Runtime queue: separate `runtime_job_queue` table with enqueue, claim, lease, retry, cancel, dead-letter, debounce/coalescing, fingerprint dedupe and stale HEAD/worktree expiry.
  - Daemon boundary: `jobsEnqueueGitHook`, `jobsList`, `jobsClaim`, `jobsComplete`, `jobsRetry`, `jobsCancel`.
  - Verification: `bun test packages/local-runtime/git-adapter/test/git-adapter.test.ts --timeout 30000`; `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 60000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`.
  - Explicitly still out of scope: hook install/wrappers, recursion guard, jobs CLI, stress fixture, hook latency benchmark and user hook chaining gate.
- 2026-06-25 — AL4 hook queue integration completed as one reviewable module:
  - Hook surface: `archctx hooks install/status/remove/uninstall/doctor` now advertises queue-first `archctx hook enqueue` while retaining `hook checkpoint` as compatibility fallback.
  - Thin wrapper: `archctx hook enqueue` maps hook events to commit/staged/worktree metadata, calls `jobsEnqueueGitHook`, returns fail-open on runtime outage, and emits only hashed hook logs with `egress: none` / `network: forbidden`.
  - Recursion guard: CLI skips explicit or path-only `.archcontext/generated/**` changes before runtime, and daemon repeats the guard before queue insertion for direct RPC callers.
  - Jobs CLI: `archctx jobs list/show/cancel/retry` provides structured daemon-backed queue operations.
  - Verification: `bun test packages/surfaces/cli/test/cli.test.ts --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000`; `bun test packages/surfaces/cli/test/local-product-e2e.test.ts --timeout 120000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`.
  - Explicitly still out of scope: backpressure policy, observability metrics, 100-commit stress fixture, hook latency benchmark and user hook chaining gate.
- 2026-06-25 — AL4 queue hardening completed as one reviewable module:
  - Backpressure: `runtime_job_queue` now records priority; enqueue applies queue cap, priority-aware eviction/rejection and local `backpressure-queue-cap` reason codes.
  - Concurrency: `jobsClaim` enforces default per-repository running concurrency of 1 while allowing expired lease reclaim.
  - Observability: `jobsStats` / `archctx jobs stats` reports queue depth, running depth, active depth, coalesced job count, coalescing ratio and last local failure reason; hook enqueue retains elapsed latency in `hookLog.elapsedMs`.
  - Stress/runbook: SQLite stress fixture simulates 100 git cursor changes across commit/amend/rebase/reset/branch-switch modes; `docs/runbooks/runtime-hook-queue.md` covers POSIX shell compatibility, chaining and recovery.
  - Verification: `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts`; `bun test packages/surfaces/cli/test/cli.test.ts`; `bun run typecheck`.
  - Explicitly still out of scope: hook enqueue p95 benchmark, stale worker append/projection guard, and executable user hook chaining proof.
- 2026-06-25 — AL4 policy modes completed as one reviewable module:
  - Policy contract: `.archcontext/policies/practices.yaml` now has explicit `fail-open` and `fail-closed` modes while preserving legacy `active` as fail-closed compatibility.
  - Evaluation semantics: `advisory` remains disabled/fail-open by default; `fail-open` runs deterministic complete checks but records failures as `nonBlockingViolations`; `fail-closed` makes deterministic failures block completion.
  - Review/runtime surface: fail-open practice failures become warning findings and `extensions.nonBlockingPracticeViolations`; they do not populate `practiceViolations` or `actionsRequired`.
  - Verification: `bun test packages/contracts/test/contracts.test.ts`; `bun test packages/core/practice-engine/test/practice-engine.test.ts`; `bun test packages/core/review-engine/test/review-engine.test.ts`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts`; isolated `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-verify-state-XXXXXX) bun run verify` passed with 736 tests, packaged CLI smoke, privacy/security readbacks, acceptance ledgers, sprint-status check and representative eval.
  - Explicitly still out of scope: hook enqueue p95 benchmark, stale worker append/projection guard, and executable user hook chaining proof.
- 2026-06-25 — AL4 exit gates closed as one reviewable module:
  - Fast hook path: `packages/surfaces/cli/bin/archctx` now dispatches `hook enqueue` through a lightweight local-only entrypoint before loading the full CLI, preserving fail-open behavior and generated-projection guards.
  - Stale worker guard: `jobsComplete(... status: succeeded)` now rejects stale HEAD/worktree completions with `AC_CONTEXT_STALE` and expires the job before any success signal can drive worker side effects.
  - Readback: `scripts/architecture-ledger-al4-closeout-readback.ts` starts a daemon, samples hook enqueue overhead, proves no default hook egress, executes POSIX user-hook chaining and verifies stale completion rejection.
  - Verification: `bun test packages/surfaces/cli/test/cli.test.ts --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "runtime jobs" --timeout 90000`; `bun test scripts/architecture-ledger-al4-closeout-readback.test.ts`; `bun run record:al4:closeout`; `bun run readback:al4:closeout`.

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

- [x] **AL5-01 · P0 · `codegraph-adapter`** — Return changed symbols, edges and ownership-relevant subjects for a base/head pair.
  - Evidence: `CodeGraphAdapter.analyzeChangedSubjects` syncs changed paths, builds no-source CodeGraph context and returns `ArchitectureCandidateDelta/v1`; covered by `packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts`.
- [x] **AL5-02 · P0 · `contracts`** — Define stable subject selectors for repository, path, symbol, node, relation, API, datastore and external contract.
  - Evidence: `ArchitectureSubjectSelector/v1` in `packages/contracts/src/ledger.ts`, `schemas/runtime/architecture-subject-selector.schema.json`, and `packages/contracts/fixtures/valid/architecture-subject-selector.json`.
- [x] **AL5-03 · P0 · `architecture-delta`** — Normalize added, removed, moved, renamed and materially changed subjects.
  - Evidence: `buildArchitectureCandidateDelta` normalizes Git path status into `added`, `removed`, `moved`, `renamed` and `materially_changed`; covered by `packages/core/architecture-delta/test/architecture-delta.test.ts`.
- [x] **AL5-04 · P0 · `architecture-delta`** — Distinguish raw code facts from architecture interpretation.
  - Evidence: `ArchitectureCandidateDelta/v1` separates `rawFacts` from `interpretations`; interpretations are marked `heuristic: true` until later entity mapping and policy stages.
- [x] **AL5-05 · P0 · `architecture-delta`** — Bind every interpretation to one or more evidence items with coverage and confidence.
  - Evidence: delta tests assert every interpretation has evidence IDs and evidence is bound to both `subject` and `candidate-delta` with `authorityEffect: context-only`.
- [x] **AL5-06 · P0 · `architecture-delta`** — Map changed code subjects to declared architecture entities with explicit match reasons.
  - Evidence: `buildArchitectureCandidateDelta` accepts a read-only declared graph and emits `declaredSubjectMappings` with `declared-path-exact`, `declared-path-prefix`, `declared-name-match` and `declared-relation-endpoints` reasons; covered by `packages/core/architecture-delta/test/architecture-delta.test.ts`.
- [x] **AL5-07 · P0 · `architecture-delta`** — Represent unresolved mapping as ambiguity, never as a silently invented entity.
  - Evidence: `ArchitectureCandidateDelta/v1` now carries `mappingAmbiguities`; tests cover missing declared graph and equal-confidence multiple declared targets without creating mappings or candidate changes.
- [x] **AL5-08 · P0 · `architecture-domain`** — Generate typed candidate deltas for node, relation, constraint, owner, lifecycle and migration-state changes.
  - Evidence: `candidateChanges` are typed as `node-*`, `relation-*`, `constraint-*`, `owner-*`, `lifecycle-*` and `migration-state-*`; adapter tests prove CodeGraph changed subjects can be joined to runtime-provided declared graph context.
- [x] **AL5-09 · P0 · `architecture-domain`** — Separate target-state change from migration-state progress.
  - Evidence: `ArchitectureCandidateChange/v1` now requires `stateDimension: target-state | migration-state`, summary records `targetStateChanges` and `migrationStateProgress`, and delta tests assert migration-state progress is not mixed into target-state changes.
- [x] **AL5-10 · P0 · `policy-engine`** — Define which candidate deltas may auto-accept, require checkpoint, require proof or require human approval.
  - Evidence: `ArchitectureCandidateDeltaPolicyEvaluation/v1` classifies candidate changes into `auto-accept`, `require-checkpoint`, `require-proof` and `require-human-approval`; policy-engine tests cover high-confidence complete evidence, partial/medium confidence, migration progress, low/missing evidence and owner authority changes.
- [x] **AL5-11 · P0 · `changeset-engine`** — Convert accepted candidates into previewable ChangeSets and ledger event batches.
  - Evidence: `planArchitectureCandidateChangeSet` converts policy-accepted candidate changes into schema-valid `ChangeSetDraft` operations and deterministic `architecture_candidate_changeset_planned` events; covered by `packages/core/changeset-engine/test/changeset-engine.test.ts` and `docs/verification/architecture-ledger-al5-changeset-promotion.md`.
- [x] **AL5-12 · P0 · `review-engine`** — Reject unsupported entity deletion, owner change, boundary relaxation and external-contract claims.
  - Evidence: `reviewArchitectureCandidateChangeSet` rejects unsupported entity deletion, owner authority changes, boundary relaxation and external-contract claims before proposal acceptance; covered by `packages/core/review-engine/test/review-engine.test.ts` and `docs/verification/architecture-ledger-al5-review-rejection.md`.
- [x] **AL5-13 · P1 · `architecture-delta`** — Add rename/move correlation to avoid delete-plus-add churn.
  - Evidence: `normalizes path moves without emitting delete plus add churn` covers Git rename metadata where same basename means `moved`; rename metadata with changed basename is normalized as `renamed`.
- [x] **AL5-14 · P1 · `architecture-delta`** — Add baseline comparison so pre-existing issues are not attributed to the current task.
  - Evidence: `buildArchitectureCandidateDelta` accepts baseline candidate changes, suppresses matching pre-existing candidate keys from task-introduced output, and records `extensions.baselineAttribution`; covered by `packages/core/architecture-delta/test/architecture-delta.test.ts` and `docs/verification/architecture-ledger-al5-baseline-attribution.md`.
- [x] **AL5-15 · P1 · `fixtures`** — Add representative monolith-to-service, persistence boundary, public API, payment webhook, mapper removal and package-layer fixtures.
  - Evidence: `packages/core/architecture-delta/test/fixtures/representative-architecture-changes.ts` defines the six representative AL5 fixture scenarios and `architecture-delta.test.ts` asserts they map without unresolved ambiguity while emitting the expected typed candidate changes; readback in `docs/verification/architecture-ledger-al5-representative-fixtures.md`.
- [x] **AL5-16 · P1 · `observability`** — Record mapping coverage, unresolved subjects and evidence strength distribution.
  - Evidence: `ArchitectureCandidateDelta/v1.summary` now records `mappingCoverage`, `unresolvedSubjects` and `evidenceStrengthDistribution`; covered by `packages/core/architecture-delta/test/architecture-delta.test.ts`, `schemas/runtime/architecture-candidate-delta.schema.json`, and `docs/verification/architecture-ledger-al5-observability.md`.

### Exit gate

- [x] **AL5-EG1** — Same base/head pair always produces the same candidate delta and digest.
  - Evidence: `architecture-delta.test.ts` builds the same candidate delta with reordered Git path input and asserts identical `deltaDigest`.
- [x] **AL5-EG2** — No candidate architecture fact exists without typed evidence or an explicit heuristic marker.
  - Evidence: `ArchitectureCandidateDelta/v1` keeps raw code facts and heuristic interpretations separate; tests assert every interpretation has evidence IDs and evidence bindings.
- [x] **AL5-EG3** — Rename and move fixtures do not create false entity deletion/addition.
  - Evidence: `architecture-delta.test.ts` covers rename and move normalization without add/remove churn.
- [x] **AL5-EG4** — Baseline issues are separated from task-introduced issues.
  - Evidence: baseline attribution removes pre-existing candidate keys from `candidateChanges` while preserving changed-subject context and recording suppressed candidates under `extensions.baselineAttribution`.
- [x] **AL5-EG5** — All accepted mutations are represented as ChangeSets and ledger events.
  - Evidence: `planArchitectureCandidateChangeSet` defaults accepted actions to `auto-accept`, preserves non-accepted candidates as deferred policy outcomes, validates the generated ChangeSet against `schemas/runtime/changeset.schema.json`, and emits event batches hashed with `architectureEventHash`.

### Execution log

- 2026-06-25 — AL5 delta foundation started as one reviewable module:
  - Contracts: added `ArchitectureSubjectSelector/v1` and `ArchitectureCandidateDelta/v1`, plus `subject` and `candidate-delta` evidence binding targets.
  - Core: added deterministic `buildArchitectureCandidateDelta` normalization from Git metadata and normalized CodeGraph context into selectors, raw facts, heuristic interpretations, evidence items, evidence bindings and `deltaDigest`.
  - CodeGraph adapter: added `analyzeChangedSubjects` to sync changed paths, build no-source context and return a candidate delta for a base/head change cursor.
  - Verification artifact: `docs/verification/architecture-ledger-al5-delta-foundation.md`.
  - Verification: `bun test packages/core/architecture-delta/test/architecture-delta.test.ts`; `bun test packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts --timeout 90000`; `bun test packages/contracts/test/contracts.test.ts`; `bun run typecheck`.
- 2026-06-26 — AL5 declared mapping module completed as the next reviewable slice:
  - Contracts: extended `ArchitectureCandidateDelta/v1` with declared subject mappings, mapping ambiguities and typed candidate changes.
  - Core: changed code subjects now map to declared entity/relation/constraint targets with explicit match reasons; missing or equal-confidence mappings remain ambiguous.
  - Candidate deltas: generated typed node, relation, constraint, owner, lifecycle and migration-state candidate changes without mutating ledger authority.
  - CodeGraph adapter: `analyzeChangedSubjects` accepts a runtime-provided declared graph and passes it through to the delta builder.
  - Verification artifact: `docs/verification/architecture-ledger-al5-declared-mapping.md`.
  - Verification: `bun test packages/core/architecture-delta/test/architecture-delta.test.ts packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts packages/contracts/test/contracts.test.ts --timeout 90000`; `bun run typecheck`; `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al5-mapping-verify-state-XXXXXX) bun run verify`.
- 2026-06-26 — AL5 target/migration separation completed:
  - Contracts: `ArchitectureCandidateChange/v1` now carries an explicit `stateDimension` and candidate delta summary separates target-state changes from migration-state progress.
  - Core: migration-state candidate changes are emitted as `stateDimension: migration-state`; node, relation, constraint, owner and lifecycle changes remain `target-state`.
  - Verification artifact: `docs/verification/architecture-ledger-al5-target-migration-separation.md`.
  - Verification: `bun test packages/core/architecture-delta/test/architecture-delta.test.ts packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts packages/contracts/test/contracts.test.ts --timeout 90000`; `bun run typecheck`; `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al5-target-migration-verify-state-XXXXXX) bun run verify`.
- 2026-06-26 — AL5 ChangeSet proposal module completed:
  - ChangeSet engine: added `planArchitectureCandidateChangeSet` to convert policy-accepted candidate changes into previewable ChangeSet drafts without applying or writing authoritative state.
  - Ledger event preview: generated deterministic `architecture_candidate_changeset_planned` events with `architectureEventHash`, explicit deferred candidates and no source/diff bodies.
  - Verification artifact: `docs/verification/architecture-ledger-al5-changeset-promotion.md`.
  - Verification: `bun test packages/core/changeset-engine/test/changeset-engine.test.ts`; `bun run typecheck`.
- 2026-06-26 — AL5 review rejection module completed:
  - Review engine: added `reviewArchitectureCandidateChangeSet` to evaluate preview ChangeSet proposals before acceptance.
  - Rejection policy: unsupported entity deletion, owner authority changes, boundary relaxation and external-contract claims now produce explicit `archcontext.review/v1` error findings.
  - Verification artifact: `docs/verification/architecture-ledger-al5-review-rejection.md`.
  - Verification: `bun test packages/core/review-engine/test/review-engine.test.ts`; `bun run typecheck`.
- 2026-06-26 — AL5 baseline attribution module completed:
  - Architecture delta: `buildArchitectureCandidateDelta` now accepts a baseline candidate set and compares by target kind, target id, parent id, state dimension and change kind.
  - Attribution: pre-existing candidate keys are suppressed from task-introduced `candidateChanges`; suppressed baseline findings stay visible under `extensions.baselineAttribution`.
  - Verification artifact: `docs/verification/architecture-ledger-al5-baseline-attribution.md`.
  - Verification: `bun test packages/core/architecture-delta/test/architecture-delta.test.ts`; `bun run typecheck`; `bun test packages/core/architecture-delta/test/architecture-delta.test.ts packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts packages/contracts/test/contracts.test.ts --timeout 90000`; `bun test`; `node scripts/sprint-status-check.mjs`.
- 2026-06-26 — AL5 representative fixtures module completed:
  - Fixtures: added monolith-to-service, persistence boundary, public API, payment webhook, mapper removal and package-layer scenarios under `packages/core/architecture-delta/test/fixtures/representative-architecture-changes.ts`.
  - Coverage: `architecture-delta.test.ts` verifies the scenarios map without unresolved ambiguity and emit expected typed candidate changes without crossing the ledger authority boundary.
  - Verification artifact: `docs/verification/architecture-ledger-al5-representative-fixtures.md`.
  - Verification: `bun test packages/core/architecture-delta/test/architecture-delta.test.ts`; `bun test packages/core/architecture-delta/test/architecture-delta.test.ts packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts packages/contracts/test/contracts.test.ts --timeout 90000`; `bun run typecheck`; `bun test`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-26 — AL5 observability module completed:
  - Contracts: `ArchitectureCandidateDelta/v1.summary` now includes mapping coverage, unresolved-subject reason distribution and evidence strength distribution.
  - Core: `summarizeDelta` derives the observability fields from declared mappings, mapping ambiguities and bounded evidence metadata.
  - Verification artifact: `docs/verification/architecture-ledger-al5-observability.md`.
  - Verification: `bun test packages/core/architecture-delta/test/architecture-delta.test.ts packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts packages/contracts/test/contracts.test.ts packages/core/policy-engine/test/policy-engine.test.ts packages/core/changeset-engine/test/changeset-engine.test.ts --timeout 90000`; `bun run typecheck`; `bun test`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-26 — AL5 candidate policy module completed:
  - Contracts: added `ArchitectureCandidateDeltaPolicyEvaluation/v1` with per-candidate decisions, reason codes, summary counters and stable digests.
  - Core: `evaluateArchitectureCandidateDeltaPolicy` classifies candidate changes before ChangeSet promotion as `auto-accept`, `require-checkpoint`, `require-proof` or `require-human-approval`.
  - Verification artifact: `docs/verification/architecture-ledger-al5-candidate-policy.md`.
  - Verification: `bun test packages/core/policy-engine/test/policy-engine.test.ts --timeout 90000`; `bun test packages/contracts/test/contracts.test.ts --timeout 90000`; `bun run typecheck`; `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al5-candidate-policy-verify-state-XXXXXX) bun run verify`.

---

# AL6 · Provider-neutral subagent orchestration

**Goal:** use Claude/Codex as bounded investigators and document drafters, with predictable cost, frequency and provenance.

### Default spawn policy

A subagent is eligible only when all conditions are true:

1. Deterministic analysis found an architecture-relevant change or risk.
2. The risk and uncertainty meet the configured investigation thresholds, or the policy explicitly requests investigation.
3. Defaults require high risk plus high uncertainty for automatic investigation; lower thresholds must be explicit policy.
4. No equivalent completed or active job exists for the same fingerprint.
5. Repository, task and daily budget allow execution.
6. Cooldown has expired.
7. The user/provider configuration explicitly enables the adapter.

### Tasks

- [x] **AL6-01 · P0 · `contracts`** — Define `InvestigationRunnerPort` independent of Claude or Codex.
  - Evidence: `packages/contracts/src/ports.ts` defines provider-neutral `InvestigationRunnerPort`, `InvestigationRunnerInput` and `InvestigationContextBundle`; runner capabilities explicitly set `canMutateRepository: false`.
- [x] **AL6-02 · P0 · `agent-orchestrator`** — Implement job state machine: queued, running, succeeded, failed, cancelled, superseded and expired.
  - Evidence: `packages/core/agent-orchestrator/src/index.ts` defines `AGENT_JOB_STATE_TRANSITIONS`, `canTransitionAgentJobStatus` and `transitionAgentJobStatus`; tests reject queued-to-succeeded and terminal-to-running transitions.
- [x] **AL6-03 · P0 · `agent-orchestrator`** — Implement per-task, per-repository and daily spawn budgets.
  - Evidence: `evaluateInvestigationSpawn` enforces task, repository-day and total-day budgets; `AgentJob/v1.budget` now allows `maxRunsPerDay`; covered by `agent-orchestrator.test.ts` and `contracts.test.ts`.
- [x] **AL6-04 · P0 · `agent-orchestrator`** — Set safe defaults: maximum one investigative spawn per task and zero automatic spawns for low-risk changes.
  - Evidence: `DEFAULT_AGENT_ORCHESTRATION_POLICY` sets `maxRunsPerTask: 1`, `maxAutomaticRunsForLowRisk: 0`, and default automatic investigation thresholds to high risk plus high uncertainty; tests verify low-risk and medium-risk automatic changes are denied unless explicit policy/request allows them.
- [x] **AL6-05 · P0 · `agent-orchestrator`** — Add cooldown, deduplication, concurrency one per repository and cancellation on stale HEAD.
  - Evidence: `planRuntimeAgentQueueControls` defines deterministic cooldown debounce, coalescing, queue cap, priority, one-running-job claim policy and stale HEAD/worktree cancellation metadata; `jobsEnqueueGitHook` uses the plan at enqueue time, `jobsClaim` defaults to `maxRunningJobs: 1`, and `local-store-sqlite` enforces that limit inside the claim transaction.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000`; `bun test --timeout 90000`.
- [x] **AL6-06 · P0 · `agent-orchestrator`** — Build a minimal context bundle from ledger query results and evidence references; do not dump the whole repository.
  - Evidence: `buildInvestigationContextBundleFromLedgerQuery` selects bounded ledger refs, evidence binding IDs and candidate change IDs by stable order; `investigationContextBundle` rejects raw source, diff, prompt and completion payload fields; `jobsEnqueueGitHook` persists only bounded investigation context, Git path metadata and digests in the queued job.
  - Verification artifact: `docs/verification/architecture-ledger-al6-runtime-context-guards.md`.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000`; `bun test --timeout 90000`; `bun run typecheck`.
- [x] **AL6-07 · P0 · `contracts`** — Require typed output: finding, hypothesis, evidence references, unknowns, falsifier, proposed delta and confidence.
  - Evidence: `InvestigationReport/v1` findings now require non-empty evidence binding references, unknowns, falsifier, confidence, and a typed `ArchitectureCandidateChange/v1` `proposedDelta` with matching digest; schema fixtures include valid typed output and missing-proposed-delta rejection.
  - Verification: `bun test packages/contracts/test/contracts.test.ts --timeout 90000`; `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test --timeout 90000`; `bun run typecheck`.
- [x] **AL6-08 · P0 · `agent-orchestrator`** — Validate output schema and reject unknown entity IDs or unverifiable evidence references.
  - Evidence: `validateInvestigationReport` rejects job mismatch, direct mutation, malformed findings, missing proposed deltas, unknown evidence bindings, proposed-delta targets outside the bounded ledger context, proposed-delta parent IDs outside known entities, unverifiable proposed-delta evidence IDs and digest mismatch; `runInvestigationThroughPort` rejects invalid reports before returning them to callers.
  - Verification artifact: `docs/verification/architecture-ledger-al6-output-validation.md`.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test packages/contracts/test/contracts.test.ts --timeout 90000`; `bun test --timeout 90000`; `bun run typecheck`.
- [x] **AL6-09 · P0 · `security`** — Treat repository text and model output as untrusted; add prompt-injection and tool-escape tests.
  - Evidence: `validateInvestigationReport` rejects raw source, diff, prompt, completion, tool-call, command and write-field payloads; `planInvestigationReportProposal` keeps prompt-injection text behind `inputDigest` and produces only advisory typed proposal records; tests cover inert prompt-injection text plus tool-escape rejection through validator, runner port and proposal planning.
  - Verification artifact: `docs/verification/architecture-ledger-al6-security-proposals.md`.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test --timeout 90000`; `bun run typecheck`.
- [x] **AL6-10 · P0 · `changeset-engine`** — Prohibit direct agent write; agent output can only create a proposal awaiting deterministic validation.
  - Evidence: `planInvestigationReportProposal` marks report output as `authority: advisory-only`, `directMutationAllowed: false`, `requiredNextStep: deterministic-validation` and forbids ledger/YAML/docs/ChangeSet/tool/command actions; `planArchitectureCandidateChangeSet` rejects agent/proposal provenance before ChangeSet planning.
  - Verification artifact: `docs/verification/architecture-ledger-al6-security-proposals.md`.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test packages/core/changeset-engine/test/changeset-engine.test.ts --timeout 90000`; `bun run typecheck`.
- [x] **AL6-11 · P1 · `adapters`** — Implement Claude Code adapter behind the port.
  - Evidence: `createClaudeCodeInvestigationRunner` wraps the provider-neutral `InvestigationRunnerPort` with command/args/transport injection, bounded JSON stdin and mutation-disabled capabilities; adapter tests verify the default `claude --print --output-format json` contract.
  - Verification artifact: `docs/verification/architecture-ledger-al6-provider-adapters.md`.
- [x] **AL6-12 · P1 · `adapters`** — Implement Codex adapter behind the same port.
  - Evidence: `createCodexInvestigationRunner` uses the same command transport path and validation pipeline as Claude, with default `codex exec --json`; malformed command output is rejected before report validation.
  - Verification artifact: `docs/verification/architecture-ledger-al6-provider-adapters.md`.
- [x] **AL6-13 · P1 · `agent-orchestrator`** — Record provider, model identifier, prompt-template digest, input digest, output digest, duration and outcome.
  - Evidence: `AgentInvestigationRunMetadata` records runner/provider/model/digest/duration/outcome/attempt fields, `runInvestigationWithRetry` returns metadata with each report, and `jobs.complete` persists metadata under `job.extensions.agentRun`.
  - Verification artifact: `docs/verification/architecture-ledger-al6-provider-adapters.md`.
- [x] **AL6-14 · P1 · `agent-orchestrator`** — Add timeout, bounded retries and deterministic fallback to advisory-only output.
  - Evidence: `runInvestigationWithRetry` bounds attempts and timeout, aborts provider execution, and returns deterministic failed advisory-only fallback reports with digest-only error metadata after final failure.
  - Verification artifact: `docs/verification/architecture-ledger-al6-provider-adapters.md`.
- [x] **AL6-15 · P1 · `cli`** — Add `archctx investigate`, `archctx agents status` and `archctx agents budget`.
  - Evidence: `packages/surfaces/cli/src/main.ts` adds thin CLI read/enqueue surfaces over the runtime daemon; `packages/surfaces/cli/test/cli.test.ts` verifies stable envelopes and flag-to-runtime input mapping.
  - Verification artifact: `docs/verification/architecture-ledger-al6-cli-fixtures.md`.
- [x] **AL6-16 · P1 · `tests`** — Add fake provider fixtures for timeout, malformed output, hallucinated IDs, duplicate results and stale completion.
  - Evidence: timeout fallback remains covered by fake-provider retry tests; malformed fake-provider output and hallucinated target IDs are rejected by `runInvestigationThroughPort`; stale completion is rejected before worker side effects; duplicate terminal completion is rejected at daemon and store boundaries without replacing `outputDigest`.
  - Verification artifact: `docs/verification/architecture-ledger-al6-cli-fixtures.md`.

### Exit gate

- [x] **AL6-EG1** — Low-risk commit path spawns zero agents.
  - Evidence: `agent-orchestrator.test.ts` verifies low-risk automatic eligibility returns `low-risk-automatic-spawn-disabled` and `risk-below-investigation-threshold`.
- [x] **AL6-EG2** — Default p95 agent spawns per task ≤ 1.
  - Evidence: default policy hard-caps `maxRunsPerTask` at 1 and the budget path rejects `taskRuns: 1` before job creation.
- [x] **AL6-EG3** — Agent cannot mutate ledger, YAML or docs directly.
  - Evidence: contracts keep `AgentJob/v1.directMutationAllowed` and `InvestigationReport/v1.directMutationAllowed` as `false`; runner capabilities require `canMutateRepository: false`; tests reject direct-mutation reports; proposal plans forbid ledger/YAML/docs/ChangeSet/tool/command actions, and ChangeSet planning rejects agent/proposal provenance.
- [x] **AL6-EG4** — Stale or malformed outputs are rejected with actionable reason codes.
  - Evidence: stale runtime job completion is rejected with `AC_CONTEXT_STALE`; duplicate terminal completion is rejected with `AC_PRECONDITION_FAILED`; malformed/hallucinated investigation reports are rejected with stable `investigation-report-invalid: <reason-codes>` values including `report-not-object`, `proposed-delta-required`, `evidence-binding-reference-unverifiable`, `proposed-delta-target-unknown`, `proposed-delta-evidence-reference-unverifiable`, `direct-mutation-forbidden`, `raw-report-payload-forbidden` and `tool-escape-forbidden`.
- [x] **AL6-EG5** — Provider adapter can be removed without changing domain behavior.
  - Evidence: orchestration tests use a fake provider through `InvestigationRunnerPort`; spawn eligibility, state transitions and budget decisions do not depend on Claude or Codex adapter code.

### Execution log

- 2026-06-26 — AL6 provider-neutral orchestrator foundation completed:
  - Contracts: added provider-neutral `InvestigationRunnerPort`, bounded `InvestigationContextBundle`, and optional `maxRunsPerDay` on `AgentJob/v1.budget`.
  - Core: added `@archcontext/core/agent-orchestrator` with safe default policy, spawn eligibility, per-task/repository/day budget checks, equivalent-job deduplication, state transitions and port execution guard.
  - Safety: low-risk automatic changes spawn zero agents by default; created jobs and runner reports cannot request direct architecture mutation.
  - Verification artifact: `docs/verification/architecture-ledger-al6-orchestrator-foundation.md`.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts packages/contracts/test/contracts.test.ts --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`.
- 2026-06-26 — AL6 runtime context guards module completed:
  - Queue controls: core now emits a stable runtime queue control plan covering cooldown debounce, coalescing, max queued jobs, priority, one-running-job claim policy and stale HEAD/worktree cancellation metadata.
  - Runtime path: daemon Git hook enqueue now builds jobs through `createInvestigationAgentJob`, attaches the bounded investigation context by digest, skips clean worktrees, and keeps claim concurrency at one running job per repository by default.
  - Context safety: ledger-derived context bundles include bounded refs and IDs, not repository source bodies or diff bodies; raw source, diff, prompt and completion fields are rejected before persistence.
  - Verification artifact: `docs/verification/architecture-ledger-al6-runtime-context-guards.md`.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000`; `bun test --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-26 — AL6 typed output validation module completed:
  - Contracts: `InvestigationReport/v1` now requires typed `proposedDelta` payloads instead of digest-only proposals, while preserving finding, hypothesis, evidence reference, unknown, falsifier and confidence fields.
  - Core: `validateInvestigationReport` checks runner output against the running job and bounded context before `runInvestigationThroughPort` returns it.
  - Rejection: malformed, direct-mutation and hallucinated-reference reports fail with stable reason codes for missing proposed delta, unverifiable evidence binding, unknown proposed-delta target, unverifiable proposed-delta evidence and digest mismatch.
  - Verification artifact: `docs/verification/architecture-ledger-al6-output-validation.md`.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test packages/contracts/test/contracts.test.ts --timeout 90000`; `bun test --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-26 — AL6 security/proposal containment module completed:
  - Security: repository prompt text remains inert input to the bounded context digest; model output carrying raw source/diff/prompt/completion or tool-call/command/write escape fields is rejected before callers receive it.
  - Proposal path: validated reports can only become `InvestigationReportProposalPlan` records with `authority: advisory-only`, `directMutationAllowed: false` and `requiredNextStep: deterministic-validation`.
  - ChangeSet boundary: candidate deltas with agent report/proposal provenance are rejected before `planArchitectureCandidateChangeSet` can create a ChangeSet.
  - Verification artifact: `docs/verification/architecture-ledger-al6-security-proposals.md`.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test packages/core/changeset-engine/test/changeset-engine.test.ts --timeout 90000`; `bun test --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`.
- 2026-06-26 — AL6 provider adapters and run metadata module completed:
  - Adapters: Claude Code and Codex now share a command-transport adapter over `InvestigationRunnerPort`; the transport receives bounded JSON stdin and command output must parse to a typed `InvestigationReport/v1`.
  - Runtime metadata: successful and fallback runs return `AgentInvestigationRunMetadata` with provider, model, prompt/input/output digests, duration, outcome, attempt count and timeout/fallback state; daemon completion persists it under `job.extensions.agentRun`.
  - Failure behavior: timeout and bounded retry failures produce deterministic failed advisory reports without raw source, diff, stdout, stderr or prompt bodies.
  - Verification artifact: `docs/verification/architecture-ledger-al6-provider-adapters.md`.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000`; `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`; `bun test --timeout 90000`; `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al6-provider-adapters-verify-state-XXXXXX) bun run verify`.
- 2026-06-26 — AL6 CLI and fixture closeout module completed:
  - CLI: `archctx investigate` now enqueues bounded runtime agent jobs; `archctx agents status` reads queue status; `archctx agents budget` reports safe default spawn and queue limits.
  - Fixtures: fake-provider tests reject malformed output and hallucinated IDs; runtime daemon and SQLite store tests reject duplicate terminal completion before replacing output; existing timeout and stale completion coverage remains green.
  - Verification artifact: `docs/verification/architecture-ledger-al6-cli-fixtures.md`.
  - Verification: `bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000`; `bun test packages/surfaces/cli/test/cli.test.ts --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000`; `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 90000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`; `bun test --timeout 90000`; `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al6-cli-fixtures-verify-state-XXXXXX) bun run verify`.
- 2026-06-26 — AL6 remote Windows Node 25 daemon readback hardening completed:
  - Readback: PR #61 Windows Node 25 failed only the CLI stale daemon and daemon upgrade tests after exceeding the previous hosted-runner readiness budget.
  - Runtime CLI: Windows `archctx daemon start` readiness budget now has the same safety margin as hosted-runner behavior, while Linux/macOS defaults stay unchanged.
  - Diagnostics: background daemon startup now reports foreground child exit/error state with the log tail instead of returning an empty-tail timeout.
  - Verification: `bun test packages/surfaces/cli/test/cli.test.ts -t "daemon" --timeout 120000`; `bun test packages/surfaces/cli/test/cli.test.ts --timeout 120000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`; `bun test --timeout 90000`; `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-pr61-win25-hardening-verify-state-XXXXXX) bun run verify`.

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

- [x] **AL7-01 · P0 · `architecture-ledger`** — Implement current-state query API for nodes, relations, constraints and migration state.
  - Evidence: `architectureLedgerBookSubjects`, `queryArchitectureLedgerBook` and `showArchitectureLedgerBookSubject` expose current graph subjects with metadata; migration-state remains represented through existing graph metadata/constraint semantics rather than a new current table.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-retrieval.md`.
- [x] **AL7-02 · P0 · `architecture-ledger`** — Implement graph-neighborhood queries using indexed joins or recursive CTEs.
  - Evidence: `readArchitectureLedgerNeighborhood` uses SQLite current graph tables and a recursive CTE; Book neighbors then formats bounded entity/relation/constraint results.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-retrieval.md`.
- [x] **AL7-03 · P0 · `architecture-ledger`** — Implement temporal queries by event, commit, timestamp and snapshot.
  - Evidence: daemon Book refs support `empty`, `current`, event id, `event:<id>`, `commit:<sha>`, `timestamp:<iso>` and `snapshot:<id>`; CLI fixture asserts commit, timestamp and snapshot diff readbacks.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-retrieval.md`.
- [x] **AL7-04 · P0 · `architecture-ledger`** — Implement architecture diff between two refs with reason and evidence links.
  - Evidence: `diffArchitectureLedgerBookStates` returns added/removed/changed subjects with stable reason codes; evidence lookup returns bounded evidence items and bindings by subject/selector/target id.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-retrieval.md`.
- [x] **AL7-05 · P0 · `retrieval`** — Rank results by task relevance, graph distance, recency, declared importance and evidence strength.
  - Evidence: Book query score breakdown now includes task relevance, graph distance from current graph, recency from ledger events, and metadata-derived importance/evidence strength.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-retrieval.md`.
- [x] **AL7-06 · P0 · `retrieval`** — Enforce byte/item budgets and deterministic truncation.
  - Evidence: `applyArchitectureBookBudget` returns max item/byte readback, omitted count, truncation flag and `item-budget-exceeded` / `byte-budget-exceeded` reason codes.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-retrieval.md`.
- [x] **AL7-07 · P0 · `retrieval`** — Return freshness metadata: repository, HEAD SHA, worktree digest, ledger cursor and projection digest.
  - Evidence: daemon Book success envelopes include `archcontext.book-freshness/v1` with repository/worktree/read authority, HEAD SHA, worktree digest, graph digest, projection digest and ledger cursor.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-retrieval.md`.
- [x] **AL7-08 · P0 · `cli`** — Implement the Book commands with stable JSON envelopes and reason codes.
  - Evidence: `archctx book status/query/show/neighbors/timeline/diff/evidence/recommendations/export` delegates to daemon Book RPC; CLI fixture covers stable success envelopes and schema errors stay centralized.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-retrieval.md`.
- [x] **AL7-09 · P0 · `mcp-local`** — Expose architecture state, timeline, diff and recommendations primarily as MCP resources.
  - Evidence: `archcontext://book/status`, `archcontext://book/state`, `archcontext://book/timeline`, `archcontext://book/diff` and `archcontext://book/recommendations` are fixed read-only MCP resources backed by daemon Book RPC.
  - Verification artifact: `docs/verification/architecture-ledger-al7-mcp-resources.md`.
- [x] **AL7-10 · P0 · `mcp-local`** — Keep the existing small tool surface; route mutations through existing plan/apply tools rather than adding one tool per query.
  - Evidence: `LOCAL_MCP_TOOLS` remains the existing six workflow tools; the MCP Book fixture asserts the tool list is unchanged while Book readbacks are served as resources.
  - Verification artifact: `docs/verification/architecture-ledger-al7-mcp-resources.md`.
- [x] **AL7-11 · P0 · `context-compiler`** — Consume ledger queries first, then request only missing code facts from CodeGraph.
  - Evidence: `compileTaskContext` accepts an optional ledger reader port, converts Book subjects into bounded code context first, and calls CodeGraph only for missing symbol slots; daemon context, prepare, checkpoint and complete paths pass the runtime ledger-backed port.
  - Verification artifact: `docs/verification/architecture-ledger-al7-context-compiler.md`.
- [x] **AL7-12 · P1 · `retrieval`** — Add explain mode showing why each entity or recommendation was selected.
  - Evidence: `queryArchitectureLedgerBook` and `queryArchitectureLedgerBookRecommendations` emit optional `archcontext.architecture-book-selection-explanation/v1` readbacks, and `archctx book query|recommendations --explain` passes the opt-in through the daemon.
  - Verification artifact: `docs/verification/architecture-ledger-al7-retrieval-explain-fts.md`.
- [x] **AL7-13 · P1 · `retrieval`** — Add FTS fallback for architecture prose and ADR summaries; do not add a vector database yet.
  - Evidence: local SQLite migration `0009_architecture_ledger_search_fts` adds a metadata-only FTS read model; daemon Book query passes scoped FTS matches into core scoring as fallback signals without changing ledger authority.
  - Verification artifact: `docs/verification/architecture-ledger-al7-retrieval-explain-fts.md`.
- [x] **AL7-14 · P1 · `benchmarks`** — Benchmark cold and warm queries on small, medium and large fixtures.
  - Evidence: `scripts/architecture-ledger-al7-book-readback.ts` records small/medium/large fixture cold query and warm p95 timings; latest readback reports warm p95 0.672 ms, 1.977 ms and 7.08 ms.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-readback.json`, `docs/verification/architecture-ledger-al7-benchmark-privacy.md`.
- [x] **AL7-15 · P1 · `privacy`** — Assert responses contain selectors, summaries and digests but no unintended source body.
  - Evidence: AL7 readback scans core Book outputs and runtime CLI/MCP outputs for raw source sentinels and forbidden raw-body keys, while allowing selector, summary, digest, freshness, provenance and reason-code fields.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-readback.json`, `docs/verification/architecture-ledger-al7-benchmark-privacy.md`.

### Exit gate

- [x] **AL7-EG1** — Warm query p95 ≤ 300 ms in beta benchmark.
  - Evidence: AL7 readback small/medium/large warm p95 values are 0.672 ms, 1.977 ms and 7.08 ms against a 300 ms threshold.
- [x] **AL7-EG2** — Every response carries freshness and provenance.
  - Evidence: daemon Book success envelopes now include `archcontext.book-freshness/v1` and `archcontext.book-provenance/v1`; CLI and MCP tests assert both fields and matching graph/projection cursor data.
- [x] **AL7-EG3** — An LLM can answer “what changed, why, what depends on it and what remains risky?” from Book output alone on acceptance fixtures.
  - Evidence: AL7 readback validates Book diff reason codes, timeline affected subjects, neighbor dependency relations and recommendation risk/uncertainty fields on all benchmark fixtures.
- [x] **AL7-EG4** — MCP and CLI return semantically equivalent results.
  - Evidence: AL7 readback compares stable digests for `book status`, `book export --format json`, `book timeline --max-items 100`, `book diff --from empty --to current --max-items 100` and `book recommendations --max-items 100` against the corresponding `archcontext://book/*` MCP resources.
- [x] **AL7-EG5** — Context budget overflow is deterministic and explicit.
  - Evidence: Book query, neighbors, timeline, diff, evidence and recommendations return deterministic item/byte budget readback plus truncation reason codes; focused tests cover item-budget truncation.

### AL7 execution log

- 2026-06-26: Completed AL7 Book CLI retrieval slice on branch `codex/architecture-ledger-al7-book-retrieval`.
  - Query/read model: current-state Book subjects, graph-neighborhood CTE reads, temporal refs, diff, evidence and recommendations are exposed through the daemon without changing ledger mutation authority.
  - CLI: `archctx book status/query/show/neighbors/timeline/diff/evidence/recommendations/export` returns stable JSON envelopes with freshness on successful reads.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-retrieval.md`.
  - Focused verification: `bun run typecheck`; `bun test packages/core/architecture-ledger/test/architecture-ledger.test.ts --timeout 90000`; `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 90000`; `bun test packages/surfaces/cli/test/cli.test.ts -t "Book" --timeout 120000`.
- 2026-06-26: Completed AL7 MCP Book resources slice on branch `codex/architecture-ledger-al7-mcp-resources`.
  - MCP resources: `archcontext://book/status`, `state`, `timeline`, `diff` and `recommendations` expose daemon Book readbacks without adding query tools.
  - Tool posture: `LOCAL_MCP_TOOLS` remains the six existing workflow tools, preserving plan/apply as the mutation path.
  - Remote readback hardening: Windows Node 25 daemon readiness and transient file-lock cleanup are widened after PR CI readback exposed hosted-runner-only failures outside the MCP resource path.
  - Verification artifact: `docs/verification/architecture-ledger-al7-mcp-resources.md`.
  - Verification: `bun test packages/surfaces/mcp-local/test/mcp-local.test.ts --timeout 120000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000`; `bun test packages/surfaces/cli/test/cli.test.ts --timeout 240000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`; `bun test --timeout 90000`; `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al7-mcp-resources-verify-state-XXXXXX) bun run verify`.
- 2026-06-26: Completed AL7 context compiler ledger-first slice on branch `codex/architecture-ledger-al7-context-compiler`.
  - Context compiler: Book query results become the first `NormalizedCodeContext` input; CodeGraph is only requested for missing symbol slots.
  - Runtime integration: daemon `context`, `prepare`, `checkpoint` and `completeTask` pass a ledger-backed reader into the compiler while preserving non-daemon fallback behavior.
  - Remote readback hardening: Windows Node 24 runner timeout budget is widened for daemon restart session persistence after PR CI showed the assertions completing just beyond Bun's default 5s test budget.
  - Verification artifact: `docs/verification/architecture-ledger-al7-context-compiler.md`.
  - Verification: `bun test packages/core/context-compiler/test/context-compiler.test.ts --timeout 90000`; `bun test packages/core/application/test/control-loop.test.ts --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger-authoritative runtime read surfaces" --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "checkpoint coalesces|runtime jobs enqueue|ledger-authoritative runtime read surfaces" --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "daemon restart restores persisted repository sessions" --timeout 90000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000`; `bun test packages/surfaces/mcp-local/test/mcp-local.test.ts --timeout 120000`; `bun test packages/surfaces/cli/test/cli.test.ts -t "CLI delegates init and context" --timeout 90000`; `bun test packages/surfaces/cli/test/cli.test.ts --timeout 240000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; `git diff --check`; `bun test --timeout 90000`; `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al7-context-verify-state-XXXXXX) bun run verify`.
- 2026-06-26: Completed AL7 retrieval explain and FTS fallback slice on branch `codex/architecture-ledger-al7-retrieval-explain-fts`.
  - Explain mode: Book query and recommendations can include per-result selection explanations under explicit `--explain` opt-in.
  - FTS fallback: SQLite metadata-only `architecture_ledger_search_fts` indexes Book prose, evidence/ADR summaries and recommendation explanations, then maps matches back to current Book subjects.
  - Verification artifact: `docs/verification/architecture-ledger-al7-retrieval-explain-fts.md`.
  - Verification: `bun test packages/core/architecture-ledger/test/architecture-ledger.test.ts --timeout 90000`; `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts -t "architecture ledger appends" --timeout 120000`; `bun test packages/surfaces/cli/test/cli.test.ts -t "CLI Book commands" --timeout 120000`; `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts -t "ledger-authoritative runtime read surfaces|init, validate, sync, context, and status share|daemon restart restores persisted repository sessions" --timeout 90000`; `bun test packages/surfaces/mcp-local/test/mcp-local.test.ts -t "Book readbacks" --timeout 120000`; `bun test packages/core/architecture-ledger/test/architecture-ledger.test.ts packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 120000`; `bun run typecheck`.
- 2026-06-26: Completed AL7 benchmark/privacy/readback slice on branch `codex/architecture-ledger-al7-benchmark-privacy`.
  - Book provenance: daemon Book success envelopes now carry `archcontext.book-provenance/v1` beside freshness.
  - Benchmark/privacy: `scripts/architecture-ledger-al7-book-readback.ts` records small/medium/large cold/warm query timings, Book-output answerability, CLI/MCP semantic equivalence and raw-body DLP assertions.
  - Verification artifact: `docs/verification/architecture-ledger-al7-book-readback.json`, `docs/verification/architecture-ledger-al7-benchmark-privacy.md`.
  - Verification: `bun run record:al7:book`; `bun run readback:al7:book`; `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al7-benchmark-privacy-verify-state-XXXXXX) bun run verify`.

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

- [x] **AL8-01 · P0 · `recommendation-engine`** — Store every run with input cursor, engine version, catalog digest and output digest.
  - Evidence: `planRecommendationRun` emits `RecommendationRun/v1` records with input cursor, engine/catalog/input/output digests; SQLite readback persists three run records.
  - Verification artifact: `docs/verification/architecture-ledger-al8-scheduler-readback.json`, `docs/verification/architecture-ledger-al8-scheduler-core.md`.
- [x] **AL8-02 · P0 · `recommendation-engine`** — Generate stable recommendation fingerprints from practice, subject, evidence and baseline.
  - Evidence: `recommendationFingerprint` hashes practice, subject, sorted evidence bindings and baseline digest; focused tests assert stable fingerprints.
  - Verification artifact: `docs/verification/architecture-ledger-al8-scheduler-readback.json`, `docs/verification/architecture-ledger-al8-scheduler-core.md`.
- [x] **AL8-03 · P0 · `recommendation-engine`** — Deduplicate unchanged recommendations across commits.
  - Evidence: scheduler readback re-runs the same candidates with active previous fingerprints and suppresses all unchanged recommendations as `duplicate-active-fingerprint`.
  - Verification artifact: `docs/verification/architecture-ledger-al8-scheduler-readback.json`, `docs/verification/architecture-ledger-al8-scheduler-core.md`.
- [x] **AL8-04 · P0 · `recommendation-engine`** — Model lifecycle: open, acknowledged, accepted, rejected, deferred, waived, resolved, superseded and expired.
  - Evidence: `transitionRecommendationLifecycle` covers the lifecycle statuses and rejects terminal-status transitions; readback records an open-to-accepted transition with audit metadata.
  - Verification artifact: `docs/verification/architecture-ledger-al8-scheduler-readback.json`, `docs/verification/architecture-ledger-al8-scheduler-core.md`.
- [x] **AL8-05 · P0 · `policy-engine`** — Implement scheduling levels L0–L4 and explicit trigger matrix.
  - Evidence: scheduler core maps source, risk, uncertainty and policy mode into L0-L4; readback verifies L3 for high-risk/high-uncertainty and L1 for checkpoint/cooldown-only deterministic output.
  - Verification artifact: `docs/verification/architecture-ledger-al8-scheduler-readback.json`, `docs/verification/architecture-ledger-al8-scheduler-core.md`.
- [x] **AL8-06 · P0 · `policy-engine`** — Compute architecture risk from boundary changes, ownership changes, persistence, external contracts, security/payment domains, cycles, migration state and hotspot growth.
  - Evidence: `computeRecommendationRisk` classifies risk from the AL8 signal set; readback covers high payment/persistence risk and medium boundary-change risk.
  - Verification artifact: `docs/verification/architecture-ledger-al8-scheduler-readback.json`, `docs/verification/architecture-ledger-al8-scheduler-core.md`.
- [x] **AL8-07 · P0 · `policy-engine`** — Separate risk from uncertainty; only high-value uncertainty is eligible for L3 investigation.
  - Evidence: scheduler core computes risk and uncertainty independently; tests assert high risk with low uncertainty stays L2, while high risk plus high uncertainty is L3-eligible.
  - Verification artifact: `docs/verification/architecture-ledger-al8-scheduler-readback.json`, `docs/verification/architecture-ledger-al8-scheduler-core.md`.
- [x] **AL8-08 · P0 · `policy-engine`** — Add per-practice and per-subject cooldowns.
  - Evidence: scheduler readback suppresses a matching practice/subject recommendation until the configured cooldown expiry.
  - Verification artifact: `docs/verification/architecture-ledger-al8-scheduler-readback.json`, `docs/verification/architecture-ledger-al8-scheduler-core.md`.
- [x] **AL8-09 · P0 · `waivers`** — Add scoped waiver with owner, reason, expiry, evidence and review date.
  - Evidence: `PracticeWaiverV1`, `schemas/repo/practices/practice-waiver.schema.json`, runtime `planPracticeWaiver`, and CLI `practices waive` now require `reviewAt`; `validatePracticeWaiver` rejects invalid review windows and the readback verifies exact-scope waiver application plus expired/tampered/overscoped rejection.
  - Verification artifact: `docs/verification/architecture-ledger-al8-waiver-review-readback.json`, `docs/verification/architecture-ledger-al8-waiver-review.md`.
- [x] **AL8-10 · P0 · `review-engine`** — Prevent advisory recommendations from becoming complete-stage gates without explicit policy eligibility.
  - Evidence: `completeTaskGate` accepts recommendation context, rejects advisory recommendations carrying complete-stage gate claims, rejects complete-stage recommendations missing explicit `completeStageEligibility.policyDigest`, and passes eligible complete recommendations.
  - Verification artifact: `docs/verification/architecture-ledger-al8-waiver-review-readback.json`, `docs/verification/architecture-ledger-al8-waiver-review.md`.
- [x] **AL8-11 · P1 · `cli`** — Add acknowledge, accept, reject, defer, waive and resolve commands.
  - Evidence: `archctx recommendations acknowledge|accept|reject|defer|waive|resolve` routes through the runtime daemon and appends `architecture.recommendation.lifecycle` events; duplicate no-op transitions are rejected before append.
  - Verification artifact: `docs/verification/architecture-ledger-al8-lifecycle-feedback-readback.json`, `docs/verification/architecture-ledger-al8-lifecycle-feedback.md`.
- [x] **AL8-12 · P1 · `feedback`** — Capture user outcome and reason without using implicit acceptance as truth.
  - Evidence: `RecommendationFeedback/v1` requires `explicit: true` and `implicitAcceptance: false`; feedback is appended by the daemon with recommendation lifecycle events and persisted through the SQLite feedback projection.
  - Verification artifact: `docs/verification/architecture-ledger-al8-lifecycle-feedback-readback.json`, `docs/verification/architecture-ledger-al8-lifecycle-feedback.md`.
- [x] **AL8-13 · P1 · `evals`** — Measure repeated-noise rate, time-to-resolution, accepted recommendation rate and agent-assisted resolution rate.
  - Evidence: `aggregateRecommendationLifecycleMetrics` computes local ledger replay metrics, and `archctx recommendations metrics` returns repeated-noise rate, time-to-resolution, accepted recommendation rate and agent-assisted resolution rate without raw source/diff bodies.
  - Verification artifact: `docs/verification/architecture-ledger-al8-lifecycle-feedback-readback.json`, `docs/verification/architecture-ledger-al8-lifecycle-feedback.md`.
- [x] **AL8-14 · P1 · `recommendation-engine`** — Add explanation tree: trigger → subject → evidence → baseline → score → policy outcome.
  - Evidence: each emitted recommendation carries `archcontext.recommendation-explanation-tree/v1` under extensions with trigger, subject, evidence bindings, baseline, score, risk, uncertainty and policy outcome.
  - Verification artifact: `docs/verification/architecture-ledger-al8-scheduler-readback.json`, `docs/verification/architecture-ledger-al8-scheduler-core.md`.
- [x] **AL8-15 · P1 · `practice-catalog`** — Require positive, near-negative, mixed-change and baseline fixtures before a practice can be enforcement-eligible.
  - Evidence: `PracticeAssetV1.enforcement.fixtureGate` is required by catalog validation for `promotableTo: complete`; the eight complete-eligible built-in practices declare positive, near-negative, mixed-change and baseline fixture refs; enforcement returns `fixture-gate-missing` before a missing-gate practice can hard-gate complete.
  - Verification artifact: `docs/verification/architecture-ledger-al8-fixture-budgets-readback.json`, `docs/verification/architecture-ledger-al8-fixture-budgets.md`.
- [x] **AL8-16 · P1 · `policy-engine`** — Add repository-local configuration for frequency and budgets with safe defaults.
  - Evidence: `PracticeEnforcementPolicyV1.recommendations` config is loaded from `.archcontext/policies/practices.yaml`; `normalizeRecommendationSchedulerPolicy` defaults to advisory, seven-day cooldown, 25 recommendations per run and one L3 investigation per run; repo-local readback caps three candidates to two recommendations and one L3-eligible investigation.
  - Verification artifact: `docs/verification/architecture-ledger-al8-fixture-budgets-readback.json`, `docs/verification/architecture-ledger-al8-fixture-budgets.md`.

### Exit gate

- [x] **AL8-EG1** — Re-running on unchanged architecture creates no new recommendation noise.
  - Evidence: AL8 scheduler readback replays unchanged active fingerprints and emits zero new recommendations.
- [x] **AL8-EG2** — L3 agent investigation occurs only when risk and uncertainty thresholds both qualify.
  - Evidence: scheduler-core eligibility remains verified by `docs/verification/architecture-ledger-al8-scheduler-readback.json`; actual agent dispatch now uses default high/high thresholds in `evaluateInvestigationSpawn`, runtime enqueue passes risk/uncertainty through to the job gate, and AL8 waiver-review readback proves medium-risk and medium-uncertainty dispatch are denied while high/high and explicit policy-requested investigation pass.
- [x] **AL8-EG3** — Waiver scope and expiry are enforced.
  - Evidence: `validatePracticeWaiver` enforces owner, durable reason, review window, evidence digest and non-empty scope; `waiverMatchesResult` requires exact practice/check/evidence/scope match and unexpired waiver; AL8 waiver-review readback proves expired, tampered and overscoped waivers each leave one violation.
- [x] **AL8-EG4** — Hard gates remain zero false-positive on the release suite.
  - Evidence: AL8 waiver-review readback proves plain advisory recommendations pass without hard-gating, advisory complete-stage gate claims fail, complete-stage recommendations require explicit policy eligibility, and eligible complete recommendations pass. Full release-suite verification recorded in the AL8 execution log for this slice.
- [x] **AL8-EG5** — Explanation tree reproduces the engine decision from persisted inputs.
  - Evidence: AL8 readback appends scheduler events through `SqliteLocalStore`, replays persisted events, and reads Book recommendations with the persisted explanation tree intact.

### AL8 execution log

- 2026-06-26: Completed AL8 scheduler core/readback slice on branch `codex/architecture-ledger-al8-scheduler-core`.
  - Core: added `@archcontext/core/recommendation-engine` with deterministic run planning, stable fingerprints, unchanged-fingerprint suppression, lifecycle transitions, scheduling levels, risk/uncertainty separation, cooldowns and explanation trees.
  - Persistence/readback: `scripts/architecture-ledger-al8-scheduler-readback.ts` writes three scheduler run events through `SqliteLocalStore.appendArchitectureEvents`, verifies SQLite `recommendation_runs` / `recommendations`, and reads the resulting Book recommendations from replayed ledger events.
  - Explicitly still out of scope: waiver scope/expiry enforcement, review-engine hard-gate eligibility, CLI lifecycle commands, feedback metrics, practice enforcement fixture gates and repository-local scheduler configuration.
  - Verification artifact: `docs/verification/architecture-ledger-al8-scheduler-readback.json`, `docs/verification/architecture-ledger-al8-scheduler-core.md`.
  - Verification: `bun run record:al8:scheduler`; `bun run readback:al8:scheduler`; `bun test packages/core/recommendation-engine/test/recommendation-engine.test.ts scripts/architecture-ledger-al8-scheduler-readback.test.ts`; `bun run typecheck`.
- 2026-06-26: Completed AL8 waiver/review gate integration slice on branch `codex/architecture-ledger-al8-waiver-review`.
  - Waivers: `PracticeWaiverV1`, JSON schema, runtime daemon, CLI and eval fixtures now require `reviewAt`; invalid review windows are rejected before a waiver can suppress enforcement.
  - Review gate: `completeTaskGate` treats recommendations as context and rejects advisory hard-gate claims or complete-stage recommendations without explicit policy eligibility.
  - Agent threshold: automatic investigation defaults to high risk plus high uncertainty; runtime enqueue and CLI now pass risk/uncertainty into the same agent eligibility gate, while explicit `archctx investigate` sets `policyRequestedInvestigation` instead of weakening automatic defaults.
  - Explicitly still out of scope: AL8-11 lifecycle commands, AL8-12 feedback capture, AL8-13 metrics, AL8-15 practice catalog enforcement fixture gates and AL8-16 repository-local scheduler configuration.
  - Verification artifact: `docs/verification/architecture-ledger-al8-waiver-review-readback.json`, `docs/verification/architecture-ledger-al8-waiver-review.md`.
  - Verification: `bun run record:al8:waiver-review`; `bun run readback:al8:waiver-review`; `bun test scripts/architecture-ledger-al8-waiver-review-readback.test.ts packages/core/review-engine/test/review-engine.test.ts packages/core/agent-orchestrator/test/agent-orchestrator.test.ts`; `bun test packages/core/practice-engine/test/practice-engine.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/cli.test.ts packages/contracts/test/contracts.test.ts`; `bun run typecheck`; `git diff --check`; `bun run verify`.
  - Remote readback: PR #68 Windows Node 24 completed the full test suite but timed out in `scripts/packaged-cli-smoke.mjs` while waiting for background `archctx daemon start`; the smoke harness now uses the same hosted-runner-scale child-process budget already used by CLI daemon tests, without changing runtime behavior.
- 2026-06-26: Completed AL8 lifecycle/feedback/metrics slice on branch `codex/architecture-ledger-al8-lifecycle-feedback`.
  - CLI/runtime: added `archctx recommendations acknowledge|accept|reject|defer|waive|resolve|metrics`; lifecycle writes replay the latest recommendation from the ledger and append daemon-owned `architecture.recommendation.lifecycle` events.
  - Feedback: added `RecommendationFeedback/v1` contract/schema/fixtures and explicit feedback capture with `implicitAcceptance: false`; no raw source, raw diff, prompt or completion body is persisted.
  - Metrics/readback: Book recommendations now dedupe by latest recommendation state and hide accepted/rejected/waived/resolved outcomes from `--open`; local metrics cover repeated-noise rate, time-to-resolution, accepted recommendation rate and agent-assisted resolution rate.
  - Explicitly still out of scope: AL8-15 practice catalog enforcement fixture gates and AL8-16 repository-local scheduler configuration.
  - Verification artifact: `docs/verification/architecture-ledger-al8-lifecycle-feedback-readback.json`, `docs/verification/architecture-ledger-al8-lifecycle-feedback.md`.
  - Verification: `bun test scripts/architecture-ledger-al8-lifecycle-feedback-readback.test.ts packages/core/recommendation-engine/test/recommendation-engine.test.ts packages/core/architecture-ledger/test/architecture-ledger.test.ts packages/contracts/test/contracts.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/cli.test.ts`; `bun run typecheck`; `bun run record:al8:lifecycle-feedback`; `bun run readback:al8:lifecycle-feedback`; `bun run verify`.
- 2026-06-26: Completed AL8 fixture-gates/repo-local budgets slice on branch `codex/architecture-ledger-al8-fixture-budgets`.
  - Fixture gates: complete-promotable practice assets now declare `enforcement.fixtureGate` with positive, near-negative, mixed-change and baseline fixtures; catalog validation rejects complete-promotable practices without the gate.
  - Enforcement: `evaluatePracticeEnforcement` returns `fixture-gate-missing` before an ungated practice can hard-gate complete, while gated built-ins still run deterministic checks.
  - Repository-local scheduler policy: `.archcontext/policies/practices.yaml` can declare recommendation `frequency` and `budgets`; safe defaults keep advisory mode, seven-day cooldown, 25 recommendations per run and one L3 investigation per run.
  - Verification artifact: `docs/verification/architecture-ledger-al8-fixture-budgets-readback.json`, `docs/verification/architecture-ledger-al8-fixture-budgets.md`.
  - Verification: `bun run record:al8:fixture-budgets`; `bun run readback:al8:fixture-budgets`; `bun test scripts/architecture-ledger-al8-fixture-budgets-readback.test.ts packages/core/practice-catalog/test/practice-catalog.test.ts packages/core/practice-engine/test/practice-engine.test.ts packages/core/recommendation-engine/test/recommendation-engine.test.ts packages/contracts/test/contracts.test.ts`; `bun run typecheck`; `git diff --check`; `node scripts/package-boundary-audit.mjs`; `node scripts/sprint-status-check.mjs`; isolated `ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al8-fixture-budgets-verify-state-XXXXXX) bun run verify`.

---

# AL9 · Documentation placement and deterministic projections

**Goal:** keep architecture documentation current in appropriate repository locations without letting agents overwrite human-owned prose.

### Tasks

- [x] **AL9-01 · P0 · `contracts`** — Define `ProjectionTarget/v1`: type, entity scope, path, ownership, generated region and renderer version.
  - Evidence: `schemas/runtime/projection-target.schema.json`, `packages/contracts/src/ledger.ts`, `packages/contracts/fixtures/valid/projection-target.json`.
- [x] **AL9-02 · P0 · `model-store-yaml`** — Add manifest mapping from architecture entity kinds/scopes to target paths.
  - Evidence: `.archcontext/projections/targets.json` and `createDefaultProjectionTargetManifest()` declare repository, entity, relation, decision, changelog and diagram placement rules.
- [x] **AL9-03 · P0 · `renderer`** — Generate architecture index, entity summaries, relation summaries, decision index and architecture changelog.
  - Evidence: `docs/architecture/index.md`, `docs/architecture/modules/capability-architecture-context.md`, `docs/architecture/decisions/index.md`, `docs/architecture/changelog.md`.
- [x] **AL9-04 · P0 · `renderer`** — Generate Mermaid/Structurizr/LikeC4 projections from the same ledger snapshot.
  - Evidence: `docs/architecture/diagrams/architecture.mmd`, `docs/architecture/diagrams/architecture.structurizr.json`, `docs/architecture/diagrams/architecture.likec4`.
- [x] **AL9-05 · P0 · `renderer`** — Preserve human-authored regions and reject ambiguous file ownership.
  - Evidence: existing human prose in `docs/architecture/index.md` is preserved outside `ARCHCONTEXT:generated`; readback verifies generated-only diagram paths without markers are rejected as ambiguous ownership.
- [x] **AL9-06 · P0 · `reconcile-engine`** — Track projection source digest, renderer version and output digest.
  - Evidence: `docs/architecture/.projection-manifest.json` and every generated region marker carry `sourceDigest`, `rendererVersion` and `outputDigest`.
- [x] **AL9-07 · P0 · `reconcile-engine`** — Detect stale, missing, manually edited and orphaned projections.
  - Evidence: `docs drift` readback detects missing files before apply, manual generated-region edits and orphaned generated projection files.
- [x] **AL9-08 · P0 · `changeset-engine`** — Apply projection updates through previewable ChangeSets.
  - Evidence: `render_projection` operations can carry bounded projection files; readback applies docs through ChangeSet preview/apply with drift clean after apply.
- [x] **AL9-09 · P0 · `agent-orchestrator`** — Let a subagent draft rationale or ADR prose only after deterministic delta selection.
  - Evidence: `planInvestigationReportProposal` creates `AgentDocumentationDraftV1` only from a valid investigation report and requires every documentation draft to reference selected deterministic delta digests; invalid unselected delta drafts are rejected by AL9 complete-task provenance readback.
- [x] **AL9-10 · P0 · `agent-orchestrator`** — Store agent draft separately from accepted projection until validation/approval.
  - Evidence: agent documentation drafts are `authority: advisory-only`, `acceptedProjection: false`, traceable to job/input/output/prompt digests, and runtime `jobs.complete` stores proposal plans only in agent run metadata without writing docs.
- [x] **AL9-11 · P1 · `renderer`** — Add placement rules for monorepo package docs, service docs and repository-level architecture docs.
  - Evidence: projection target manifest includes repository, entity-kind and relation scopes with stable path templates.
- [x] **AL9-12 · P1 · `renderer`** — Add obsolete-projection cleanup with tombstone/redirect behavior where links may exist.
  - Evidence: `archctx docs clean` reports orphaned generated projections and returns manual tombstone review action instead of deleting human-visible links silently.
- [x] **AL9-13 · P1 · `cli`** — Add `archctx docs plan`, `preview`, `apply`, `drift` and `clean`.
  - Evidence: readback executes all five CLI commands successfully against a temporary Git repository.
- [x] **AL9-14 · P1 · `complete_task`** — Reconcile accepted architecture changes and validate projections before completion.
  - Evidence: runtime `completeTask` consumes active documentation projection drift summaries and returns `projection-drift` errors until projections are reconciled; readback proves completion passes after deterministic projection apply.
- [x] **AL9-15 · P1 · `tests`** — Add mixed human/generated documents, rename, move, deletion and renderer-upgrade fixtures.
  - Evidence: renderer and readback tests cover mixed human/generated documents, deterministic re-rendering, missing, stale, manual-edit and orphaned generated projections.
- [x] **AL9-16 · P1 · `docs/runbooks`** — Document review ownership and how to recover from a bad projection.
  - Evidence: `docs/runbooks/architecture-documentation-projections.md`.

### Exit gate

- [x] **AL9-EG1** — Accepted architecture change appears in all configured projections before successful completion.
- [x] **AL9-EG2** — Human-authored text is never overwritten in the fixture suite.
- [x] **AL9-EG3** — Same snapshot and renderer version produce byte-identical outputs.
- [x] **AL9-EG4** — Projection drift after successful `complete_task` = 0.
- [x] **AL9-EG5** — Agent-written prose remains traceable to its job and input digest.

### AL9 execution log

- 2026-06-26: Completed AL9 deterministic documentation projection core on branch `codex/architecture-ledger-al9-doc-projections`.
  - Scope: closes AL9-01 through AL9-08 plus AL9-11, AL9-12, AL9-13 and AL9-15; AL9-09, AL9-10, AL9-14 and AL9-16 remain explicitly out of scope for this slice.
  - Projection contract: `ProjectionTarget/v1` records target type, scope, path, ownership, generated region, renderer version, source digest and output digest.
  - Placement/renderer: `.archcontext/projections/targets.json` maps repository/entity/relation/decision/changelog/diagram scopes to stable docs paths; renderer produces architecture index, entity summaries, decision index, changelog and Mermaid/Structurizr/LikeC4 projections from the same source digest.
  - Reconcile/ownership: generated regions preserve surrounding human prose, reject ambiguous generated-only ownership, and classify missing, stale, manually edited and orphaned projections.
  - ChangeSet/CLI: `render_projection` can carry bounded projection files through preview/apply/rollback; `archctx docs plan|preview|apply|drift|clean` exercises the path.
  - Verification artifact: `docs/verification/architecture-ledger-al9-doc-projections-readback.json`, `docs/verification/architecture-ledger-al9-doc-projections.md`.
  - Verification: `bun run record:al9:docs-projections`; `bun run readback:al9:docs-projections`; `bun test scripts/architecture-ledger-al9-doc-projections-readback.test.ts packages/surfaces/renderer/test/renderer.test.ts packages/core/changeset-engine/test/changeset-engine.test.ts packages/core/policy-engine/test/policy-engine.test.ts packages/surfaces/cli/test/cli.test.ts packages/contracts/test/contracts.test.ts --timeout 120000`; `bun run typecheck`; isolated `ARCHCONTEXT_STATE_DIR=$(mktemp -d ...) bun run verify`.
- 2026-06-26: Completed AL9 complete-task projection gate and agent draft provenance closeout on branch `codex/architecture-ledger-al9-complete-task-provenance`.
  - Scope: closes AL9-09, AL9-10, AL9-14, AL9-16, AL9-EG1, AL9-EG4 and AL9-EG5.
  - Projection gate: active documentation projections are validated inside runtime `completeTask`; stale/missing projection output produces a `projection-drift` complete-stage finding, while clean projections record projection source and output digests in the review snapshot.
  - Agent draft provenance: agent-authored rationale/ADR prose is normalized as `AgentDocumentationDraftV1`, remains `advisory-only` and `acceptedProjection: false`, and is stored in agent run proposal metadata instead of docs projection files.
  - Boundary refactor: deterministic docs projection logic now lives in `@archcontext/core/projection-engine`; `@archcontext/surfaces/renderer` remains a thin surface wrapper so local runtime does not import surfaces.
  - Runbook: `docs/runbooks/architecture-documentation-projections.md` documents ownership, recovery, drift handling and agent draft acceptance.
  - Verification artifact: `docs/verification/architecture-ledger-al9-complete-task-provenance-readback.json`, `docs/verification/architecture-ledger-al9-complete-task-provenance.md`.
  - Verification: `bun run record:al9:complete-task-provenance`; `bun run readback:al9:complete-task-provenance`; `bun test packages/core/review-engine/test/review-engine.test.ts packages/core/agent-orchestrator/test/agent-orchestrator.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/renderer/test/renderer.test.ts --timeout 120000`; `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `git diff --check`; isolated `ARCHCONTEXT_STATE_DIR=$(mktemp -d ...) bun run verify`.

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

- [x] **AL10-01 · P0 · `feature-flags`** — Implement explicit phase flags and safe downgrade path.
  - Evidence: runtime `architectureLedger.phaseFlags` reports active phase, supported phases, environment flags, promotion/downgrade paths, and the canonical safe downgrade command; `docs/runbooks/architecture-ledger-rollout.md`; `docs/verification/architecture-ledger-al10-rollout-workflow-readback.json`.
- [x] **AL10-02 · P0 · `migration`** — Create one-command backup, migrate, verify and rollback workflow.
  - Evidence: `archctx ledger migrate --from-yaml --write --expected-worktree-digest <current>` runs through the daemon, creates a runtime-state SQLite backup, appends `architecture.yaml.import`, rebuilds replay state, checks integrity, verifies drift, returns `ARCHCONTEXT_LEDGER_MODE=dual`, and surfaces the YAML rollback command; `docs/verification/architecture-ledger-al10-rollout-workflow.md`.
- [x] **AL10-03 · P0 · `fixtures`** — Run full loop on at least three representative repositories: small app, medium monorepo and architecture-heavy service project.
  - Evidence: `docs/verification/architecture-ledger-al10-representative-benchmark.md` records verified full-loop replay on three temporary Git fixture repositories: small app, medium monorepo and architecture-heavy service.
- [x] **AL10-04 · P0 · `benchmarks`** — Measure hook, sync, query, checkpoint, complete, projection and replay performance.
  - Evidence: `docs/verification/architecture-ledger-al10-representative-benchmark-readback.json` records hook enqueue, sync, warm Book query, checkpoint, complete, documentation projection, replay and rollback timings across all three representative fixtures.
- [x] **AL10-05 · P0 · `chaos`** — Inject daemon crash, DB lock, disk-full, corrupt row, interrupted rebase and provider timeout.
  - Evidence: `docs/verification/architecture-ledger-al10-chaos-security-readback.json` records verified probes for stale daemon control recovery, SQLite busy lock rejection, filesystem write-failure proxy for disk-full, corrupt materialized row integrity failure, interrupted rebase projection rejection without ledger mutation, and provider timeout fallback.
- [x] **AL10-06 · P0 · `security`** — Run prompt injection, path traversal, symlink escape, forged evidence, event tamper and stale replay tests.
  - Evidence: `docs/verification/architecture-ledger-al10-chaos-security-readback.json` records verified prompt/tool-escape rejection, repo-relative path traversal rejection, legacy SQLite symlink escape rejection, CLI forged evidence rejection, event tamper replay/materialized mismatch detection, and stale replay rejection with `AC_CONTEXT_STALE`.
- [x] **AL10-07 · P0 · `privacy`** — Audit SQLite, logs, CLI output, MCP output and agent job payloads for source/diff leakage.
  - Evidence: `docs/verification/architecture-ledger-al10-hardening-readback.json` scans SQLite schema/event/operation text, raw CLI outputs, MCP prepare/checkpoint/complete outputs, hook logs and raw agent job payloads for forbidden source/diff keys and sentinel leakage; all five privacy surfaces report `clean: true`.
- [x] **AL10-08 · P0 · `evals`** — Freeze a blind, no-label recommendation set and publish per-practice support.
  - Evidence: `docs/verification/architecture-ledger-al10-recommendation-quality-readback.json` freezes seven representative practice JSONL datasets by SHA-256, verifies the 30-case blind no-label set has empty evidence arrays, no practice bindings and zero task label hits, and publishes 26 per-practice support rows with 90/90 expected matches.
- [x] **AL10-09 · P0 · `evals`** — Compare deterministic-only versus deterministic-plus-agent outcomes and cost.
  - Evidence: `docs/verification/architecture-ledger-al10-agent-comparison-readback.json` compares deterministic-only eval output against a deterministic-plus-agent advisory path over four fake-provider investigation runs; deterministic metrics and quality violation counts have zero delta while plus-agent records 4 runs, 4 attempts, 4,769 estimated tokens, 90 ms duration and $0 external provider cost.
- [ ] **AL10-10 · P0 · `release`** — Add migration compatibility matrix across supported versions.
- [ ] **AL10-11 · P0 · `release`** — Verify packaged CLI includes migrations, hooks, renderers and agent adapter contracts.
- [ ] **AL10-12 · P1 · `runbooks`** — Write incident, corruption recovery, drift recovery, provider disable and full rollback runbooks.
- [ ] **AL10-13 · P1 · `telemetry`** — Produce local opt-in beta report: runs, drift, recommendations, agent spawn frequency, resolution and failures.
- [ ] **AL10-14 · P1 · `product`** — Interview beta users about whether Book answers replace manual filesystem browsing.
- [ ] **AL10-15 · P1 · `governance`** — Require an independent reviewer for authority promotion and enforcement enablement.
- [ ] **AL10-16 · P1 · `release`** — Record final Go/No-Go decision and unresolved risks.

### Beta exit gate

- [x] **AL10-BETA-1** — Dual-mode drift = 0 across representative replay runs.
  - Evidence: `docs/verification/architecture-ledger-al10-representative-benchmark.md` reports dual-mode drift count 0 across the small app, medium monorepo and architecture-heavy service replay runs.
- [x] **AL10-BETA-2** — No event loss/duplication in 1,000-event stress suite.
  - Evidence: `docs/verification/architecture-ledger-al10-hardening-readback.json` records 1,000 appended events, 1,000 replayed events, 1,000 unique event IDs, one duplicate retry counted as duplicate, integrity OK and fault-injected rollback leaving zero partial materialization.
- [x] **AL10-BETA-3** — No source/diff leakage in privacy audit.
  - Evidence: `docs/verification/architecture-ledger-al10-hardening-readback.json` records `overallClean: true`, zero forbidden key hits and zero forbidden token hits across SQLite, CLI, MCP, logs and agent job payloads.
- [x] **AL10-BETA-4** — Recommendation quality meets AL1 targets.
  - Evidence: `docs/verification/architecture-ledger-al10-recommendation-quality.md` records Practice Top-3 recall 100.0%, recommendation precision@3 100.0%, no-keyword structural recall 100.0%, direct-reference recall 100.0%, evidence-shuffle contamination 0.0%, and hard-gate false-positive rates 0.0%.
- [x] **AL10-BETA-5** — Default task path has median zero subagent spawns.
  - Evidence: `docs/verification/architecture-ledger-al10-hardening-readback.json` samples 9 default hook enqueue paths with median spawned jobs 0, total spawned jobs 0 and all default samples remaining fail-open/no-enqueue below the investigation threshold; one explicit high-risk enqueue is retained only to audit job payload privacy.
- [x] **AL10-BETA-6** — Full rollback to YAML authority is demonstrated.
  - Evidence: `docs/verification/architecture-ledger-al10-hardening-readback.json` runs write migration and rollback through the daemon, verifies target authority `yaml`, backup manifest creation and canonical rollback command availability.

### GA exit gate

- [ ] **AL10-GA-1** — No event loss/duplication in 10,000-event stress suite.
- [ ] **AL10-GA-2** — Warm query p95 ≤ 200 ms on representative repositories.
- [ ] **AL10-GA-3** — Incremental deterministic analysis p95 ≤ 2 s for ≤200 changed files.
- [ ] **AL10-GA-4** — Stale writes, path escapes and forged evidence blocked 100%.
- [ ] **AL10-GA-5** — Hard-gate false positives = 0.
- [ ] **AL10-GA-6** — External/independent architecture and security review accepted.
- [ ] **AL10-GA-7** — Production rollback drill completed.

### AL10 execution log

- 2026-06-26: Completed AL10 rollout workflow foundation on branch `codex/architecture-ledger-al10-rollout-workflow`.
  - Scope: closes AL10-01 and AL10-02 only; representative replay, benchmark, chaos, security, privacy, eval, release packaging, telemetry, beta, and GA gates remain open.
  - Feature flags: runtime status and ledger readbacks expose `architectureLedger.phaseFlags` with active phase, supported phases, environment flags, promotion path, downgrade path, and canonical YAML safe downgrade command.
  - Migration workflow: `archctx ledger migrate --from-yaml --write --expected-worktree-digest <current>` is daemon-owned and performs backup, append, replay rebuild, integrity verification, drift reconciliation, and rollback-command readback.
  - Rollback surface: verified migration output recommends `ARCHCONTEXT_LEDGER_MODE=dual` and exposes `archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>` plus YAML downgrade env.
  - Verification artifact: `docs/verification/architecture-ledger-al10-rollout-workflow-readback.json`, `docs/verification/architecture-ledger-al10-rollout-workflow.md`.
  - Verification: `bun run record:al10:rollout-workflow`; `bun run readback:al10:rollout-workflow`; `bun test scripts/architecture-ledger-al10-rollout-workflow-readback.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/cli.test.ts --timeout 120000`; `bun run typecheck`.
- 2026-06-26: Completed AL10 representative replay and benchmark module on branch `codex/architecture-ledger-al10-representative-benchmarks`.
  - Scope: closes AL10-03, AL10-04 and AL10-BETA-1 only; chaos, security, privacy, blind eval, deterministic-plus-agent comparison, release packaging, telemetry, remaining beta gates and GA gates remain open.
  - Representative replay: small app, medium monorepo and architecture-heavy service temporary Git fixtures all run init, YAML-to-ledger migration, prepare/query, hook enqueue, sync, checkpoint, docs projection apply, complete, ledger rebuild and YAML rollback.
  - Drift: dual-mode drift count is 0 across all three representative replay runs.
  - Benchmark: warm Book query p95 is 96.8 ms, checkpoint p95 is 136.244 ms, projection p95 is 169.13 ms, replay p95 is 138.902 ms, rollback p95 is 153.249 ms; hook enqueue p95 is 154.458 ms, slightly above the 150 ms beta target and kept as a follow-up bottleneck.
  - Verification artifact: `docs/verification/architecture-ledger-al10-representative-benchmark-readback.json`, `docs/verification/architecture-ledger-al10-representative-benchmark.md`.
  - Verification: `bun run record:al10:representative-benchmark`; `bun run readback:al10:representative-benchmark`; `bun test scripts/architecture-ledger-al10-representative-benchmark-readback.test.ts --timeout 120000`.
- 2026-06-26: Completed AL10 hardening readback module on branch `codex/architecture-ledger-al10-hardening-readback`.
  - Scope: closes AL10-07, AL10-BETA-2, AL10-BETA-3, AL10-BETA-5 and AL10-BETA-6 only; AL10-05 chaos, AL10-06 security, BETA-4 recommendation quality, release packaging, runbooks, telemetry, governance, Go/No-Go and all GA gates remain open.
  - Stress: SQLite architecture ledger appends 1,000 events, replays 1,000 events, reports 1,000 unique event IDs, treats duplicate retry as duplicate, verifies integrity and proves fault-injected partial append rollback leaves no materialized state.
  - Privacy: raw CLI outputs, MCP prepare/checkpoint/complete output, hook logs and raw agent job payloads are scanned for forbidden source/diff/prompt/completion keys and sentinel leakage; persisted evidence stores digests and redacted summaries rather than raw source, raw diffs, full CodeGraph output or local absolute paths.
  - Default spawn policy: 9 default hook enqueue samples produce median 0 spawned jobs and total 0 spawned jobs; one explicit high-risk enqueue proves the audited job-payload surface exists without changing default behavior.
  - Rollback: write migration and full rollback to YAML authority are exercised through the daemon with backup and rollback-command readback.
  - Verification artifact: `docs/verification/architecture-ledger-al10-hardening-readback.json`, `docs/verification/architecture-ledger-al10-hardening.md`.
  - Verification: `bun run record:al10:hardening`; `bun run readback:al10:hardening`; `bun test scripts/architecture-ledger-al10-hardening-readback.test.ts --timeout 120000`.
- 2026-06-26: Completed AL10 chaos and security negative matrix on branch `codex/architecture-ledger-al10-chaos-security`.
  - Scope: closes AL10-05 and AL10-06 only; BETA-4 recommendation quality, release packaging, runbooks, telemetry, governance, Go/No-Go and all GA gates remain open.
  - Chaos: the readback injects daemon crash recovery via dead connection PID plus stale lock cleanup, SQLite DB lock rejection, disk-full-class filesystem write failure with integrity preservation, corrupt materialized row detection, interrupted rebase YAML rejection without ledger digest mutation, and provider timeout deterministic fallback.
  - Security: the readback verifies prompt injection remains inert, tool-escape report output is rejected, path traversal is blocked by repo-relative path validation, symlink escape is blocked during legacy SQLite migration, forged CLI evidence fields are rejected with `AC_SCHEMA_INVALID`, event tampering is caught by replay/materialized digest comparison, and stale worker completion is rejected with `AC_CONTEXT_STALE`.
  - Evidence privacy: the packet scans the chaos/security evidence for raw source/diff/completion keys and secret-like tokens; the generated evidence records digests, reason codes and redacted paths only.
  - Verification artifact: `docs/verification/architecture-ledger-al10-chaos-security-readback.json`, `docs/verification/architecture-ledger-al10-chaos-security.md`.
  - Verification: `bun run record:al10:chaos-security`; `bun run readback:al10:chaos-security`; `bun test scripts/architecture-ledger-al10-chaos-security-readback.test.ts`.
- 2026-06-26: Completed AL10 recommendation quality freeze/readback on branch `codex/architecture-ledger-al10-recommendation-quality`.
  - Scope: closes AL10-08 and AL10-BETA-4 only; AL10-09 deterministic-plus-agent comparison, release packaging, runbooks, telemetry, governance, Go/No-Go and all GA gates remain open.
  - Frozen eval set: seven representative practice JSONL files are captured with SHA-256 digests and case counts, including the 30-case blind no-label structural-positive set.
  - No-label guard: the blind set keeps `practice-no-label-*` IDs, `no-keyword-structural-positive` scenario type, empty evidence arrays, no `practiceBindings`, zero task label hits and zero dataset metadata violations.
  - Recommendation quality: `bun evals/run.ts --check` reports Practice Top-3 recall 100.0%, recommendation precision@3 100.0%, no-keyword structural recall 100.0%, direct-reference recall 100.0%, evidence-shuffle contamination 0.0%, heuristic-only hard-gate rate 0.0%, and dynamic-doc hard-gate rate 0.0%.
  - Per-practice support: 26 practice rows publish 90 expected recommendations, 90 matched recommendations, min recall 100.0% and zero incomplete practice IDs.
  - Verification artifact: `docs/verification/architecture-ledger-al10-recommendation-quality-readback.json`, `docs/verification/architecture-ledger-al10-recommendation-quality.md`.
  - Verification: `bun run record:al10:recommendation-quality`; `bun run readback:al10:recommendation-quality`; `bun test scripts/architecture-ledger-al10-recommendation-quality-readback.test.ts`; `bun evals/run.ts --check`; `bun run typecheck`.
- 2026-06-26: Completed AL10 deterministic-only versus deterministic-plus-agent comparison on branch `codex/architecture-ledger-al10-agent-comparison`.
  - Scope: closes AL10-09 only; release packaging, runbooks, telemetry, governance, Go/No-Go and all GA gates remain open.
  - Outcome comparison: deterministic-only remains the authority; deterministic-plus-agent reuses the same representative eval metrics and records zero metric deltas, zero quality violation deltas and three advisory findings.
  - Agent path: four fake-provider investigation runs cover blind no-label positive, direct-reference positive, benign negative and waiver-adversarial cases; all run through the real agent port/retry/validation path, remain `advisory-only`, require deterministic validation and make zero direct mutation attempts.
  - Cost comparison: deterministic-only records zero agent runs/tokens; deterministic-plus-agent records 4 runs, 4 attempts, 4,769 estimated tokens, 90 ms duration, 13,420 input bytes, 5,640 output bytes and $0 external provider cost.
  - Verification artifact: `docs/verification/architecture-ledger-al10-agent-comparison-readback.json`, `docs/verification/architecture-ledger-al10-agent-comparison.md`.
  - Verification: `bun run record:al10:agent-comparison`; `bun run readback:al10:agent-comparison`; `bun test scripts/architecture-ledger-al10-agent-comparison-readback.test.ts`; `bun evals/run.ts --check`; `bun run typecheck`.

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

1. [x] AL0 authority and schemas.
2. [x] AL1 evidence correctness before further enforcement work.
3. [x] AL2 event, snapshot, current graph and evidence-binding tables.
4. [x] AL3 YAML import/export and dual-compare mode.
5. [x] AL4 thin post-commit queue plus stale-job cancellation.
   - Queue foundation, stale-job cancellation, queue-first hook wrapper, recursion guard and jobs CLI are complete; remaining AL4 work is stress/backpressure/observability/chaining hardening.
6. [x] AL5 deterministic architecture delta for imports, ownership and persistence boundaries.
7. [x] AL7 `book status/query/diff` CLI.
8. [x] AL9 deterministic architecture changelog projection.
9. [x] AL6 provider-neutral subagent orchestration is complete; automatic investigation scheduling remains AL8 policy-gated.

This sequence delivers a useful SQL-backed Book and passive documentation loop before taking on provider orchestration complexity.
