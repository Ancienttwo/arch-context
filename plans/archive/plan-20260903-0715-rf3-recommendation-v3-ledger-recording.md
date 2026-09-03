# Plan: Sprint task: rf3-recommendation-v3-ledger-recording

> **Status**: Archived
> **Created**: 20260903-0715
> **Slug**: rf3-recommendation-v3-ledger-recording
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf3-recommendation-v3-ledger-recording
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md`; after execution revert branch `codex/rf3-recommendation-v3-ledger-recording` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md`
> **Task Review**: `tasks/reviews/20260903-0715-rf3-recommendation-v3-ledger-recording.review.md`
> **Implementation Notes**: `tasks/notes/20260903-0715-rf3-recommendation-v3-ledger-recording.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf3-recommendation-v3-ledger-recording
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md`
- Sprint contract: `tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md`
- Sprint review: `tasks/reviews/20260903-0715-rf3-recommendation-v3-ledger-recording.review.md`
- Implementation notes: `tasks/notes/20260903-0715-rf3-recommendation-v3-ledger-recording.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md`.

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
- Contract file: `tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md`
- Review file: `tasks/reviews/20260903-0715-rf3-recommendation-v3-ledger-recording.review.md`
- Implementation notes file: `tasks/notes/20260903-0715-rf3-recommendation-v3-ledger-recording.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md`; after execution revert branch `codex/rf3-recommendation-v3-ledger-recording` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260903-0715-rf3-recommendation-v3-ledger-recording.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: engine + daemon + store + CLI changes with a ledger migration and docs re-projection; one mergeable unit with a replay-parity verification boundary.

## Evidence Contract

- **State/progress path**: `plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md`, `tasks/reviews/20260903-0715-rf3-recommendation-v3-ledger-recording.review.md`, and `tasks/notes/20260903-0715-rf3-recommendation-v3-ledger-recording.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260903-0715-rf3-recommendation-v3-ledger-recording.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md`; after execution revert branch `codex/rf3-recommendation-v3-ledger-recording` or the explicitly reviewed diff.

## Captured Planning Output

## Goal

Materialize RF2's `{assessment, proposal, snapshot}` as `RecommendationV3` records in the ledger through a daemon-owned `refactorRecord` transaction; add fingerprint generalization, `regressesFrom`, the one-shot v2→v3 migration, and the `resolve --evidence-digest` gate.

## Why

Contracts are frozen (RF1a) but no consumer writes v3. Without RF3 the ledger cannot hold observations or agent proposals, `refactor_scan` is an unused enum arm, and RF4/RF5a have no record to verify or expose. The migration is the sole reason `0.5.0` is a minor bump (PRD §0.3 item 14), so its replay parity is the release gate.

## Scope

**In** — `recommendation-engine`: `planRefactorRecommendationRun`, `recommendationV3Fingerprint`, `relations`, `RecommendationStatus` clash. `architecture-delta`: export selector-id derivation. `architecture-ledger`: widen event-payload recommendation type. `runtime-daemon`: `registerRefactorAssessment` + `refactorRecord` RPC, `ledgerMigrate --recommendation-v3`, resolve gate. `cli`: `--evidence-digest`, `--recommendation-v3` flag parsing. Docs re-projection.

**Out** — `packages/contracts/**` (frozen); `refactor scan` RPC, `refactor` verb, `ARCHCTX_FEATURES`, version bump, `packaged-cli-smoke` (all RF5a); `refactorVerify` / real evidence lookup (RF4); `supersedes`; any schema/column change to `recommendations`; `.archcontext/**`; RF0 fixtures.

## Allowed Paths

```yaml
allowed_paths:
  - packages/core/recommendation-engine/src/index.ts
  - packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts
  - packages/core/architecture-delta/src/index.ts
  - packages/core/architecture-ledger/src/index.ts
  - packages/local-runtime/local-store-sqlite/src/index.ts
  - packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/src/refactor-recording.ts
  - packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - docs/architecture/**   # regeneration only, via `docs apply --approved`
```
Deny: `packages/contracts/**`, `packages/core/*/test/fixtures/refactor-baseline/**`, `packages/core/projection-engine/**`, `packages/cloud/**`, `schemas/**`, `.archcontext/**`.

## File Changes

| File | Change |
|---|---|
| `recommendation-engine/src/index.ts:22` | Replace `type RecommendationStatus = RecommendationV2["status"]` with re-export from contracts. Add `REFACTOR_ACTIVE_RECOMMENDATION_STATUSES = {open, acknowledged, accepted, deferred}` (do **not** touch `ACTIVE_RECOMMENDATION_STATUSES`; RF0-frozen). |
| `recommendation-engine/src/index.ts` (new) | `recommendationV3Fingerprint`, `planRefactorRecommendationRun`, `refactorRecommendationRunLedgerPayload`, `PreviousRecommendationV3`. Imports contracts + `@archcontext/core/architecture-delta` only. |
| `architecture-delta/src/index.ts:1203` | Extract private `selectorIdFor` → `export function architectureSubjectSelectorId(kind, repositoryId, stableKey)`; `addSelector` calls it. Single selector-identity authority. |
| `architecture-ledger/src/index.ts:97` | `recommendations?: RecommendationLedgerRecordV1[]` where `= RecommendationV2 \| RecommendationV3`. Bounded: v2 arm removed at `0.6.0`. |
| `local-store-sqlite/src/index.ts` | Expected **no source change** (`persistRecommendation` reads only shared fields). Keep in scope in case typecheck disagrees. No new migration; `LOCAL_SQLITE_MIGRATIONS` stays at 20. |
| `runtime-daemon/src/refactor-recording.ts` (new, only new file) | Bounded-LRU assessment registry, `refactorRecord` body, `upgradeRecommendationsToV3`. |
| `runtime-daemon/src/index.ts` | `registerRefactorAssessment` (in-process, **not** dispatched), `refactorRecord` on daemon + `RuntimeDaemonClient` + `RuntimeRpcClient` + `dispatch` (`:5700-5749`); `RuntimeLedgerMigrateInput.recommendationV3?`; `RuntimeRecommendationInput.evidenceDigest?`; resolve gate in `recommendations()` (`:3050`). |
| `cli/src/main.ts:880-910, 682-700` | `--evidence-digest` → `evidenceDigest`; `ledger migrate` accepts exactly one of `--from-yaml` / `--recommendation-v3`. |

## Design Decisions

**(a) Materialization lives in `recommendation-engine`, additive.** `planRecommendationRun` stays byte-frozen: `test/fixtures/refactor-baseline/plan-recommendation-run.json` pins its output and it has no production caller, so it cannot leak v2 into a real ledger. New `planRefactorRecommendationRun({repository, worktree, snapshot, assessment, proposal?, previousRecommendations?, cooldowns?, catalogDigest, now, policy})` depends **only on `@archcontext/contracts` types** — not on `@archcontext/core/refactor-assessment` — so RF3 builds and tests against hand-written `RefactorAssessmentV1` fixtures without waiting for RF2. It reuses `previousActiveByFingerprint`/`duplicate-active-fingerprint`/`findActiveCooldown` verbatim and asserts `recommendationV3InvariantIssues(record) === []` on every record, throwing otherwise (fail-closed).

`recommendationV3Fingerprint(rec)`: for `category === "practice"` it **delegates to the frozen `recommendationFingerprint`** — mandatory, because `recommendationId` is derived from `fingerprint` and migrated records must keep their identity; for refactor categories it hashes `{schemaVersion: "archcontext.recommendation-fingerprint/v2", ...recommendationV3FingerprintInput(rec)}`.

Field rules: `subject = subjectSelectorId`; observation `subjectSelectorId = observation.subjectSelectorId` (RF2-produced) and `authoredBy = {kind:"daemon", id:"archctxd", source:"daemon"}`, `enforcement: advisory`; proposal `authoredBy = proposal.authoredBy` verbatim, `enforcement = scale === "architecture" ? "complete" : "checkpoint"`, `subjectSelectorId = architectureSubjectSelectorId("node", repositoryId, "nodes:" + [...affectedNodeIds].sort().join("|"))`, or `("repository", repositoryId, "repository")` when empty. `scale === "model_adoption_required"` ⇒ no `refactor_proposal` record, one `EvidenceItemV2` instead (PRD RF3 Recommended Defaults); `insufficient_evidence` **does** record a proposal — the scale value is the fail-closed signal and RF4 refuses to resolve it.

**(b) Storage: no schema change; migration appends, never rewrites.** The authoritative reader is the event stream, and `persistArchitectureLedgerArtifacts` runs only at append time — so an in-place `UPDATE` of `recommendations` would leave the event log (the real authority) at v2. `ledger migrate --recommendation-v3` therefore: replays `mode:"genesis"`, takes `latestRecommendationById` per id, filters `schemaVersion === recommendation/v2`, upcasts, and appends **one** event (`source:"migration"`, `eventType:"architecture.recommendation.v3-migration"`, **`operations: []`**). `INSERT OR REPLACE` refreshes the table row for free; `graphDigest` is untouched by construction, which is exactly why rebuild parity holds.

Upcast: `category:"practice"`; `practiceId` preserved — **missing ⇒ `AC_SCHEMA_INVALID`, never invented**; `subjectSelectorId = architectureSubjectSelectorId("node", repositoryId, \`node:${subject}\`)`; `payload = {practiceId, baselineDigest: extensions.baselineDigest ?? null}` (written by the v2 planner); `authoredBy = {kind:"daemon", id:"archctxd", source:"daemon"}` — v2 carried no author, so a single honest constant beats re-deriving one per event actor; `relations = {}`; `fingerprint`/`recommendationId`/`runId`/`status`/`createdAt` verbatim; `updatedAt = now` with the original preserved under `extensions.recommendationV3Migration`. Idempotency key hashes the upgraded set; a second run reports `upgradedCount: 0` and appends nothing. Reader is v3-only afterwards: the resolve path asserts `schemaVersion === RECOMMENDATION_V3_SCHEMA_VERSION` on the selected record and returns `AC_PRECONDITION_FAILED` naming the migrate command.

**(c) `refactorRecord`.** `registerRefactorAssessment({snapshot, assessment, proposal?, headSha, worktreeDigest})` keeps a bounded LRU (cap 8) keyed by `assessmentDigest`, in-process only — RF5a's `refactorScan` will call it; RF3 tests call it directly on a started daemon. `refactorRecord(root, {assessmentDigest, expectedWorktreeDigest, selection?})` inside `withWriter`: unknown/evicted digest ⇒ `AC_SCHEMA_INVALID`; registered `headSha`/`worktreeDigest` ≠ current scope, or `assertFreshWorktree` throws (caught) ⇒ `AC_REFACTOR_STALE`; bad `proposal.authoredBy` pair ⇒ `AC_REFACTOR_PROPOSAL_UNAUTHORED`; non-empty `refactorScanInvariantIssues` ⇒ `AC_SCHEMA_INVALID`. One `appendArchitectureEvents` call = one SQLite transaction (verified `:3820-3876`) carrying `{recommendationRuns:[run], recommendations, evidenceItems}`, `source:"refactor_scan"`, `actor {kind:"daemon", id:"archctxd"}`, `baseDigest = resultingDigest = replay.graphDigest`, `operations: []` (so the base/resulting-digest conflict checks are skipped by design). `catalogDigest := digestJson({schemaVersion:"archcontext.refactor-classifier-ruleset/v1", engineVersion, REFACTOR_SCALES, REFACTOR_SCALE_REASON_CODES, REFACTOR_OBSERVATION_KINDS, ARCHITECTURE_MAJOR_CHANGE_REASON_CODES})` — the classifier ruleset, giving `RecommendationRunV1.catalogDigest` a definition for non-practice runs. `trigger = {level:"L2", source:"refactor_scan"}`, `policyMode:"advisory"`. Normal RPC timeout (scan/verify take LONG in RF5a/RF5b).

**(d) Resolve gate.** `resolve` on a v3 record with `category !== "practice"` returns `AC_REFACTOR_EVIDENCE_REQUIRED` when `evidenceDigest` is absent, **and also when present** — 0.5.0 ships the gate, not the lookup, because no `RefactorResolutionEvidenceV1` can exist before RF4; a speculative `payload.refactorResolutionEvidence` reader RF3 never writes would be dead compatibility code. Message names `refactor verify` (0.5.1). Two distinct reason codes (`evidence-digest-missing`, `refactor-resolution-evidence-unavailable`). `acknowledge/accept/reject/defer/waive` unchanged for all categories; `practice` fully unchanged.

**(e) `regressesFrom`, and the ID collision it exposes.** Dedup order: `duplicate-active-fingerprint` against `{open, acknowledged, accepted, deferred}` (matching `open_recommendations_view`, `local-store-sqlite/src/index.ts:531`; the v2 `ACTIVE_RECOMMENDATION_STATUSES` excludes `accepted`, which would wrongly duplicate an in-flight proposal) → cooldown → emit. If the latest record for that fingerprint is `resolved`, emit a **new** record with `relations.regressesFrom = prior.recommendationId` and never touch the prior. Because `recommendation.<digestSuffix(fingerprint)>` would collide with and `INSERT OR REPLACE` the resolved record, refactor-category IDs are `recommendation.${digestSuffix(digestJson({fingerprint, regressesFrom: relations.regressesFrom ?? null}))}` — deterministic and unique along a regression chain. Practice IDs keep the frozen derivation. Latest status `rejected`/`waived`/`expired`/`superseded` ⇒ new record, `relations: {}`.

**`supersedes` is deferred to RF4.** No deterministic replacement relation exists at record time: for `refactor_proposal` a different `proposalDigest` is a *different* agent proposal, and for `structural_observation` `kind + affectedNodeIds` *is* the fingerprint, so "same subject, different fingerprint" means a different subject. RF4's `disposition ∈ {stale, regressed}` supplies the real trigger. Row 5 does not require it.

**(f) Tests.** Engine (`refactor-recommendation-v3.test.ts`): observation-only (S7 — N observations, zero proposals, all `advisory`, daemon-authored); enforcement mapping across all five scales; `model_adoption_required` ⇒ zero proposal records + one evidence item; dedup with prior `accepted`; `regressesFrom` sets the link **and** a different `recommendationId`; daemon-sourced proposal author rejected; every record `recommendationV3InvariantIssues() === []`; same input twice ⇒ identical `outputDigest`. SQLite (`recommendation-v3-migration.test.ts`): v2 event → migration event → row JSON is v3 with `recommendation_id`/`fingerprint`/`run_id`/`created_at` unchanged; `PRAGMA foreign_key_check` empty; `LOCAL_SQLITE_MIGRATIONS.length === 20`; v3 round-trip through `stableJson`. Daemon (`refactor-recording.test.ts`, reusing `createStartedDaemon`/`TestLocalStore`/`MockCodeGraphProvider` from `local-runtime.test.ts:1-60`): happy path; second record ⇒ `duplicate-active-fingerprint` with unchanged count; commit-then-record ⇒ `AC_REFACTOR_STALE`; unknown digest ⇒ `AC_SCHEMA_INVALID`; resolve gate (missing and bogus digest) vs. `accept` succeeding vs. practice resolve succeeding; test-appended `resolved` lifecycle event then re-record ⇒ `regressesFrom`; `ledgerRebuild` → `ledgerMigrate --recommendation-v3` → `ledgerRebuild` graphDigest parity.

**(g) Budgets.** `packages/local-runtime/**/src/**` is **19,927** lines today against a `10k–20k` bucket — RF3 crosses it, so `docs/architecture/modules/module-architecture-context-local-runtime.md:25` **will** change to `20k–50k`; that is the expected owned-region drift, not a failure. File bucket is `10–20` at **12** files, so add at most 7 new local-runtime src files — plan adds exactly one. `privacy-route-audit` scans none of the touched trees (verified `scripts/privacy-route-audit.mjs:6-18`), so no fragment-splicing needed in fixtures. `ARCHCTX_FEATURES` untouched.

## Steps

1. Engine: `RecommendationStatus` re-export; add `REFACTOR_ACTIVE_RECOMMENDATION_STATUSES`.
2. `architecture-delta`: extract and export `architectureSubjectSelectorId`.
3. Engine: `recommendationV3Fingerprint` (practice delegates to the frozen hasher).
4. Engine: `planRefactorRecommendationRun` + `refactorRecommendationRunLedgerPayload` + invariant gate.
5. Write engine test; run it **and** `refactor-baseline.test.ts` (must stay green).
6. `architecture-ledger`: widen the payload recommendation type.
7. Daemon: `upgradeRecommendationsToV3` + `ledgerMigrate` `--recommendation-v3` mode.
8. Daemon: `registerRefactorAssessment` + `refactorRecord` in `refactor-recording.ts`; wire client/interface/dispatch.
9. Daemon: resolve gate, `evidenceDigest`, v2-record fail-closed assertion.
10. CLI: `--evidence-digest`; `ledger migrate` mode selector (exactly one of two flags).
11. SQLite migration/round-trip test; fix `local-runtime.test.ts:6876` fixture only if the type widening forces it.
12. Daemon test file (record / stale / unknown / gate / rebuild parity).
13. `bun run typecheck` and `node scripts/package-boundary-audit.mjs`.
14. `docs plan --json` → `docs apply --approved` to fixed point → `docs drift --json` → `bun run verify`.

## Exit Criteria

- `bun run typecheck` → exit 0.
- `node scripts/package-boundary-audit.mjs` → "Package boundary audit passed".
- `bun test packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts` → 0 fail.
- `bun test packages/core/recommendation-engine/test/recommendation-engine.test.ts` → 0 fail.
- `bun test packages/core/recommendation-engine/test/refactor-baseline.test.ts` → 0 fail (RF0 v2 freeze intact).
- `bun test packages/core/refactor-decision/test/refactor-baseline.test.ts`, `packages/core/pressure-engine/test/refactor-baseline.test.ts`, `packages/core/projection-engine/test/refactor-baseline.test.ts`, `packages/core/application/test/refactor-baseline.test.ts`, `packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts` → each 0 fail.
- `bun test packages/contracts/test/refactor-contracts.test.ts` and `packages/contracts/test/contracts.test.ts` → 0 fail (RF1a).
- RF1b/RF2 when merged: `bun test packages/core/module-statistics/test/snapshot.test.ts` and `packages/core/refactor-assessment/test/scale.test.ts` → 0 fail; if the package is absent at execution time, record "not yet merged" rather than skipping silently.
- `bun test packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts` → 0 fail, including `LOCAL_SQLITE_MIGRATIONS.length === 20` and empty `PRAGMA foreign_key_check`.
- `bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts` → 0 fail.
- `bun test packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts` → 0 fail; asserts `refactor_scan` event source persisted, `refactorRecord` reachable through `RuntimeRpcClient` dispatch, second record ⇒ `duplicate-active-fingerprint`, `regressesFrom` link, `AC_REFACTOR_STALE`, `AC_SCHEMA_INVALID`, `AC_REFACTOR_EVIDENCE_REQUIRED`, and pre/post-migration `graphDigest` equality.
- `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts` → 0 fail.
- `bun test packages/surfaces/cli/test/cli.test.ts` → 0 fail (`--evidence-digest` reaches `RuntimeRecommendationInput`; `ledger migrate` rejects both/neither mode flag).
- `bun packages/surfaces/cli/src/main.ts docs plan --json` → `mode ≠ human-action-required`, `rejected: []`, and the only owned diffs are `docs/architecture/modules/module-architecture-context-local-runtime.md` (+ `index.md` if the renderer touches it).
- After `docs apply --approved` to a fixed point: `bun packages/surfaces/cli/src/main.ts docs drift --json` → `"ok": true`, and a second `docs plan --json` reports zero owned drift.
- `git status --short -- packages/contracts .archcontext packages/core/recommendation-engine/test/fixtures` → empty.
- `bun run verify` → exit 0.

## Risks & Stop Conditions

- **RF2 shape drift.** If merged `refactor-assessment` emits anything outside frozen `RefactorAssessmentV1`, stop — the contract is the boundary, not RF2's implementation.
- **Migration touches the graph.** If the migration event ever carries `operations`, `baseDigest` validation fires and rebuild parity dies. Assert `operations` absent in the test.
- **`updatedAt = now` shifts lifecycle metrics** (`timeToResolution` uses `updatedAt - createdAt`). Accepted: the migration *is* a record change; original preserved in `extensions`. Stop if a metrics test fails for any other reason.
- **Docs bucket flip is one-directional.** If `docs plan` reports `human-action-required` or drift outside the local-runtime module doc, stop and report rather than force-applying.
- **File-count bucket.** More than 7 new local-runtime src files flips `10–20` → `20–50` and churns the docs again. Plan adds one.
- **Parallel-session race.** `plans/` and `tasks/` are contested (rf1a/rf1b hold leases); `git status` + `git log` before touching workflow files.
- **Two failed fix rounds** on migration replay parity ⇒ hand to an independent Codex pass rather than a third same-viewpoint retry.

- **`trackedFiles` trust binding (carried from RF2 gatekeeper).** `assessRefactor` consumes `trackedFiles` unbound to the snapshot. RF3's `registerRefactorAssessment` receives `{snapshot, assessment, proposal}` already produced by one caller; RF5a's `refactorScan` MUST compute `trackedFiles` once and feed the same array to both `buildModuleStatisticsSnapshot` and `assessRefactor` inside the daemon, so no external caller can supply a divergent list. A contract-level tracked-file digest on the snapshot is a 0.6.0 item.

## Rollback Surface

`git checkout -- packages/core/recommendation-engine/src/index.ts packages/core/architecture-delta/src/index.ts packages/core/architecture-ledger/src/index.ts packages/local-runtime/runtime-daemon/src/index.ts packages/surfaces/cli/src/main.ts docs/architecture && rm -f packages/local-runtime/runtime-daemon/src/refactor-recording.ts packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts`. No SQLite schema migration is added, so no database is left half-migrated; an already-applied `--recommendation-v3` event is append-only and inert (`operations: []`) if the code is reverted — v3 records simply become unreadable by the reverted v2-typed reader, recoverable by re-applying the branch.

---

## Task Breakdown

- [ ] Engine: RecommendationStatus re-export, REFACTOR_ACTIVE statuses, recommendationV3Fingerprint, planRefactorRecommendationRun + ledger payload
- [ ] architecture-delta: export architectureSubjectSelectorId; architecture-ledger: widen payload type
- [ ] Daemon: refactor-recording.ts (registry, refactorRecord, upgradeRecommendationsToV3), dispatch/client wiring, ledgerMigrate --recommendation-v3, resolve gate
- [ ] CLI: --evidence-digest; ledger migrate mode selector
- [ ] Tests: engine, sqlite migration/replay parity, daemon recording/gate; RF0/RF1a/RF1b/RF2 suites green
- [ ] typecheck, boundary audit, docs plan/apply fixed point, docs drift ok, bun run verify
- [ ] `repo-harness run verify-contract --contract tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md --strict`
