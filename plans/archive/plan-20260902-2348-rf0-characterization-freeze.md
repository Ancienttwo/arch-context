# Plan: Sprint task: rf0-characterization-freeze

> **Status**: Archived
> **Created**: 20260902-2348
> **Slug**: rf0-characterization-freeze
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf0-characterization-freeze
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260902-2348-rf0-characterization-freeze.md`; after execution revert branch `codex/rf0-characterization-freeze` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md`
> **Task Review**: `tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md`
> **Implementation Notes**: `tasks/notes/20260902-2348-rf0-characterization-freeze.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf0-characterization-freeze
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260902-2348-rf0-characterization-freeze.md`
- Sprint contract: `tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md`
- Sprint review: `tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md`
- Implementation notes: `tasks/notes/20260902-2348-rf0-characterization-freeze.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260902-2348-rf0-characterization-freeze.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260902-2348-rf0-characterization-freeze.md`.

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
- Contract file: `tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md`
- Review file: `tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md`
- Implementation notes file: `tasks/notes/20260902-2348-rf0-characterization-freeze.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260902-2348-rf0-characterization-freeze.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260902-2348-rf0-characterization-freeze.md`; after execution revert branch `codex/rf0-characterization-freeze` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: six packages gain new test suites plus committed digest fixtures and a perturbation-probe artifact; this is a mergeable unit with its own verification boundary, not a single checklist step.

## Evidence Contract

- **State/progress path**: `plans/plan-20260902-2348-rf0-characterization-freeze.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md`, `tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md`, and `tasks/notes/20260902-2348-rf0-characterization-freeze.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260902-2348-rf0-characterization-freeze.md`; after execution revert branch `codex/rf0-characterization-freeze` or the explicitly reviewed diff.

## Captured Planning Output

# Sprint Task: rf0-characterization-freeze

## Context

- Sprint: `plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md`
- Backlog row: 1
- Mode: contract
- Source PRD: `plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md` §RF0
- Acceptance line: `test/fixtures/refactor-baseline/` digest fixtures exist under `packages/core/refactor-decision`, `packages/core/pressure-engine`, `packages/core/recommendation-engine`, `packages/core/projection-engine`, `packages/local-runtime/codegraph-adapter`; `bun test` for those five packages passes; `bun evals/run.ts --check` exit 0; `git diff --stat -- docs/architecture` empty

## Goal

Freeze the current observable behavior of the six surfaces RF1–RF4 will change, using committed literal digests plus literal expected payloads, so any later behavior drift fails a test instead of silently redefining truth. Zero production behavior change; zero `src/` edits.

## Why

RF1 rewrites footprint source (worktree scan → git-tracked set), RF2 adds scale classification, RF3 migrates recommendation v2→v3, RF4 adds verify. Each rides on code with no behavioral pin today: `loadCapabilitySourceScaleSignals` has one happy-path test and no bucket-label test; `capabilityImportGraphs`' outbound-only filter and global `truncated` copy are untested; `computeRefactorConfidence` scoring, `decidePosture`, and `prepareTask`'s `0.8/true/true` defaults are asserted only indirectly. `bun evals/run.ts --check` imports `detectArchitecturePressure`, `computeRefactorConfidence`, `createInterventionProposal`, `decidePosture` (evals/run.ts:34-35), so eval drift would be attributed to eval data, not to a silent engine change. Without RF0, "we did not change behavior" is unfalsifiable.

## Scope

In scope:
- New `*.test.ts` + `test/fixtures/refactor-baseline/*.json` in six packages.
- One perturbation-probe artifact under `docs/verification/`.

Out of scope:
- Any edit under any `src/`. No `export` added: `scaleMagnitudeBucketLabel` is private (`packages/core/projection-engine/src/index.ts:814`) but fully reachable through `renderArchitectureDocumentationProjection` (`:1693`), so freeze it through the rendered line. If an export seems unavoidable, stop and hand back.
- No fixes to found defects (worktree-dependent `lineCount`, global `truncated`). Record them in the notes file as RF1/RF2 input.
- No regeneration script, no `--update-fixtures` flag, no writes into `docs/architecture`.

## Allowed Paths

```yaml
allowed_paths:
  - packages/core/projection-engine/test/
  - packages/core/pressure-engine/test/
  - packages/core/refactor-decision/test/
  - packages/core/recommendation-engine/test/
  - packages/core/application/test/
  - packages/local-runtime/codegraph-adapter/test/
  - docs/verification/rf0-characterization-drift-probe.txt
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md
  - tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md
  - tasks/notes/20260902-2348-rf0-characterization-freeze.notes.md
```

## File Changes

| File | Action | What it freezes |
|---|---|---|
| `packages/core/projection-engine/test/refactor-baseline.test.ts` + `test/fixtures/refactor-baseline/` | add | `loadCapabilitySourceScaleSignals` / `loadCapabilitySourceFootprints` over a tmpdir tree (include−exclude, `node_modules`/`.git` skip, sort order, `countFileLines` no-trailing-newline case, nodes without `source.include` omitted); bucket output via `renderArchitectureDocumentationProjection` for values 0,1,2,5,9,10,199,200,500,999,1000,9999,10000,100000,1000000,2000000 plus the `-1`/non-integer throw |
| `packages/local-runtime/codegraph-adapter/test/refactor-baseline.test.ts` + fixtures | add | `resolveImportTarget` candidate order and refusals (bare specifier, `../` escape, missing target, directory-only); `importEdgesFromQueryNodes` edge shape; outbound-only filter (`!scope.has(pair.from)`, `src/index.ts:1006-1010`); global `truncated` copied into every graph at `importNodeLimit` boundary (`:1017/1029`); `prepareProjectionCodeFacts` handshake field list + `requiredVersion` `1.5.0` |
| `packages/core/pressure-engine/test/refactor-baseline.test.ts` + fixtures | add | `detectArchitecturePressure` full `{level,score,signals}` digest per case; heuristic-only cap 25 (`:101-103`); `hasBidirectionalImport` → `dependency-cycle` high (`:82`, `:189-195`); level thresholds 30/60 |
| `packages/core/refactor-decision/test/refactor-baseline.test.ts` + fixtures | add | `computeRefactorConfidence` score table (clamping, −20/−10 penalties, 70/40 level cuts); `decidePosture` 3×3 matrix; `createProofPoint` literal strings; `createInterventionProposal` including the placeholder strings `module.target-owner`, `relation.target-calls-boundary`, `symbol.legacyWrapper`, `symbol.fallbackMapper` frozen as-is |
| `packages/core/recommendation-engine/test/refactor-baseline.test.ts` + fixtures | add | `recommendationFingerprint` literal digests (with/without `practiceId`, `evidenceBindingIds` sort-insensitivity, null `baselineDigest`); `planRecommendationRun` at fixed `now` → `duplicate-active-fingerprint` via `previousActiveByFingerprint`, `cooldown-active` at `DEFAULT_COOLDOWN_MS`, `runId`/`recommendationId` digest suffixes |
| `packages/core/application/test/refactor-baseline.test.ts` + fixtures | add | `prepareTask` defaults `callerCoverage ?? 0.8`, `testsAvailable ?? true`, `rollbackAvailable ?? true` (`src/index.ts:68-72`) → frozen `score 86` / `level "high"`, and the resulting posture/intervention branch |
| `docs/verification/rf0-characterization-drift-probe.txt` | add | Captured failing output from the mandatory perturbation probe |

## Fixture Strategy

Synthetic only. Filesystem surfaces use `mkdtempSync(join(tmpdir(), "archctx-rf0-…"))` and `rmSync` in `finally`, the established pattern (`entity-summary.test.ts:640`, `capability-projection-inputs.test.ts:83`). No git-tracked fixture source tree. CodeGraph is faked by reusing the existing written-to-disk fake CLI + `binary` / `selectorIndexFactory` options (`capability-projection-inputs.test.ts:38-105`); `CodeFactsPort` is faked by reusing the object literal shape in `packages/core/application/test/control-loop.test.ts:24-88`.

Each fixture file is JSON: `{ id, description, input, expected, digest }`. The test reconstructs `input`, runs the real function, normalizes, then asserts both `toEqual(fixture.expected)` and `digestJson(normalized) === fixture.digest` (`digestJson` from `@archcontext/contracts`, `schema.ts:88`).

Not self-fulfilling, three enforced ways:
1. `expected` and `digest` are literal committed data. The test never writes, never regenerates, never has a mismatch-tolerant branch. Capture is a one-shot throwaway `bun -e …` during implementation whose output the worker pastes in; no script ships.
2. Volatile fields are excluded from `input`/`expected` by an explicit `normalize()` allow-list, not by wildcard: drop `binaryDigest`, `indexedWorktreeDigest`, `generatedAt`, absolute paths. Freeze the field list and the stable values.
3. Causation control (blocking). Before declaring done, perturb exactly one production constant (`score += 15` → `16` in `packages/core/refactor-decision/src/index.ts`), re-run the six suites, capture the failing output plus `PROBE_EXIT=$?` into `docs/verification/rf0-characterization-drift-probe.txt`, then `git checkout -- packages/core/refactor-decision/src/index.ts` and confirm `git status --short -- packages` shows no `src/` entry. Fixtures that stay green under perturbation are shape-only and do not count.

## Steps

1. Work only inside the contract worktree; the primary tree has `docs/architecture/index.md` modified and `docs/architecture/requests/root.md` untracked (other work), which would falsify the docs exit criterion.
2. Record baseline: `bun test` on the six packages (currently 130 pass / 13 files for the five + 11 pass for application) and `bun evals/run.ts --check` (currently PASS).
3. refactor-decision fixtures + test (smallest, pure, no I/O); establishes the fixture shape all others copy.
4. pressure-engine fixtures + test.
5. recommendation-engine fixtures + test (fixed `now`).
6. application `prepareTask` fixtures + test, reusing the `CodeFactsPort` fake.
7. projection-engine fixtures + test, including the bucket table through the renderer.
8. codegraph-adapter fixtures + test, reusing the fake CLI and forcing `importNodeLimit` truncation.
9. Run the perturbation probe, capture the artifact, revert, verify `src/` clean.
10. Run the full exit-criteria command list; write findings (worktree-dependent `lineCount`, global `truncated`) into the notes file as RF1/RF2 input.

## Exit Criteria

| Command | Expected |
|---|---|
| `bun test packages/core/refactor-decision packages/core/pressure-engine packages/core/recommendation-engine packages/core/projection-engine packages/core/application packages/local-runtime/codegraph-adapter --timeout 60000` | exit 0, 0 fail, ≥ 141 pass (baseline 141 + new) |
| `bun evals/run.ts --check` | exit 0, `Verdict: PASS` |
| `git diff --stat -- docs/architecture` | empty output |
| `git status --short -- packages \| grep '/src/'` | empty (no production edits) |
| `ls packages/{core/refactor-decision,core/pressure-engine,core/recommendation-engine,core/projection-engine,core/application}/test/fixtures/refactor-baseline packages/local-runtime/codegraph-adapter/test/fixtures/refactor-baseline` | all six exist, non-empty |
| `grep -n 'PROBE_EXIT=' docs/verification/rf0-characterization-drift-probe.txt` | one non-zero line |
| `bun run typecheck` | exit 0 |
| `node scripts/privacy-route-audit.mjs` | `[privacy-route-audit] OK` |

## Risks & Stop Conditions

- `privacy-route-audit` is not a binding constraint here (verified): scan roots are `apps`, `services`, `packages/cloud/*`, `packages/surfaces/explorer-ui|renderer|adapter-*`, `packages/core/retrieval` (`scripts/privacy-route-audit.mjs:6-19`). None of the six packages is under a scan root. Stop condition: if a fixture is ever placed under a scan root, build needles from fragments instead.
- Dirty `docs/architecture` in the primary tree is pre-existing WIP, not RF0's. Never "clean up" the user's WIP.
- Env-dependent handshake digests: if a codegraph fixture digest is not stable across two consecutive runs, drop the offending field from `normalize()` rather than loosening the assertion.
- Stop if freezing any surface appears to require an `export`, an `src/` edit, or a regeneration script.

## Rollback Surface

Entirely additive: new test and fixture files under six `test/` directories plus one `docs/verification/` artifact. `git rm` those paths restores the pre-RF0 state exactly; no migration, no persisted state, no generated projection touched.

## Task Breakdown

- [x] Baseline: run the six-package `bun test` and `bun evals/run.ts --check`; record counts in the notes file
- [x] refactor-decision fixtures + test (fixture shape reference)
- [x] pressure-engine fixtures + test
- [x] recommendation-engine fixtures + test (fixed `now`)
- [x] application `prepareTask` defaults fixtures + test
- [x] projection-engine footprint + bucket-through-renderer fixtures + test
- [x] codegraph-adapter import-edge / truncation / handshake fixtures + test
- [x] Perturbation probe: single-constant perturbation, capture `docs/verification/rf0-characterization-drift-probe.txt` with non-zero `PROBE_EXIT=`, revert, confirm no `src/` change
- [x] Run full Exit Criteria table; write RF1/RF2 findings (worktree-dependent `lineCount`, global `truncated`) into the notes file
- [ ] `repo-harness run verify-contract --contract tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md --strict`
