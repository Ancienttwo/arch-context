# Plan: Sprint task: rf1a-contracts-freeze

> **Status**: Executing
> **Created**: 20260903-0305
> **Slug**: rf1a-contracts-freeze
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-task
> **Source Ref**: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf1a-contracts-freeze
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-0305-rf1a-contracts-freeze.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260903-0305-rf1a-contracts-freeze.md`; after execution revert branch `codex/rf1a-contracts-freeze` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260903-0305-rf1a-contracts-freeze.contract.md`
> **Task Review**: `tasks/reviews/20260903-0305-rf1a-contracts-freeze.review.md`
> **Implementation Notes**: `tasks/notes/20260903-0305-rf1a-contracts-freeze.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md#rf1a-contracts-freeze
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260903-0305-rf1a-contracts-freeze.md`
- Sprint contract: `tasks/contracts/20260903-0305-rf1a-contracts-freeze.contract.md`
- Sprint review: `tasks/reviews/20260903-0305-rf1a-contracts-freeze.review.md`
- Implementation notes: `tasks/notes/20260903-0305-rf1a-contracts-freeze.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260903-0305-rf1a-contracts-freeze.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260903-0305-rf1a-contracts-freeze.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260903-0305-rf1a-contracts-freeze.md`.

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
- Contract file: `tasks/contracts/20260903-0305-rf1a-contracts-freeze.contract.md`
- Review file: `tasks/reviews/20260903-0305-rf1a-contracts-freeze.review.md`
- Implementation notes file: `tasks/notes/20260903-0305-rf1a-contracts-freeze.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260903-0305-rf1a-contracts-freeze.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260903-0305-rf1a-contracts-freeze.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260903-0305-rf1a-contracts-freeze.md`; after execution revert branch `codex/rf1a-contracts-freeze` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260903-0305-rf1a-contracts-freeze.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260903-0305-rf1a-contracts-freeze.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: a new contracts module plus edits to ledger/schema/index with their own validators, digests, and test file; one mergeable unit with a repo-wide typecheck boundary.

## Evidence Contract

- **State/progress path**: `plans/plan-20260903-0305-rf1a-contracts-freeze.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260903-0305-rf1a-contracts-freeze.contract.md`, `tasks/reviews/20260903-0305-rf1a-contracts-freeze.review.md`, and `tasks/notes/20260903-0305-rf1a-contracts-freeze.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260903-0305-rf1a-contracts-freeze.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260903-0305-rf1a-contracts-freeze.md`; after execution revert branch `codex/rf1a-contracts-freeze` or the explicitly reviewed diff.

## Captured Planning Output

# Sprint Task: rf1a-contracts-freeze

## Context

- Sprint: `plans/sprints/20260902-2336-refactor-instrumentation-resolution-ledger.sprint.md`
- Backlog row: 2
- Mode: contract
- Source PRD: `plans/prds/20260902-2312-refactor-intelligence-resolution-ledger.prd.md` §Data Model, §0.3 items 3–6, RF1–RF4
- Acceptance line: `packages/contracts/src/refactor.ts` exports schema constants for `archcontext.refactor-request/v1`, `refactor-proposal/v1`, `module-statistics/v1`, `refactor-assessment/v1`, `recommendation/v3`, `refactor-resolution-evidence/v1` plus invariant validators and digest functions; `RecommendationStatus` shared union exported from `ledger.ts`; `bun test packages/contracts` and `bun run typecheck` pass; `grep -c 'recommendation/v3' packages/local-runtime` is 0

## Goal

Freeze the six refactor contracts in `packages/contracts` as pure types, closed enums, `*InvariantIssues` validators and deterministic digest functions. No consumer switched: `packages/core`, `packages/local-runtime`, `packages/surfaces` untouched.

## Why

RF1b–RF5 and repo-harness Program B must not guess field shapes. `bun run typecheck` (`tsc --noEmit`, repo-wide) is the freeze gate. Verified: `grep -rc 'recommendation/v3' packages/local-runtime` sums to `0`; no runtime array, `Record<ArchitectureEventSource, …>`, `switch`, or SQL CHECK enumerates `ArchitectureEventSource` (only `ledger.ts:20-31` declares it; producers assign literals), so adding `"refactor_scan"` cannot break typecheck.

## Scope

- In: `packages/contracts/src/refactor.ts` (new); `ledger.ts` (extract `RecommendationStatus` + `ArchitectureActorSource`, add `refactor_scan`, add V3 types); `schema.ts` (4 error codes + catalog rows); `index.ts` (one export line); `packages/contracts/test/refactor-contracts.test.ts` (new).
- Out: `ARCHCTX_FEATURES` (RF5a); JSON Schemas under `schemas/` and JSON fixtures under `packages/contracts/fixtures/` (`contracts.test.ts:654-660` asserts fixtures ⇔ `schemaByFixture` bidirectionally, so any fixture forces a schema file + map row); `ARCHCONTEXT_SCHEMA_SET_VERSION` / version bumps; `packages/core/**`, `packages/local-runtime/**`, `packages/surfaces/**`; v2→v3 migration.

## Allowed Paths

```yaml
allowed_paths:
  - packages/contracts/src/refactor.ts
  - packages/contracts/src/ledger.ts
  - packages/contracts/src/schema.ts
  - packages/contracts/src/index.ts
  - packages/contracts/test/refactor-contracts.test.ts
```

Deny (explicit): `packages/core/**`, `packages/local-runtime/**`, `packages/surfaces/**`, `packages/cloud/**`, `packages/contracts/fixtures/**`, `schemas/**`, `.archcontext/**`, `packages/contracts/src/projection.ts`, `packages/contracts/src/product-version.ts`.

## File Changes

| File | Change |
|---|---|
| `packages/contracts/src/refactor.ts` | New. All refactor schema constants, closed enums, digest functions, every `*InvariantIssues` (including `recommendationV3InvariantIssues`). Value-imports `./ledger`, `./schema`, `./projection`. |
| `packages/contracts/src/ledger.ts:20-31` | Append `"refactor_scan"` to `ArchitectureEventSource`. |
| `packages/contracts/src/ledger.ts:617-633` | Extract `export type RecommendationStatus = "open" | … | "expired"`; `RecommendationV2.status: RecommendationStatus`. |
| `packages/contracts/src/ledger.ts:642-647` | `RecommendationFeedbackV1.previousStatus/nextStatus: RecommendationStatus`; extract `ArchitectureActorSource` from the inline `actor.source` union. |
| `packages/contracts/src/ledger.ts` (after `RecommendationFeedbackV1`) | Add `RECOMMENDATION_V3_SCHEMA_VERSION`, `RECOMMENDATION_CATEGORIES`, `RecommendationV3`, `RecommendationAuthorV1`, `RecommendationRelationsV1`, `PracticeRecommendationPayloadV1`, `StructuralObservationPayloadV1`, `RefactorProposalPayloadV1`; payload fields use `import type { … } from "./refactor"`. |
| `packages/contracts/src/schema.ts:12-30, 50-70` | 4 codes + 4 `ERROR_CATALOG` rows. |
| `packages/contracts/src/index.ts` | `export * from "./refactor";` |
| `packages/contracts/test/refactor-contracts.test.ts` | New; inline TS fixtures only. |

## Type & Digest Decisions

- V3 types live in `ledger.ts`, all runtime code in `refactor.ts`. V3 is a ledger record and must reuse `RecommendationStatus` / `ArchitectureActorKind` beside V2. `ledger.ts → refactor.ts` is `import type` only (erased); `refactor.ts → ledger.ts` is the sole runtime edge, so no ESM cycle.
- `ArchitectureActorSource` extraction (`"cli"|"mcp"|"manual"|"daemon"|"system"|"subagent"`) is required: `structural_observation` needs `source: "daemon"`, which the PRD's 4-value proposal union excludes. Narrowing is enforced by validators, not by the type.
- Canonical rule: every digest = `digestJson(...)` from `./schema` (recursive key-sort + `JSON.stringify`, `sha256:<64hex>`), identical to `architectureSnapshotDigest`.
- Exclusions (destructure-and-hash, mirroring `ledger.ts:735-770`): always drop the digest field itself, `extensions`, and every timestamp. `assessmentDigest` also drops `requestId` (per-invocation). `interventionId` = `intervention.` + first 16 hex of the delta minus `interventionId` / `unresolvedTargets` / `extensions` (ArchContext fills `unresolvedTargets`, so it must not alter Agent-authored identity). `proposalDigest` keeps `authoredBy` (the no-self-authored gate must be digest-bound; dedup lives at fingerprint level).
- `recommendationV3FingerprintInput()` returns the canonical input object and does not hash. RF3 feeds it to the existing `recommendationFingerprint()` (`packages/core/recommendation-engine/src/index.ts:272`). Subset: `{category, subjectSelectorId, practiceId ?? null, payload subset}`; refactor_proposal payload subset = `{proposalDigest, scale, affectedNodeIds, majorChangeReasons}` sorted; deliberately excludes `baselineSnapshotDigest` / `assessmentDigest` so re-detection at a new HEAD dedups and drives `relations.regressesFrom`.
- Closed enums as sorted `as const` arrays + `(typeof X)[number]`, per `ARCHITECTURE_MAJOR_CHANGE_REASON_CODES`: `REFACTOR_SCALES` (`architecture, cross_module, insufficient_evidence, model_adoption_required, module`); `REFACTOR_SCALE_REASON_CODES` (the 10 PRD codes: `code-facts-missing`, `code-facts-truncated`, `ownership-ambiguous`, `unowned-paths`, `node-footprint-undeclared`, `caller-coverage-unknown`, `target-unresolved`, `single-node-scope`, `multi-node-scope`, `major-change-detected`); `REFACTOR_OBSERVATION_KINDS` (`cycle`, `ownership-ambiguous`, `unowned-paths`, `undeclared-footprint`, `evidence-gap`, `direction-violation`); `REFACTOR_RESOLUTION_DISPOSITIONS` (`resolved`, `partially_resolved`, `not_improved`, `regressed`, `stale`); `REFACTOR_OUTCOME_OPERATORS` (`equals`, `less_than`, `greater_than`, `absent`, `present`); `REFACTOR_KILL_LIST_KINDS` (`path`, `symbol`, `relation`); `REFACTOR_EXECUTION_EVIDENCE_KINDS` (`task_contract`, `cutover_closure`, `acceptance_receipt`, `merge_receipt`); `MODULE_DYNAMIC_INVOCATION_LEVELS` (`none_observed`, `possible`, `known`, `unknown`); `MODULE_TESTS_COVERAGE_STATUSES` (`measured`, `partial`, `unknown`). Reuse `EvidenceCoverageLevelV2` for `codeFacts.coverage` and `ArchitectureMajorChangeReasonCode` for `majorChangeReasons`; do not re-declare.
- Error catalog rows: `AC_MODEL_ADOPTION_REQUIRED` error / retryable false / action `adopt-architecture-model`; `AC_REFACTOR_STALE` warning / true / `rerun-refactor-scan`; `AC_REFACTOR_EVIDENCE_REQUIRED` error / false / `run-refactor-verify`; `AC_REFACTOR_PROPOSAL_UNAUTHORED` error / false / `attach-authoring-actor`.
- `RefactorTargetOutcomeV1` = `{outcomeId, metric, subjectSelectorId, nodeId|null, operator, value: number|null, required: boolean}`; `RefactorObservedOutcomeV1` = `{outcomeId, observedValue: number|null, satisfied: boolean, direction: "improved"|"unchanged"|"regressed"|"unknown"}`. This shape is a design call sized to the PRD's own example (`cycle → cycleCount less_than 1`); record it in the notes file.
- Validators enforce the PRD hard rules checkable at value level: `refactor_proposal.authoredBy.source ∉ {system, daemon}`; `structural_observation.authoredBy.source == daemon`; `scale` null ⇔ `proposalDigest` null; `architecture` scale ⇒ non-empty `majorChangeReasons`; `unresolvedTargets` non-empty ⇒ scale `insufficient_evidence`; disposition consistent with outcomes (all required satisfied ⇒ `resolved`; none ⇒ `not_improved`; any `regressed` direction ⇒ `regressed`); `majorChangeReasons ⊆ ARCHITECTURE_MAJOR_CHANGE_REASON_CODES`; every digest field matches `sha256:<64hex>`; cross-entity `refactorScanInvariantIssues({snapshot, proposal, assessment})` (assessment digests reference the given snapshot/proposal) and `refactorVerifyInvariantIssues(afterSnapshot, evidence)`.

## Steps

1. `refactor.ts`: schema-version constants + all closed enums.
2. `refactor.ts`: `RefactorRequestV1`, `RefactorProposalV1`, `ArchitectureTargetDeltaV1`, `RefactorTargetOutcomeV1`, `RefactorObservedOutcomeV1`, `ModuleStatisticsV1`, `ModuleStatisticsSnapshotV1`, `RefactorAssessmentV1`, `RefactorResolutionEvidenceV1`.
3. `ledger.ts` edits: `refactor_scan`; `RecommendationStatus`; `ArchitectureActorSource`; V3 + payload types via `import type`.
4. `schema.ts`: 4 codes + catalog rows.
5. `refactor.ts`: digests `refactorProposalDigest`, `moduleStatisticsDigest`, `moduleStatisticsSnapshotDigest`, `refactorAssessmentDigest`, `refactorResolutionEvidenceDigest`, `architectureTargetDeltaInterventionId`, `recommendationV3FingerprintInput`.
6. `refactor.ts`: per-entity validators + cross-entity `refactorScanInvariantIssues` and `refactorVerifyInvariantIssues`.
7. `index.ts`: add the export line.
8. Write `refactor-contracts.test.ts` with inline fixtures (build zero digests as `sha256:${"0".repeat(64)}`; never a literal zero digest, `scripts/package-boundary-audit.mjs:134` rejects it outside tests).
9. Run the exit-criteria commands.
10. Confirm `packages/contracts/fixtures/` and `schemas/` are untouched.

## Exit Criteria

- `bun run typecheck` → exit 0.
- `bun test packages/contracts/test/refactor-contracts.test.ts` → 0 fail; covers each validator positive + ≥ 1 negative, and per digest: same input twice equal, shuffled key order equal, mutated `extensions` / timestamp equal, mutated payload field different.
- `bun test packages/contracts/test/contracts.test.ts` → 0 fail (fixture ⇔ schema equality still holds, proving no fixture was added).
- `bun test packages/contracts/test/publishability.test.ts` → 0 fail.
- `grep -rc 'recommendation/v3' packages/local-runtime | awk -F: '{s+=$2} END {print s+0}'` → `0`.
- `node scripts/package-boundary-audit.mjs` → passes.
- `git status --short -- packages/contracts/fixtures schemas` → empty.
- `git diff --stat -- packages/core packages/local-runtime packages/surfaces` → empty.

## Risks & Stop Conditions

- Runtime import cycle: if any V3 value (not type) is needed in `ledger.ts`, the type-only edge breaks. Stop and move `RecommendationV3` wholesale into `refactor.ts` rather than adding a runtime back-edge.
- `RecommendationStatus` name clash: `packages/core/recommendation-engine/src/index.ts:22` already exports the same alias. Safe today (the `packages/core/src/index.ts` barrel does not include recommendation-engine; nothing does `export * from "@archcontext/contracts"`). If typecheck reports a duplicate re-export, stop; the fix belongs in RF3.
- JSON Schema deferral: if repo-harness needs runtime validation of `refactor scan` output at 0.5.0, `schemas/runtime/*.schema.json` + fixtures + `schemaByFixture` rows become mandatory; that is an RF5a slice, not RF1a.
- Digest churn: any later change to a hashed field invalidates every stored digest; RF1b onward must treat these functions as frozen.

## Rollback Surface

`git checkout -- packages/contracts/src/ledger.ts packages/contracts/src/schema.ts packages/contracts/src/index.ts && rm packages/contracts/src/refactor.ts packages/contracts/test/refactor-contracts.test.ts`. Nothing outside `packages/contracts` is written; no persisted state, no generated projection, no `.archcontext/` touch.

## Task Breakdown

- [x] Enums + schema-version constants in `refactor.ts`
- [x] Entity types in `refactor.ts`
- [x] `ledger.ts`: `refactor_scan`, `RecommendationStatus`, `ArchitectureActorSource`, V3 + payload types (type-only import)
- [x] `schema.ts`: 4 error codes + catalog rows
- [x] Digest functions + `recommendationV3FingerprintInput`
- [x] Validators (per-entity + cross-entity)
- [x] `index.ts` export; test file with inline fixtures
- [x] Exit criteria run; notes record the outcome-shape design call
- [x] `repo-harness run verify-contract --contract tasks/contracts/20260903-0305-rf1a-contracts-freeze.contract.md --strict`
