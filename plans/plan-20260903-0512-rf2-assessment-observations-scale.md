# Plan: Sprint task: rf2-assessment-observations-scale

> **Status**: Executing
> **Created**: 20260903-0512
> **Slug**: rf2-assessment-observations-scale
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf2-assessment-observations-scale
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260903-0512-rf2-assessment-observations-scale.md`; after execution revert branch `codex/rf2-assessment-observations-scale` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md`
> **Task Review**: `tasks/reviews/20260903-0512-rf2-assessment-observations-scale.review.md`
> **Implementation Notes**: `tasks/notes/20260903-0512-rf2-assessment-observations-scale.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf2-assessment-observations-scale
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260903-0512-rf2-assessment-observations-scale.md`
- Sprint contract: `tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md`
- Sprint review: `tasks/reviews/20260903-0512-rf2-assessment-observations-scale.review.md`
- Implementation notes: `tasks/notes/20260903-0512-rf2-assessment-observations-scale.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260903-0512-rf2-assessment-observations-scale.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260903-0512-rf2-assessment-observations-scale.md`.

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
- Contract file: `tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md`
- Review file: `tasks/reviews/20260903-0512-rf2-assessment-observations-scale.review.md`
- Implementation notes file: `tasks/notes/20260903-0512-rf2-assessment-observations-scale.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260903-0512-rf2-assessment-observations-scale.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260903-0512-rf2-assessment-observations-scale.md`; after execution revert branch `codex/rf2-assessment-observations-scale` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260903-0512-rf2-assessment-observations-scale.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: a new core classifier package with three fixture suites plus a PRD amendment; one mergeable unit with its own typecheck/zero-drift verification boundary.

## Evidence Contract

- **State/progress path**: `plans/plan-20260903-0512-rf2-assessment-observations-scale.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md`, `tasks/reviews/20260903-0512-rf2-assessment-observations-scale.review.md`, and `tasks/notes/20260903-0512-rf2-assessment-observations-scale.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260903-0512-rf2-assessment-observations-scale.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260903-0512-rf2-assessment-observations-scale.md`; after execution revert branch `codex/rf2-assessment-observations-scale` or the explicitly reviewed diff.

## Captured Planning Output

# Sprint Task: rf2-assessment-observations-scale

## Context

- Sprint: `plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md`
- Backlog row: 4
- Mode: contract
- Source PRD: `plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md` §RF2, §0.1, §Data Model
- Frozen contract: `packages/contracts/src/refactor.ts`; RF1b builder: `packages/core/module-statistics`
- Acceptance line: `bun test packages/core/refactor-assessment` passes fixtures single-module (S1 `scale=module`), cross-module (S2 `scale=cross_module`), architecture-owner-change (S3 `scale=architecture`, no placeholder target strings), incomplete-evidence five sub-cases (S5 only `insufficient_evidence`/`model_adoption_required`), observation-only (S7 `scale=null`, zero `refactor_proposal`), heuristic-isolation (same scale with and without `task` text)

## Goal

Ship `packages/core/refactor-assessment` exporting `assessRefactor(...)`: deterministic `observations` from the RF1b snapshot, and — only when the request carries an agent-authored `proposal` — a fail-closed `scale`. Every emitted assessment passes `refactorAssessmentInvariantIssues` and `refactorScanInvariantIssues` with `[]`.

## Why

RF1a froze the contract; RF1b measures. Nothing yet classifies. Without RF2, RF3 has no `payload.scale` to record and repo-harness would build a second classifier. The PRD's essential-evidence set is also unshippable as written: RF1b hard-codes `tests.callerCoverage = null` for every module (`module-statistics/src/index.ts`, `tests:` literal), so making caller coverage essential would make *every* proposal `insufficient_evidence`. That gap must close in this slice.

## Scope

**In**: new core package; `assessRefactor`; observation derivation; scale ordering; `majorChangeReasons` from `targetDelta`; `unresolvedTargets` fill; confidence; snapshot-derived pressure; fixtures; PRD amendment; `packages/core/package.json` + `tsconfig.json` wiring.

**Out**: daemon/RPC/CLI (RF5a), ledger writes/`RecommendationV3` materialization (RF3), `refactor verify` (RF4), `.archcontext/` edits, `docs/architecture` edits, `prepareTask()`/`createInterventionProposal()` changes, `packages/core/pressure-engine` changes.

## Allowed Paths

```yaml
allowed_paths:
  - packages/core/refactor-assessment/src/index.ts
  - packages/core/refactor-assessment/src/target-delta.ts
  - packages/core/refactor-assessment/test/factories.ts
  - packages/core/refactor-assessment/test/observations.test.ts
  - packages/core/refactor-assessment/test/scale.test.ts
  - packages/core/refactor-assessment/test/target-delta.test.ts
  - packages/core/package.json
  - tsconfig.json
  - plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md
```

Deny (explicit): `packages/contracts/**`, `packages/core/module-statistics/**`, `packages/core/pressure-engine/**`, `packages/local-runtime/**`, `packages/surfaces/**`, `.archcontext/**`, `docs/**`, `schemas/**`.

## File Changes

| File | Change |
|---|---|
| `.../refactor-assessment/src/index.ts` | New. `assessRefactor`, observation builders, scale ladder, confidence, pressure, signal ids. Relative-imports `../../module-statistics/src/index` and `../../projection-engine/src/index` (RF1b precedent). |
| `.../refactor-assessment/src/target-delta.ts` | New. `deriveTargetDelta(delta, model) → {reasons, unresolvedTargets}`. |
| `.../refactor-assessment/test/*` | New. Factories + three suites (below). |
| `packages/core/package.json` | Add `"./refactor-assessment": "./refactor-assessment/src/index.ts"`. |
| `tsconfig.json` | Add matching `paths` entry. |
| PRD `§RF2 Hard Constraints`, `Known Unknowns` | Amendment text below. |

## Design Decisions

**(a) Package + signature.** Pure, sync, no clock (core forbids I/O). `assessRefactor({snapshot, model, request, requestId, createdAt})` returns **`{assessment, proposal}`** — not a bare assessment. Rationale: `refactorScanInvariantIssues` reads `proposal.targetDelta.unresolvedTargets`, and ArchContext *fills* that field after authoring (contract doc comment at `refactor.ts:330-337`). `refactorProposalDigest`/`architectureTargetDeltaInterventionId` both hash via `authoredTargetDelta()`, which excludes `unresolvedTargets` — so the fill is digest-safe and the agent-authored identity survives. Returning only the assessment would leave the caller unable to satisfy the scan validator. Throws `AC_SCHEMA_INVALID` when `refactorRequestInvariantIssues` is non-empty, when `digestJson(nodes sorted by id) !== snapshot.modelDigest` (model/snapshot binding — required anyway since `assessment.modelDigest` must equal the snapshot's), or when a `node`-kind scope names an unknown node. `codeFactsDigest := digestJson(snapshot.codeFacts)`.

**(b) Essential evidence — PRD gap resolved.** Essential = (1) every *relevant* node has `footprintDeclared`; (2) every `scopePath` resolves to exactly one deepest owner; (3) `codeFacts.coverage === "complete"`. `callerCoverage`, `testsObserved`, `rollbackObserved` are **non-essential**: all three are structurally null in v1, so promoting them would collapse every scale to `insufficient_evidence`. `caller-coverage-unknown` is still emitted in `scaleReasonCodes` whenever a proposal exists — it documents the confidence cap without selecting a branch.

**(c) Scale ladder** (first match wins; `scaleReasonCodes` sorted unique):

| # | Condition | scale | codes |
|---|---|---|---|
| 0 | no `proposal` | `null` | `[]` |
| 1 | any `scopePath` unowned | `model_adoption_required` | `unowned-paths` |
| 1 | relevant node with `footprintDeclared === false` | `model_adoption_required` | `node-footprint-undeclared` |
| 2 | `coverage === "unknown"` / `"partial"` | `insufficient_evidence` | `code-facts-missing` / `code-facts-truncated` |
| 2 | any `scopePath` contested | `insufficient_evidence` | `ownership-ambiguous` |
| 2 | `unresolvedTargets` non-empty | `insufficient_evidence` | `target-unresolved` |
| 3 | `majorChangeReasons` non-empty | `architecture` | `major-change-detected` |
| 4 | `affectedNodeIds.length > 1` | `cross_module` | `multi-node-scope` |
| 5 | `= 1` | `module` | `single-node-scope` |

Model gate precedes evidence gate: `model_adoption_required` is fixable by a ChangeSet, `insufficient_evidence` may be transient. `affectedNodeIds` = deepest owner per `scopePath` (via RF1b `resolveOwnership(model.nodes, scopePaths)`) ∪ resolved node ids named in `targetDelta`. **Ancestors do not count.** A component plus its parent module's other files yields two owners ⇒ `cross_module`: the per-file ancestor collapse already happened, so two distinct deepest owners means two declared responsibility surfaces are touched. Counting ancestors would make every component edit `cross_module` and kill the signal; dropping the parent would deny that editing `m`'s own files edits `m`. Relevant set = `affectedNodeIds` ∪ `Object.values(targetState.owners)` ∪ node-kind scope id.

**(d) `majorChangeReasons`** (empty `targetDelta` ⇒ `[]`). `targetState.owners` is `Record<role, nodeId>` — keys are free-form role labels (`{primaryLifecycle: "module.target-owner"}`, `refactor-decision/src/index.ts:65`), so keys are never resolved. Derived: `ownership-changed` when the resolved owner-value set ≠ the current deepest-owner set of `scopePaths`; `relation-changed` when a `requiredRelations` id is absent from declared relations, or a `removedConcepts` id names a declared relation; `node-removed` when a `removedConcepts` id names a declared node. **`node-added` is not derivable and is dropped**: the PRD requires every `targetDelta` node id to resolve, so an unknown id is `unresolvedTargets`, never a new node — deriving `node-added` would make a typo'd id silently fail open. **`lifecycle-changed` is dropped**: node/v2 has no declared role→owner map, so it would require regexing agent-authored role labels. `migrationState` contributes nothing (PRD §0.3.10 excludes "migration target state changed"). `unresolvedTargets` = unresolvable `owners` values + `removedConcepts` matching neither a node nor a relation + non-null `completionCriteria[].nodeId` outside the model; sorted unique. **`killList` and `proposal.scopePaths` symbol selectors are NOT resolved** — `killList` sits outside `targetDelta`, and `surfaces.observedEntrypoints` is `[]` for every module in v1, so resolving symbols would force S2 (`killList` symbol + `cross_module`) to `insufficient_evidence`. Kill-list resolution is RF4's job.

**(e) Confidence.** `callerCoverage` = min over affected modules when all non-null, else `null` (always `null` in v1). `testsObserved` = `null` if any affected module has `coverageStatus === "unknown"` (always), else `observedTestEdges > 0`. `rollbackObserved` = `null`; `benefitLedger.rollbackPoint` is agent prose, and treating a non-empty string as observed rollback is exactly the forbidden re-derivation. `unresolvedEvidence` = sorted unique namespaced subjects: `coverage:<level>`, `unowned-path:<path>`, `ownership-ambiguous:<path>`, `undeclared-footprint:<nodeId>`, `target-unresolved:<entry>`, `caller-coverage:<nodeId>`, `tests:<nodeId>`, `rollback:proposal`. `level`: `low` when scale ∈ {`insufficient_evidence`, `model_adoption_required`} or coverage `unknown`; `high` when coverage `complete` and `unresolvedEvidence` empty; else `medium`. Consequence to assert in fixtures: **any proposal caps at `medium` in v1**; observation-only scans on complete coverage reach `high`.

**(f) Pressure — do not call `detectArchitecturePressure`.** Its "observed" predicates regex over file-path and symbol *strings* (`structuralHaystack`), and `multiple-lifecycle-owner` folds `taskHaystack` into an observed signal — a task-text leak into an observed field. RF2 instead derives pressure from the observations it already computed, reusing the pressure engine's own weights (high 25 / medium 15 / low 5, capped 100) and thresholds (`>=60` high, `>=30` medium): `cycle`/`direction-violation` 25, `ownership-ambiguous`/`unowned-paths` 15, `undeclared-footprint`/`evidence-gap` 5. `pressure.signalIds` = every observation's signal id, sorted. `signalId := "signal." + kind + "." + digestJson({kind, subjectSelectorId, metrics}).slice(7, 23)`. `request.task` is accepted and **never read** — the heuristic-isolation fixture therefore asserts full `assessmentDigest` equality, not merely equal scale. No new cross-package import; no heuristic-only cap needed because nothing heuristic is admitted.

**(a-cont) Observations** (snapshot only, sorted by `kind` then `subjectSelectorId`): `cycle` — one per distinct `stronglyConnectedComponentId` (RF1b sets it only for multi-member SCCs and self-looping singletons), subject `scc:<id>`, so S7's single cross-node cycle yields exactly one record, not one per member; `ownership-ambiguous` — one per node with `uncertainty.ambiguousOwnership`, subject `<nodeId>` (the model owner who can fix the globs); `unowned-paths` — one repository-scoped observation with `{unownedFileCount}` (`RefactorObservationV1.metrics` is `Record<string, number|null>`, so path lists cannot be carried anyway); `undeclared-footprint` — one per `!footprintDeclared` node; `evidence-gap` — one when `coverage !== "complete"`; `direction-violation` — one per module with non-null `directionViolationCount > 0` (never fires while RF1b emits `null`; fixture asserts absence).

**(g) Fixtures.** RF1b factory style (`makeInput(overrides)`), synthetic model, no repo I/O. Nodes: `module.m` (`src/m/**`), `component.a` (parent `m`, `src/m/a/**`), `component.b` (parent `m`, `src/m/b/**`), `module.c` (`src/c/**`); S5-3 variant adds `component.shadow` (parent `module.c`, `src/m/a/**`) for non-ancestor contest. Files `src/m/a/x.ts`, `src/m/b/y.ts`, `src/m/root.ts`, `src/c/z.ts`, unowned `tools/gen.ts`. Cases: S1 `["src/m/a/x.ts"]`→`module`; S2 `["src/m/a/x.ts","src/m/b/y.ts"]` + symbol `killList`→`cross_module`; ancestor-span `["src/m/a/x.ts","src/m/root.ts"]`→`cross_module` (owners `a`,`m`); S3 `owners:{primaryLifecycle:"module.c"}` + `removedConcepts:["relation.a-to-b"]`→`architecture`, reasons ⊇ `["ownership-changed","relation-changed"]`, `unresolvedTargets=[]`, plus a negative assertion that no assessment string matches `/module\.target-owner|relation\.target-|legacy-wrapper/`; S5×5 (unavailable index; `truncated`; shadow contest; `tools/gen.ts` in scope; node-kind scope on undeclared `module.m` variant); S7 no proposal + `a↔c` edges → one `cycle` observation, `scale === null`, `proposalDigest === null`; heuristic-isolation — same input twice, `task: undefined` vs a loaded string, `assessmentDigest` equal. Every case asserts `refactorScanInvariantIssues({snapshot, assessment, proposal}) === []`.

**(h)** No daemon/RPC/CLI/capabilities/ledger surface touched; verified by the deny list and `git diff --stat`.

## PRD Amendment

Replace the §RF2 Hard Constraints bullet beginning `` `confidence.*` 直接取 snapshot 量測值或 `null` `` with:

> - Essential evidence（決定 `scale` 的三項，缺一即 fail closed）：(1) proposal 相關的每個 node 都 `footprintDeclared = true`，否則 `model_adoption_required` + `node-footprint-undeclared`；(2) 每個 `scopePaths` 恰好解析到一個最深 owner，無 owner → `model_adoption_required` + `unowned-paths`，非祖先／後代競爭 → `insufficient_evidence` + `ownership-ambiguous`；(3) `codeFacts.coverage = complete`，`unknown` → `code-facts-missing`，`partial` → `code-facts-truncated`。`tests.callerCoverage`、`testsObserved`、`rollbackObserved` **不是** essential：v1 三者恆為 `null`（node/v2 無 `source.tests`；import edge 看不見 dynamic invocation；rollback 只有 Agent 文本），列為 essential 會讓所有提案都判 `insufficient_evidence`。`caller-coverage-unknown` 只進 `scaleReasonCodes` 與 `confidence`，不選分支；帶 proposal 的 assessment 在 v1 因此最高只到 `confidence.level = medium`。
> - `unresolvedTargets` 只由 `targetState.owners` 的 value、`removedConcepts` 條目與 `completionCriteria[].nodeId` 產生。`requiredRelations` 中未宣告的 relation 是「要新建」而非 unresolved；`killList` 在 `targetDelta` 之外，其 symbol / path selector 由 RF4 `verify` 解析，RF2 不解析（v1 `surfaces.observedEntrypoints` 恆為 `[]`）。
> - `majorChangeReasons` v1 只導出 `ownership-changed`、`relation-changed`、`node-removed`。`node-added` 不可導出（未解析的 node id 一律進 `unresolvedTargets`，否則打錯的 id 會 fail open）；`lifecycle-changed` 不可導出（`owners` 的 key 是自由文本 role label，node/v2 無宣告的 role→owner 映射）；`migrationState` 不貢獻任何 code。
> - RF2 不呼叫 `detectArchitecturePressure`：其 observed 判定對 path／symbol 字串做 regex，且 `multiple-lifecycle-owner` 會把 `task` 文本折進 observed signal。`pressure` 改由 RF2 自己的 observations 依 pressure-engine 的權重（25／15／5，上限 100）與門檻（60／30）計算；`request.task` 在 RF2 完全不被讀取，heuristic-isolation fixture 因此斷言完整 `assessmentDigest` 相等。

> - `RefactorProposalV1.scopePaths` 是 repo-relative 的**檔案**路徑清單（不接受目錄或 glob）；目錄或 glob 條目一律視為 unowned path → `model_adoption_required` + `unowned-paths`。Program B 送入 proposal 前必須展開成檔案。

Known Unknowns — replace the `targetDelta` row and append one row:

| Item | Impact | Resolution Path | Owner |
|---|---|---|---|
| ~~[UNKNOWN] `targetDelta` 是否復用 accepted-change 結構~~ **[RESOLVED, RF1a]** `ArchitectureTargetDeltaV1` 已在 `archctx-contracts@0.5.0` 凍結為獨立型別；只復用 `ARCHITECTURE_MAJOR_CHANGE_REASON_CODES` 詞彙表，不復用 `classifyArchitectureMajorChange`（它需要兩份完整 `ArchitectureSemanticStateV1` 與 diagram proof compilation，等於要 ArchContext 自造目標模型，違反 §0.1） | — | — | Maintainer |
| [UNKNOWN] 外部 research provider（如 GPT Pro）撰寫的 proposal 如何標 provenance | 0.5.0 只能以 `developer→manual`（人簽署）或 `subagent→subagent`（harness agent 採納並負責）提交，來源寫在 `intent`；無一等 provenance 欄位 | 若下游需要可稽核的 provenance，0.6.0 contract 加 `provenance?: {provider, ref}`，不新增 author source | Maintainer |
| [UNKNOWN] `confidence.level` 在 v1 帶 proposal 時封頂 `medium` | 下游若把 `medium` 當作不可行動，儀器價值降低 | RF1c／node/v3 `source.tests` 落地後 `testsObserved` 才能非 null；dogfood 兩週後決定是否引入 `evidenceLevel` 分離欄位 | Maintainer |

## Steps

1. Rebase the contract worktree on `main` **after** RF1b merges; confirm `packages/core/module-statistics` is present and `git diff --stat -- docs/architecture .archcontext` is empty.
2. Record the core-bucket budget: `git ls-files 'packages/core/**/src/**' | xargs wc -l | tail -1` (expect `17658`; ceiling `20000` before the 1–2–5 bucket flips and rewrites `docs/architecture`).
3. Apply the PRD amendment first, so the implementation has one authority.
4. Scaffold `packages/core/refactor-assessment/`; wire `packages/core/package.json` exports + `tsconfig.json` paths.
5. Write `test/factories.ts` (model, tracked files, import edges, `makeSnapshot`, `makeProposal` computing real `proposalDigest`/`interventionId`).
6. RED: `observations.test.ts` (S7, cycle-per-SCC, evidence-gap, undeclared, unowned, direction-violation absent).
7. GREEN: observation derivation + signal ids + pressure in `src/index.ts`.
8. RED: `target-delta.test.ts` (reason derivation, `unresolvedTargets`, digest survival after fill).
9. GREEN: `src/target-delta.ts`.
10. RED: `scale.test.ts` (S1, S2, ancestor-span, S3 + placeholder-string negative, S5×5, heuristic-isolation).
11. GREEN: scale ladder + confidence; assert `refactorScanInvariantIssues` `[]` in every case.
12. Re-run step 2's budget check, then the full exit criteria.

## Exit Criteria

| Command | Expected |
|---|---|
| `bun test packages/core/refactor-assessment/test/observations.test.ts` | pass |
| `bun test packages/core/refactor-assessment/test/target-delta.test.ts` | pass |
| `bun test packages/core/refactor-assessment/test/scale.test.ts` | pass; S1 `module`, S2 + ancestor-span `cross_module`, S3 `architecture` with `majorChangeReasons ⊇ ["ownership-changed","relation-changed"]`, S5×5 ∈ {`insufficient_evidence`,`model_adoption_required`}, S7 `scale === null` ∧ `proposalDigest === null`, heuristic-isolation `assessmentDigest` equal |
| `bun test packages/core/module-statistics` | pass (RF1b unregressed) |
| `bun test packages/contracts` | pass (RF1a unregressed) |
| `bun test packages/core/refactor-decision packages/core/pressure-engine packages/core/recommendation-engine packages/core/projection-engine packages/local-runtime/codegraph-adapter` | pass (RF0 characterization digests unchanged) |
| `bun run typecheck` | exit 0 |
| `node scripts/package-boundary-audit.mjs` | `Package boundary audit passed (5 workspaces).` |
| `bun packages/surfaces/cli/src/main.ts docs plan --json` | zero owned drift |
| `git diff --stat -- docs/architecture .archcontext` | empty |
| `git ls-files 'packages/core/**/src/**' \| xargs wc -l \| tail -1` | `< 20000` |
| `bun run verify` | exit 0 |

## Risks & Stop Conditions

- **RF1b not merged.** RF2 relative-imports `../../module-statistics/src/index`. Stop and wait; do not vendor a copy.
- **Contract drift.** If `refactorAssessmentInvariantIssues` or `refactorScanInvariantIssues` must change to make a fixture pass, **stop** — that is a frozen `archctx-contracts@0.5.0` surface and needs an RF1a-style contract slice, not an RF2 edit.
- **Bucket flip.** If step 12's line count reaches `20000`, `docs/architecture` rewrites and the zero-drift criterion fails. Budget: ~2340 lines; target `src/**` ≤ 600. Tests are excluded by `source.exclude: packages/core/**/test/**`.
- **`assessmentDigest` instability.** Any unsorted collection or ambient value (clock, `Math.random`, object-key insertion order) breaks determinism. `createdAt`/`requestId` must be caller-supplied and are excluded by `refactorAssessmentDigest`.
- **Ownership fork.** RF2 must call RF1b's `resolveOwnership`, not `resolveArchitectureOwnerForPath` (ADR-0043 longest-literal-prefix tie-break — a different rule; RF1b documents why).
- **Pre-existing primary-tree drift**: `docs/architecture/index.md` is modified and `docs/architecture/requests/root.md` untracked on `main` right now (verified: `git status --short -uall -- docs/architecture`). The contract worktree branches from a clean `main`, so this must not be carried in; if it appears in the worktree, stop.

## Rollback Surface

Whole slice is additive plus two one-line registrations. `git rm -r packages/core/refactor-assessment`, revert the `packages/core/package.json` export line, the `tsconfig.json` path line, and the PRD amendment hunk. No contract, ledger, `.archcontext/`, generated projection, migration, or published-surface change; nothing downstream imports the package until RF5a.

---

## Task Breakdown

- [x] PRD amendment (§RF2 essential evidence, unresolvedTargets, majorChangeReasons, pressure; Known Unknowns rows)
- [x] Package registration + `assessRefactor` signature returning `{assessment, proposal}`
- [x] Observations + signal ids + pressure (snapshot-only)
- [x] `target-delta.ts`: majorChangeReasons + unresolvedTargets
- [x] Scale ladder + affectedNodeIds + confidence
- [x] Fixture suites (observations / target-delta / scale) incl. heuristic-isolation digest equality
- [x] Budgets + docs plan zero drift; RF0/RF1a/RF1b suites green
- [x] `repo-harness run verify-contract --contract tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md --strict`
