# Sprint Checklist: ArchContext Architecture Ledger & Passive Architecture Control Loop

> **Status**: Executing - AL0, AL1, AL2, AL3, AL4, AL5 and AL6 complete; AL7 next
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
2. The impact is medium/high, or the policy explicitly requests investigation.
3. Confidence is below the action threshold, or documentation synthesis is materially useful.
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
  - Evidence: `DEFAULT_AGENT_ORCHESTRATION_POLICY` sets `maxRunsPerTask: 1` and `maxAutomaticRunsForLowRisk: 0`; tests verify low-risk automatic changes are denied and medium-risk defaults remain capped at one task run.
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

1. [x] AL0 authority and schemas.
2. [x] AL1 evidence correctness before further enforcement work.
3. [x] AL2 event, snapshot, current graph and evidence-binding tables.
4. [x] AL3 YAML import/export and dual-compare mode.
5. [x] AL4 thin post-commit queue plus stale-job cancellation.
   - Queue foundation, stale-job cancellation, queue-first hook wrapper, recursion guard and jobs CLI are complete; remaining AL4 work is stress/backpressure/observability/chaining hardening.
6. [ ] AL5 deterministic architecture delta for imports, ownership and persistence boundaries.
7. [ ] AL7 `book status/query/diff` CLI.
8. [ ] AL9 deterministic architecture changelog projection.
9. [x] AL6 provider-neutral subagent orchestration is complete; automatic investigation scheduling remains AL8 policy-gated.

This sequence delivers a useful SQL-backed Book and passive documentation loop before taking on provider orchestration complexity.
