# Plan: Sprint task: rf4-resolution-verification

> **Status**: Executing
> **Created**: 20260903-1330
> **Slug**: rf4-resolution-verification
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf4-resolution-verification
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-1330-rf4-resolution-verification.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260903-1330-rf4-resolution-verification.md`; after execution revert branch `codex/rf4-resolution-verification` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260903-1330-rf4-resolution-verification.contract.md`
> **Task Review**: `tasks/reviews/20260903-1330-rf4-resolution-verification.review.md`
> **Implementation Notes**: `tasks/notes/20260903-1330-rf4-resolution-verification.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf4-resolution-verification
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260903-1330-rf4-resolution-verification.md`
- Sprint contract: `tasks/contracts/20260903-1330-rf4-resolution-verification.contract.md`
- Sprint review: `tasks/reviews/20260903-1330-rf4-resolution-verification.review.md`
- Implementation notes: `tasks/notes/20260903-1330-rf4-resolution-verification.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260903-1330-rf4-resolution-verification.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260903-1330-rf4-resolution-verification.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260903-1330-rf4-resolution-verification.md`.

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
- Contract file: `tasks/contracts/20260903-1330-rf4-resolution-verification.contract.md`
- Review file: `tasks/reviews/20260903-1330-rf4-resolution-verification.review.md`
- Implementation notes file: `tasks/notes/20260903-1330-rf4-resolution-verification.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260903-1330-rf4-resolution-verification.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260903-1330-rf4-resolution-verification.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260903-1330-rf4-resolution-verification.md`; after execution revert branch `codex/rf4-resolution-verification` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-1330-rf4-resolution-verification.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260903-1330-rf4-resolution-verification.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: pure evaluator + closed metric vocabulary in core, a new daemon RPC with a ledger evidence append, and a resolve-gate rewrite across two packages; one mergeable unit whose verification boundary is the daemon and refactor-assessment suites plus bun run verify.

## Evidence Contract

- **State/progress path**: `plans/plan-20260903-1330-rf4-resolution-verification.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260903-1330-rf4-resolution-verification.contract.md`, `tasks/reviews/20260903-1330-rf4-resolution-verification.review.md`, and `tasks/notes/20260903-1330-rf4-resolution-verification.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260903-1330-rf4-resolution-verification.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260903-1330-rf4-resolution-verification.md`; after execution revert branch `codex/rf4-resolution-verification` or the explicitly reviewed diff.

## Captured Planning Output

## Goal

Re-measure a recorded `RecommendationV3` at the current HEAD, emit a `RefactorResolutionEvidenceV1` bound to it via `EvidenceBinding/v1`, and turn RF3's always-reject resolve gate into a real evidence lookup so `recommendations resolve --evidence-digest` can succeed exactly when disposition is `resolved`.

## Why

RF3 records proposals and observations but ships the gate without the lookup, so no non-practice recommendation can ever leave `open/accepted`. `refactor-resolution-evidence/v1` is frozen and unwritten. RF4 is the only slice that closes the measure→record→verify loop; RF5b just exposes it.

## Scope

**In** — pure evaluator + closed metric vocabulary + observation kind→outcome derivation (`packages/core/refactor-assessment`); `refactorVerify` daemon RPC (new `refactor-verify.ts`); resolve evidence lookup replacing RF3's `refactor-resolution-evidence-unavailable` arm; persisting the after snapshot **and** the record-time baseline snapshot as `selector.kind:"snapshot"` evidence items.

**Out** — `packages/contracts/**` (no new type; see (b)); CLI `refactor verify` verb, `--request-json`, `ARCHCTX_FEATURES += refactor-resolution-v1`, `packaged-cli-smoke`, 0.5.1 bump (all row 9); `relations.supersedes` (see (d)); MCP; `.archcontext/**`; RF0 baseline fixtures; snapshot/assessment shape changes.

## Allowed Paths

```yaml
allowed_paths:
  - packages/core/refactor-assessment/src/resolution.ts
  - packages/core/refactor-assessment/src/index.ts
  - packages/core/refactor-assessment/test/resolution.test.ts
  - packages/local-runtime/runtime-daemon/src/refactor-verify.ts
  - packages/local-runtime/runtime-daemon/src/refactor-recording.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts
  - packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts
```
Deny: `packages/contracts/**`, `packages/core/module-statistics/**`, `packages/surfaces/**`, `**/test/fixtures/refactor-baseline/**`, `.archcontext/**`, `docs/architecture/**`.

## File Changes

| File | Change |
|---|---|
| `refactor-assessment/src/resolution.ts` (new) | `REFACTOR_RESOLUTION_METRICS`, `readSnapshotMetric`, `refactorOutcomeVocabularyIssues`, `deriveObservationOutcomes`, `evaluateResolution` (~300 lines). |
| `refactor-assessment/src/index.ts` | Re-export the five symbols above. No behavior change. |
| `runtime-daemon/src/refactor-verify.ts` (new, only new file) | `RuntimeRefactorVerifyInput`, `runRefactorVerify`, `resolutionEvidenceItems(...)`, `findResolutionEvidence(events, digest)`. |
| `runtime-daemon/src/index.ts` | `refactorVerify` on `RuntimeDaemon` + `RuntimeDaemonClient` (`:869`) + `RuntimeRpcClient` (`:5329`) + `dispatch` (`:5727`); add `"refactorVerify"` to `RUNTIME_RPC_LONG_METHODS` (`:5160`); swap the resolve gate's rejection arm for the lookup (`:3097`). |
| `runtime-daemon/src/refactor-recording.ts` | Append one baseline-snapshot evidence item + binding to the `refactorRecord` event (see (a)). |

## Design Decisions

**(a) Pure evaluator; the BEFORE value comes from a persisted snapshot evidence item, else `direction:"unknown"`.**
`evaluateResolution({recommendation, beforeSnapshotDigest, beforeSnapshot?, afterSnapshot, afterModel, afterTrackedFiles, executionEvidenceRefs, verifiedAt})` → `RefactorResolutionEvidenceV1`. `expectedOutcomes` = `payload.derivedOutcomes` (observation) or `payload.targetOutcomes` (proposal), **plus** synthetic kill-list outcomes; both arrays sorted by `outcomeId` (`sortedUniqueIssues` checks order, not just uniqueness — `refactor.ts:874`). `outcomeId = outcome.${digestSuffix(digestJson({metric,subjectSelectorId,nodeId,operator,value,required}))}`.

*Closed metric vocabulary (28 names; `metric` is a pure field path, `nodeId` selects the subject — no `<nodeId>` embedded in the string, so a node rename cannot fork the digest):*
- `repositorySummary.{moduleCount,undeclaredFootprintNodeCount,ownedFileCount,unownedFileCount,multiplyOwnedFileCount,crossModuleEdgeCount,crossModuleCycleCount,stronglyConnectedComponentCount,unresolvedImportCount,dynamicInvocationRiskCount}` — `nodeId` **must** be null.
- `module.footprint.{fileCount,lineCount}`, `module.footprintDeclared` (0/1), `module.dependencyGraph.{internalEdgeCount,inboundModuleEdges,outboundModuleEdges,fanIn,fanOut,cycleCount,instability,directionViolationCount}`, `module.tests.{testFileCount,observedTestEdges,callerCoverage}`, `module.uncertainty.{unresolvedImports,ambiguousOwnership}` (0/1) — `nodeId` **must** be non-null.
- `killList.{path,relation}.present` — ArchContext-synthesized only; `subjectSelectorId` = the kill entry's `selectorId`.

PRD S6's prose `crossModuleCycleCount` maps to `repositorySummary.crossModuleCycleCount`; **no alias table** — one name per metric. A metric outside the vocabulary, or a `nodeId`/scope shape mismatch, is `AC_SCHEMA_INVALID` at ingress with no evidence written (an unknown metric under `absent` would read as *satisfied*, so silently tolerating it manufactures `resolved`). A `nodeId` absent from the after snapshot is **not** an error — the module was dissolved; `observedValue: null` plus residual `outcome-subject-absent` (`warning`).

*Kind→outcome derivation, all `required: true`:* `cycle` → one `module.dependencyGraph.cycleCount absent` per `affectedNodeIds`; `ownership-ambiguous` → `module.uncertainty.ambiguousOwnership absent`; `undeclared-footprint` → `module.footprintDeclared present`; `direction-violation` → `module.dependencyGraph.directionViolationCount absent`; `unowned-paths` → `repositorySummary.unownedFileCount absent`; `evidence-gap` → `repositorySummary.unresolvedImportCount absent`. `absent`, not PRD's `less_than 1`: `less_than` on a `null` observation is *unsatisfied*, so dissolving the subject module would falsely fail.

*Kill list:* `path` evaluated against `afterTrackedFiles`, `relation` against `afterModel` declared relations — both decidable. `symbol` is **not** decidable: `ModuleStatisticsSnapshotV1` carries only `declaredEntrypoints`/`observedEntrypoints`, and absence from entrypoints is not absence from the repo. A `required: true` symbol entry therefore forces `disposition: "stale"` + residual `kill-list-symbol-unverifiable` (`error`); a non-required one becomes a residual only. Kill-list `direction` is always `"unknown"` (a snapshot carries `sourceFilesDigest`, not a file list, so no before-value exists).

*BEFORE value:* RF3 persists no snapshot. RF4 makes `refactorRecord` write the baseline snapshot as one `EvidenceItemV2` (`selector.kind:"snapshot"`, `selector.id: snapshotDigest`, body under `extensions.moduleStatisticsSnapshot`), and `refactorVerify` does the same for the after snapshot (PRD RF4 Recommended Defaults). The evaluator computes `direction` only when `beforeSnapshot.snapshotDigest === beforeSnapshotDigest`; otherwise `"unknown"`. Without the record-side write, `regressed` would be unreachable in production and PRD's "任一反向惡化 → regressed" would ship as dead code — 30 lines in an adjacent, already-merged file buys a real arm.

*Disposition ladder — the frozen validator, not the PRD prose, is authority* (`refactorResolutionEvidenceInvariantIssues`, `refactor.ts:575-634`; it recomputes `satisfied` from `(operator,value,observedValue)` and pins disposition from the required-satisfied count). Order:
1. `beforeSnapshotDigest ≠ payload.baselineSnapshotDigest` → `stale` + residual `baseline-digest-mismatch`.
2. `afterSnapshot.codeFacts.coverage ≠ "complete"`, or `indexedWorktreeDigest ≠ worktree.worktreeDigest` → `stale` + `after-coverage-incomplete` / `after-index-stale`.
3. required symbol kill entry → `stale`.
4. any `direction === "regressed"` → `regressed`.
5. `required.length === 0` → `not_improved` + residual `no-required-outcome`.
6. else all/some/none required satisfied → `resolved` / `partially_resolved` / `not_improved`.

**Deliberate PRD deviation, do not "fix":** RF4 Failure path 2 says incomplete coverage → `partially_resolved`. That is unreachable — with null metrics the ladder forces `resolved` (blocked by `refactorVerifyInvariantIssues`) or `not_improved`. `stale` is the only arm that bypasses the ladder, so it is the single "cannot decide" disposition; the residual carries the reason. Consequence to state in the plan: **verify on a dirty worktree can never return `resolved`.** `evaluateResolution` throws when `refactorVerifyInvariantIssues(afterSnapshot, evidence)` is non-empty (RF3's fail-closed pattern).

**(b) `RefactorVerificationRequestV1` stays out of contracts; RF5b promotes it.** RF4 defines `RuntimeRefactorVerifyInput {recommendationId; expectedHeadSha?; expectedWorktreeDigest?; executionEvidenceRefs?}` in `runtime-daemon`, field-for-field identical to what RF5b will freeze, so promotion is a type-alias swap. Rationale: every peer RPC input (`RuntimeRecommendationInput`, `RuntimeLedgerMigrateInput`) is daemon-local; the external JSON ingress only appears with `--request-json` in row 9, and its schema + fixture belong in the slice that creates it; and keeping `packages/contracts/**` in RF4's deny list gives the gatekeeper a clean frozen-surface check.

*Flow:* `findRepositoryRoot` → `withWriter` → `assertFreshWorktree` if `expectedWorktreeDigest` → `architectureLedgerScope` → genesis replay → `recommendationArtifactsFromEvents` → `latestRecommendationById`. Not found → `AC_SCHEMA_INVALID`; `schemaVersion ≠ recommendation/v3` → `AC_PRECONDITION_FAILED` (RF3's arm); `category === "practice"` → `AC_SCHEMA_INVALID`; `expectedHeadSha` present and ≠ current HEAD → `AC_REFACTOR_STALE`; status `resolved`/`superseded` → return the existing evidence, append nothing. Otherwise reuse RF5a's `runRefactorScan` composition at the current HEAD (identity → `readTrackedSourceFiles` → `readWorkspacePackages` → `repositoryImportPairs` → `buildModuleStatisticsSnapshot` → `assessRefactor`; one `trackedFiles` array feeds snapshot, assessment, and kill-list evaluation), evaluate, then append **one** event.

**Event shape — RF3's plan is wrong here and RF4 must not copy it:** `local-store-sqlite/src/index.ts:3798` `assertNoNewLegacyEvidencePayload` **throws** on `payload.evidenceItems`/`evidenceBindings`. New evidence must use `payload.evidenceOperations: EvidenceLifecycleOperationV1[]` with `payloadVersion: ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION` (`architecture-ledger/src/index.ts:26`). One event, `eventType:"architecture.refactor.resolution"`, `source:"refactor_scan"`, `actor {kind:"daemon", id:"archctxd"}`, `operations: []`, `baseDigest = resultingDigest = replay.graphDigest`, `idempotencyKey: refactor-resolution:${resolutionDigest}` (re-verify at the same HEAD dedups at the event layer). Three create operations: resolution `EvidenceItemV2` (`strength:"verified"`, `origin:"runtime-daemon"`, `supports:["recommendation","complete"]`, `evidenceId: evidence.${digestSuffix(resolutionDigest)}`, body under `extensions.refactorResolution`, `digest` via the `{digest,extensions}`-stripped `digestJson` pattern of `architecture-delta:1226`), the after-snapshot item, and one `EvidenceBindingV1` (`target {kind:"recommendation", id}`, `bindingReason:"deterministic-check"`, `authorityEffect:"complete-eligible"`, `bindingId: binding.${digestSuffix(digestJson({evidenceId, recommendationId}))}`). `book evidence <recommendationId>` then lists it — `queryArchitectureLedgerBookEvidence` matches on `binding.target.id`.

**(c) Resolve lookup.** Non-practice v3 + `--evidence-digest d`: replay evidence state, find the item whose `extensions.refactorResolution.resolutionDigest === d`. Reject with `AC_REFACTOR_EVIDENCE_REQUIRED` and reason `evidence-digest-missing` (absent), `evidence-unknown` (no item, or `recommendationId` mismatch), `evidence-not-resolved` (`disposition ≠ "resolved"`), or `AC_REFACTOR_STALE` reason `evidence-head-drift` (`verifiedHeadSha ≠` current HEAD — demanded by Success Criteria "HEAD 漂移必被拒絕"; the cost is a re-verify after any unrelated commit). RF3's `refactor-resolution-evidence-unavailable` arm is **deleted**, not kept alongside. `partially_resolved`/`not_improved`/`regressed`/`stale` leave status untouched and write no feedback — PRD S6 pins "status 保持 `accepted`", and auto-transitioning would make ArchContext the decider. `acknowledge/accept/reject/defer/waive` and all `practice` behavior unchanged.

**(d) `supersedes` deferred again.** RF3 already emits `regressesFrom` on the newer record; `supersedes` is its redundant inverse. `stale` is not proof of supersession (the baseline can drift for unrelated reasons), and mutating a *second* record inside verify would widen the write set from append-only evidence to a record rewrite. RF4 records `stale` and stops; log the follow-up in `tasks/todos.md`.

**(e) Tests.** `refactor-assessment/test/resolution.test.ts`: S4 resolved; S6 `not_improved` (`repositorySummary.crossModuleCycleCount less_than 1`, after = 1); `partially_resolved`; `regressed` (with `beforeSnapshot` supplied); stale base; incomplete after-coverage → `stale`, never `resolved`; index-not-covering-worktree → `stale`; required kill-list `path` still present → not `resolved`; required `symbol` entry → `stale`; unknown metric → throws; deleted-node subject → `observedValue null` + residual; all six kinds derive expected outcomes; full operator matrix (5 operators × {null, below, equal, above}) round-trips `refactorResolutionEvidenceInvariantIssues() === []`; identical input twice → identical `resolutionDigest`. `runtime-daemon/test/refactor-verify.test.ts` (reusing `createStartedDaemon`/`TestLocalStore`/`MockCodeGraphProvider` from `local-runtime.test.ts:1-60`): happy path S4 then resolve succeeds; HEAD drift → `AC_REFACTOR_STALE`; unknown id → `AC_SCHEMA_INVALID`; practice category → `AC_SCHEMA_INVALID`; already `resolved` → existing evidence, ledger event count unchanged; resolve rejections for all three reasons; `book evidence <recommendationId>` returns the item and the binding; verify twice at the same HEAD → one appended event. `refactor-recording.test.ts` updated for the deleted RF3 arm and the baseline-snapshot evidence item.

**(f) Budgets.** core = 30 files / **18,353** lines (verified) against `20–50` / `10k–20k`; +1 file, +~300 lines. local-runtime = 12 files / **20,073** lines against `10–20` / `20k–50k`; RF3+RF5a+RF4 → 15 files, ~20.8k lines — same buckets, zero docs churn. `privacy-route-audit` scans neither tree (`privacy-route-audit.mjs:6-18`). `refactor-verify.ts` must not reference `MockCodeGraphProvider`/`TestLocalStore` (`package-boundary-audit.mjs checkProductionFallbacks`).

## Steps

1. `resolution.ts`: `REFACTOR_RESOLUTION_METRICS` + `readSnapshotMetric` + `refactorOutcomeVocabularyIssues`.
2. `deriveObservationOutcomes` (six kinds) + kill-list synthesis + deterministic `outcomeId`.
3. `evaluateResolution`: observed values, `direction`, residuals, the six-step ladder, `refactorResolutionEvidenceDigest`, throw on non-empty `refactorVerifyInvariantIssues`.
4. Re-export from `refactor-assessment/src/index.ts`; write `resolution.test.ts`; run it.
5. `refactor-verify.ts`: `RuntimeRefactorVerifyInput`, evidence-item/binding builders, `findResolutionEvidence`.
6. `runRefactorVerify`: load/guard/re-scan/evaluate/append one `evidenceOperations` event.
7. Daemon wiring: interface, class, `dispatch` case, `RuntimeRpcClient`, `RUNTIME_RPC_LONG_METHODS`.
8. `refactor-recording.ts`: baseline-snapshot evidence item + binding on the record event.
9. Replace RF3's resolve rejection arm with the lookup and its four reason codes.
10. Write `refactor-verify.test.ts`; update `refactor-recording.test.ts`.
11. `bun run typecheck`; `node scripts/package-boundary-audit.mjs`; `node scripts/production-mock-reachability-audit.mjs`.
12. Re-run RF0/RF1a/RF1b/RF2/RF3 suites.
13. `docs plan --json` → confirm zero owned drift (expect no `docs apply`).
14. `bun run verify`.

## Exit Criteria

- `bun run typecheck` → exit 0; `node scripts/package-boundary-audit.mjs` → "Package boundary audit passed"; `node scripts/production-mock-reachability-audit.mjs` → exit 0.
- `bun test packages/core/refactor-assessment/test/resolution.test.ts` → 0 fail, covering every fixture in (e).
- `bun test packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts` → 0 fail; asserts `refactorVerify` reachable through `RuntimeRpcClient` dispatch, `AC_REFACTOR_STALE` on HEAD drift, `AC_REFACTOR_EVIDENCE_REQUIRED` with `evidence-not-resolved` for S6, resolve success for S4, and `book evidence <recommendationId>` returning both the item and the `EvidenceBinding/v1`.
- `bun test packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts` → 0 fail (RF3 intact plus the baseline-snapshot item).
- `bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts` → 0 fail.
- `bun test packages/core/refactor-assessment/test/scale.test.ts`, `.../observations.test.ts`, `.../target-delta.test.ts` → each 0 fail (RF2).
- `bun test packages/core/module-statistics/test/snapshot.test.ts`, `.../graph.test.ts`, `.../ownership.test.ts` → each 0 fail (RF1b).
- `bun test packages/contracts/test/refactor-contracts.test.ts` and `packages/contracts/test/contracts.test.ts` → each 0 fail (RF1a).
- `bun test packages/core/refactor-decision/test/refactor-baseline.test.ts`, `packages/core/pressure-engine/test/refactor-baseline.test.ts`, `packages/core/recommendation-engine/test/refactor-baseline.test.ts`, `packages/core/projection-engine/test/refactor-baseline.test.ts`, `packages/core/application/test/refactor-baseline.test.ts`, `packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts` → each 0 fail (RF0).
- `bun test packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts` and `packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts` → each 0 fail (RF3).
- `git ls-files packages/core | grep '/src/' | grep -v '/test/' | wc -l` → ≤ 50, and `cat $(…) | wc -l` → **< 20000** (bucket guard).
- `bun packages/surfaces/cli/src/main.ts docs plan --json` → `rejected: []` and **zero owned drift with no `docs apply` run**.
- `git status --short -- packages/contracts .archcontext docs/architecture packages/surfaces` → empty.
- `bun run verify` → exit 0.

## Risks & Stop Conditions

- **RF3 landed shape.** If merged `refactor-recording.ts` writes `payload.evidenceItems` it will throw at append; fix it to `evidenceOperations` inside RF4 rather than working around it. If `derivedOutcomes` is written as `[]`, add the `deriveObservationOutcomes` call at the record site — bounded to that one field. If either requires more than that, stop and report.
- **Core line bucket.** 1,647 lines of headroom on main *before* RF3's core delta. If step 11's count crosses 20,000, stop — do not force a `docs/architecture` regeneration inside RF4; report and let the orchestrator decide the slice.
- **`stale` overload.** If review rejects `stale` as the "cannot decide" arm, the alternative requires a contract change (a sixth disposition or an `undecidable` flag) and belongs in RF5b, not here. Do not synthesize an `observedValue` to steer the ladder.
- **Symbol kill list.** The strictest call in this plan. If an early consumer needs required symbol entries, the fix is a symbol inventory on the snapshot (0.6.0), not a heuristic entrypoint match.
- **Two failed rounds** on evidence-event append or replay parity ⇒ hand to an independent Codex pass.
- **Parallel-session race.** `plans/`, `tasks/`, `docs/architecture/index.md` are contested (index.md already dirty on main); `git status` + `git log` before touching workflow files.

## Rollback Surface

`git checkout -- packages/core/refactor-assessment/src/index.ts packages/local-runtime/runtime-daemon/src/index.ts packages/local-runtime/runtime-daemon/src/refactor-recording.ts packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts && rm -f packages/core/refactor-assessment/src/resolution.ts packages/core/refactor-assessment/test/resolution.test.ts packages/local-runtime/runtime-daemon/src/refactor-verify.ts packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts`. No SQLite migration, no contract change, no publish. Resolution and snapshot evidence events already appended are additive with `operations: []`, so `graphDigest` is untouched and `ledger rebuild` parity survives the revert; the records simply become unreadable until the branch is re-applied.

## Task Breakdown

- [ ] refactor-assessment/src/resolution.ts: metric vocabulary, readSnapshotMetric, outcome vocabulary issues, deriveObservationOutcomes, evaluateResolution (six-step ladder, kill-list path/relation, symbol → stale)
- [ ] re-export from refactor-assessment/src/index.ts; resolution.test.ts covering every fixture in decision (e)
- [ ] runtime-daemon/src/refactor-verify.ts: RuntimeRefactorVerifyInput, runRefactorVerify (load/guard/re-scan/evaluate/append one evidenceOperations event), resolutionEvidenceItems, findResolutionEvidence
- [ ] daemon wiring: refactorVerify on interface/class/dispatch/RuntimeRpcClient + RUNTIME_RPC_LONG_METHODS
- [ ] refactor-recording.ts: baseline-snapshot evidence item + binding on the record event
- [ ] resolve gate: replace RF3 rejection arm with the evidence lookup (four reason codes)
- [ ] refactor-verify.test.ts + refactor-recording.test.ts updates; RF0–RF3 suites green; docs plan zero owned drift; bun run verify
