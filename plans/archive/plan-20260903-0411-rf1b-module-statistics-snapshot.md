# Plan: Sprint task: rf1b-module-statistics-snapshot

> **Status**: Archived
> **Created**: 20260903-0411
> **Slug**: rf1b-module-statistics-snapshot
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf1b-module-statistics-snapshot
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md`; after execution revert branch `codex/rf1b-module-statistics-snapshot` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md`
> **Task Review**: `tasks/reviews/20260903-0411-rf1b-module-statistics-snapshot.review.md`
> **Implementation Notes**: `tasks/notes/20260903-0411-rf1b-module-statistics-snapshot.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf1b-module-statistics-snapshot
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md`
- Sprint contract: `tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md`
- Sprint review: `tasks/reviews/20260903-0411-rf1b-module-statistics-snapshot.review.md`
- Implementation notes: `tasks/notes/20260903-0411-rf1b-module-statistics-snapshot.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md`.

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
- Contract file: `tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md`
- Review file: `tasks/reviews/20260903-0411-rf1b-module-statistics-snapshot.review.md`
- Implementation notes file: `tasks/notes/20260903-0411-rf1b-module-statistics-snapshot.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md`; after execution revert branch `codex/rf1b-module-statistics-snapshot` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260903-0411-rf1b-module-statistics-snapshot.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: a new core package plus two adapter producers and a validator correction, with its own line-budget and zero-drift verification boundary; one mergeable unit.

## Evidence Contract

- **State/progress path**: `plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md`, `tasks/reviews/20260903-0411-rf1b-module-statistics-snapshot.review.md`, and `tasks/notes/20260903-0411-rf1b-module-statistics-snapshot.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260903-0411-rf1b-module-statistics-snapshot.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md`; after execution revert branch `codex/rf1b-module-statistics-snapshot` or the explicitly reviewed diff.

## Captured Planning Output

# Sprint Task: rf1b-module-statistics-snapshot

## Context

- Sprint: `plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md`
- Backlog row: 3
- Mode: contract
- Source PRD: `plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md` §RF1, §0.3 items 7–9 and 15–16, §Data Model
- Frozen contract: `packages/contracts/src/refactor.ts` (PR #129)
- Acceptance line: `bun test packages/core/module-statistics` passes fixtures: two-run identical `snapshotDigest`; untracked `dist/` file inside include glob leaves `lineCount` unchanged; ancestor/descendant overlap assigns file to deepest node; non-ancestor overlap sets `ambiguousOwnership=true`; node without `source.include` sets `footprintDeclared=false`; missing index yields `coverage=unknown` and `dependencyGraph=null`; `docs plan --json` reports zero owned drift

## Goal

Ship `packages/core/module-statistics`: a pure, synchronous builder that turns a materialized input (model, tracked files with line counts, repository import pairs, code-facts availability) into a `ModuleStatisticsSnapshotV1` that passes the frozen `moduleStatisticsSnapshotInvariantIssues`, is byte-identical across two runs at the same HEAD/model/index, and perturbs nothing else. Add the two thin producers the builder needs (`readTrackedSourceFiles` in git-adapter, `repositoryImportPairs` in codegraph-adapter) so the snapshot is computable end to end; RF5a only wires RPC/CLI. Correct one frozen-validator rule that contradicts the PRD.

## Why

`packages/contracts/src/refactor.ts` (merged in PR #129) froze the shape and validators; nothing produces one yet. Ownership resolution, module SCC, fan-in and a git-tracked footprint do not exist today: `capabilityImportGraphs` collects outbound edges per node only, and `listScaleScanFiles` / `countFileLines` read the working tree including untracked files (behavior pinned by the RF0 fixtures, so it must not change; the new footprint is built alongside). PR #128 landed the 23-node three-level model, so the repo now has real ancestor overlap (`packages/**/src/**` → `packages/core/**/src/**` → `packages/core/<pkg>/src/**`) to dogfood against.

## Scope

- In scope: new core package `packages/core/module-statistics` (pure, sync, no I/O): ownership resolution, module import graph + Tarjan SCC, codeFacts / tests / uncertainty blocks, repositorySummary, digests via the frozen contract functions; unit tests over synthetic models. Thin producers: `readTrackedSourceFiles(root, includeGlobs?)` in `packages/local-runtime/git-adapter` (git-tracked paths + line counts; fails closed when a tracked file is missing from the worktree) and `repositoryImportPairs(root, binary, limit)` in `packages/local-runtime/codegraph-adapter` (extracts the existing pairs/truncated computation, widened to keep unresolved specifiers, without changing `capabilityImportGraphs`). Contract correction in `packages/contracts/src/refactor.ts`: drop the rule "`tests.callerCoverage` must be null when `coverageStatus` is unknown" and document that `callerCoverage` is a graph-boundary resolution ratio independent of test evidence; update its test.
- Out of scope: RPC `refactorScan`, CLI verb, daemon dispatch (RF5a); `.archcontext/` edits; any behavior change to `loadCapabilitySourceFootprints`, `countFileLines`, `listScaleScanFiles`, `capabilityImportGraphs`; `docs/architecture` content; `instability`, `directionViolationCount` (P1, emit `null`); any other contract change.

## Allowed Paths

```yaml
allowed_paths:
  - packages/core/module-statistics/
  - packages/core/package.json
  - tsconfig.json
  - packages/local-runtime/git-adapter/src/index.ts
  - packages/local-runtime/git-adapter/test/
  - packages/local-runtime/codegraph-adapter/src/index.ts
  - packages/local-runtime/codegraph-adapter/test/module-import-pairs.test.ts
  - packages/contracts/src/refactor.ts
  - packages/contracts/test/refactor-contracts.test.ts
```

Forbidden (explicit): `.archcontext/**`, `docs/architecture/**`, `packages/core/projection-engine/src/**`, `packages/surfaces/**`, `packages/local-runtime/runtime-daemon/**`, every `**/test/fixtures/refactor-baseline/**`, any other file in `packages/contracts/src`.

## File Changes

| Path | Action | Note |
|---|---|---|
| `packages/core/module-statistics/src/index.ts` | add | `ModuleStatisticsInputV1`, `buildModuleStatisticsSnapshot(input)`, ownership, Tarjan, summary |
| `packages/core/module-statistics/test/ownership.test.ts` | add | deepest owner, non-ancestor ambiguity, undeclared footprint |
| `packages/core/module-statistics/test/snapshot.test.ts` | add | determinism (two runs byte-identical), missing index, validator returns `[]` |
| `packages/core/module-statistics/test/graph.test.ts` | add | SCC / cycleCount / fanIn / fanOut / internal edges |
| `packages/core/package.json` | edit | add `"./module-statistics"` export |
| `tsconfig.json` | edit | add `@archcontext/core/module-statistics` path |
| `packages/local-runtime/git-adapter/src/index.ts` | edit | add `readTrackedSourceFiles`; fail closed on missing tracked file |
| `packages/local-runtime/git-adapter/test/git-adapter.test.ts` | edit | tmp git repo: untracked `dist/x.ts` inside an include glob is excluded; line counts stable |
| `packages/local-runtime/codegraph-adapter/src/index.ts` | edit | add `repositoryImportPairs` (additive; `capabilityImportGraphs` untouched) |
| `packages/local-runtime/codegraph-adapter/test/module-import-pairs.test.ts` | add | fake CLI: resolved + unresolved pairs, global truncation flag |
| `packages/contracts/src/refactor.ts` | edit | remove the callerCoverage/coverageStatus coupling rule; doc comment |
| `packages/contracts/test/refactor-contracts.test.ts` | edit | replace the coupling test with: non-null callerCoverage accepted under `coverageStatus: unknown`; ratio bounds still enforced |

## Design Decisions

- (a) Pure sync builder, materialized input. `@archcontext/core` forbids child processes (`packages/core/projection-engine/src/index.ts:240-243`); async port mocks add a layer with no extra coverage. Input: `model` (native nodes), `repository`, `worktree`, `trackedFiles: {path, lineCount}[]`, `importEdges: {from, to: string|null}[]`, `truncated`, `edgeLimit`, `codeFacts: {version, binaryDigest, availability, indexFreshForWorktreeDigest}`, `createdAt`.
- (b) Own ownership resolver; do not call `resolveArchitectureOwnerForPath` (its ADR-0043 longest-literal-prefix tie-break contradicts the PRD ancestor rule, `projection-engine/src/index.ts:2382-2400`). Reuse only `matchesGlob` and `nativeNodeSource`. Candidates = nodes whose include matches after exclude; if they form one `parent` chain, deepest wins; otherwise every off-chain candidate gets `ambiguousOwnership = true` and the file counts into `multiplyOwnedFileCount`. Nodes without `source.include` ⇒ `footprintDeclared = false`, `footprint = null`.
- (c) Graph derived, inbound never queried: module edges = owner(from) → owner(to) over resolved edges. `internalEdgeCount`, `outboundModuleEdges` / `inboundModuleEdges` (crossing file edges), `fanOut` / `fanIn` (distinct peer modules), `crossModuleEdgeCount` (distinct ordered module pairs). Tarjan over the module graph; `stronglyConnectedComponentId = scc.<16 hex of digestJson(sorted members)>` or `null` for a trivial SCC without self-loop; `cycleCount` = this module's out-edges that stay inside its own SCC (simple-cycle enumeration is exponential; say so in a comment). `instability` / `directionViolationCount` = `null`.
- (d) `indexedWorktreeDigest` must be the measured worktree digest, not the handshake's (`CodeGraphProjectionHandshakeV1.indexedWorktreeDigest` and `CodeFactsSnapshot.workspaceDigest` are different domains). Input carries `indexFreshForWorktreeDigest`; the builder emits it only when equal to `worktree.worktreeDigest`, else forces `coverage = "unknown"`. Coverage: `unknown` when availability ≠ ready, `partial` when truncated, else `complete`; `unknown` ⇒ `truncated = true` and every `dependencyGraph = null`. Never use `extensions` (excluded from digests).
- (e) `tests` block: `schemas/repo/architecture-node.schema.json` `source` is `additionalProperties: false` with only `include` / `exclude` / `entrypoints`, so `source.tests` cannot exist ⇒ `coverageStatus: "unknown"`, `testFileCount: null`, `observedTestEdges: null`. `callerCoverage`: PRD §0.3-16 makes it `null` whenever `dynamicInvocation ∈ {known, unknown}`; import edges cannot observe dynamic invocation, so v1 emits `dynamicInvocation: "unknown"` and `callerCoverage: null`, with reason code `caller-coverage-unknown`. Record in notes: RF2 must not treat `callerCoverage` as essential evidence in 0.5.0 (it lowers `confidence.level` only), and the PRD needs that clarification before RF2 starts.
- (f) `createdAt` supplied by the caller (frozen interface requires it; digest already excludes it). The producer side (RF5a) defaults it to HEAD's committer date so `scan --json` stays byte-identical; the core test asserts two builds with the same input are byte-identical JSON.
- (g) No RPC / daemon / CLI in this row (RF5a). `production-mock-reachability-audit.mjs` only bans mock tokens, so uncalled exports are safe.
- (h) Zero owned drift is a line-budget problem: the module doc prints the 1–2–5 bucket. `module.architecture-context.core` is at 24 files / 17,147 lines against `20–50` / `10k–20k`; new core `src/**` must stay under 2,800 lines and 26 files. `module.architecture-context.local-runtime` must likewise stay inside its current bucket; check both before finishing. Tests live under `test/` (excluded by every node).
- (i) Contract correction is minimal: one validator rule removed (`refactor.ts` ~:483-484) plus its doc comment; no shape change; no other frozen rule touched.

## Steps

1. Register the export in `packages/core/package.json` and the path in `tsconfig.json`; create the package.
2. Define `ModuleStatisticsInputV1`.
3. Implement candidate matching (`matchesGlob`, exclude first) and the `parent`-chain deepest-owner rule.
4. Build `footprint` (fileCount, summed lineCount, `sourceFilesDigest = digestJson([{path, lineCount}])`, include/exclude verbatim).
5. Build `surfaces` (`declaredEntrypoints` from `source.entrypoints[].id`; others `[]`).
6. Build the module graph, run Tarjan, fill `dependencyGraph` or `null`.
7. Fill `uncertainty` (`unresolvedImports` = owned edges with `to === null`; `dynamicInvocation: "unknown"`) and `tests` (all unknown/null per (e)).
8. Fill `codeFacts` with sorted-unique `reasonCodes` from `REFACTOR_SCALE_REASON_CODES`; sort with plain `.sort()`.
9. Digests via `moduleStatisticsDigest` / `moduleStatisticsSnapshotDigest`; never re-derive.
10. Producers: `readTrackedSourceFiles` (git-adapter; `readTrackedTreeEntries` + line count; missing tracked file ⇒ throw with the paths) and `repositoryImportPairs` (codegraph-adapter; extract from `capabilityImportGraphs` without changing it).
11. Contract correction + test update.
12. Tests; run exit criteria; check both line budgets.

## Exit Criteria

- `bun run typecheck` → exit 0.
- `bun test packages/core/module-statistics/test/ownership.test.ts --timeout 60000` → 0 fail.
- `bun test packages/core/module-statistics/test/snapshot.test.ts --timeout 60000` → 0 fail (includes two-run byte-identical JSON; missing index ⇒ `coverage = unknown`, all `dependencyGraph = null`; validator `[]` on every fixture).
- `bun test packages/core/module-statistics/test/graph.test.ts --timeout 60000` → 0 fail.
- `bun test packages/local-runtime/git-adapter/test/git-adapter.test.ts --timeout 60000` → 0 fail (untracked `dist/x.ts` inside the include glob is excluded from the tracked set).
- `bun test packages/local-runtime/codegraph-adapter/test/module-import-pairs.test.ts --timeout 60000` → 0 fail.
- RF0 / RF1a suites still green: `bun test packages/core/projection-engine/test/refactor-baseline.test.ts --timeout 60000`, `bun test packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts --timeout 60000`, `bun test packages/contracts/test/refactor-contracts.test.ts --timeout 60000`.
- `node scripts/package-boundary-audit.mjs` → pass.
- `bun packages/surfaces/cli/src/main.ts docs plan --json | jq -e '[.data.drift.diffs[]? | select(.targetId != null)] | length == 0'` → true (owned-region diffs carry `targetId`).
- `test -z "$(git diff --stat -- docs/architecture .archcontext)"`.

## Risks & Stop Conditions

- `node_modules` may lack new deps after main moved: `bun install --frozen-lockfile` first; if the CLI still aborts before `docs plan`, stop and report.
- If new core source exceeds ~2,800 lines the core bucket flips to `20k–50k` and `docs plan` reports owned drift: densify, or stop and escalate; never re-project `docs/architecture`.
- A tracked file deleted in the worktree makes the footprint unmeasurable: the producer fails closed naming the paths; never skips.
- If `moduleStatisticsSnapshotInvariantIssues` returns anything, fix the producer; the only permitted contract change is the one rule in (i).
- Stop if implementing this requires editing `capabilityImportGraphs`, `loadCapabilitySourceFootprints`, `countFileLines`, or `.archcontext/`.
- Stop if any RF0 baseline fixture fails.

## Rollback Surface

Delete `packages/core/module-statistics/`, revert the one line each in `packages/core/package.json` and `tsconfig.json`, revert the additive functions in git-adapter / codegraph-adapter and their tests, and revert the two-line validator change with its test. No migration, no persisted state, no consumer.

## Task Breakdown

- [ ] Package registration (core exports, tsconfig path) + `ModuleStatisticsInputV1`
- [ ] Ownership resolver (parent-chain deepest owner, ambiguity, undeclared footprint)
- [ ] Footprint + surfaces
- [ ] Module graph + Tarjan + dependencyGraph / null
- [ ] uncertainty, tests, codeFacts, repositorySummary, digests
- [ ] Producers: `readTrackedSourceFiles` (git-adapter) and `repositoryImportPairs` (codegraph-adapter)
- [ ] Contract correction (callerCoverage/coverageStatus rule) + test
- [ ] Tests (ownership / snapshot / graph / adapters); RF0 + RF1a suites green
- [ ] Line budgets checked; `docs plan --json` zero owned drift
- [ ] `repo-harness run verify-contract --contract tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md --strict`
