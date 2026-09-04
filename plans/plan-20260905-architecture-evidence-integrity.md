# Plan: Architecture evidence integrity and downstream handoff

> **Status**: Complete
> **Created**: 2026-09-05
> **Artifact Level**: work-package
> **Promotion Reason**: verification_boundary
> **Verification Boundary**: observed evidence and prepare posture public behavior
> **Rollback Surface**: revert this work-package merge
> **Spec**: `docs/spec.md`
> **Task Contract**: `tasks/contracts/20260905-architecture-evidence-integrity.contract.md`
> **Task Review**: `tasks/reviews/20260905-architecture-evidence-integrity.review.md`
> **Implementation Notes**: `tasks/notes/20260905-architecture-evidence-integrity.notes.md`

## Authorization

User explicitly requested a plan, parallel fast-worker/deep-worker execution, parent supervision, acceptance, commits and merge. Downstream repo-harness is concurrently developed on another machine: deliver a handoff, do not edit that checkout. No package publication or deployment in this work-package.

## P1 Architecture Map

CodeGraph/Git observations feed context-compiler -> pressure-engine -> application.prepareTask/refactor-decision; newer module-statistics/refactor-assessment already preserves unknown evidence. Runtime daemon calls prepareTask without confidence evidence. Changes must preserve single writer and existing RF2 contracts.

## P2 Concrete Trace and Root Cause

A synthetic file named src/legacy-wrapper-owner.ts with no edges gives observed pressure 65/high. prepareTask defaults missing callerCoverage/tests/rollback to .8/true/true, producing confidence 86/high; createInterventionProposal invents fixed owners, relations and kill targets. Existing RF0 tests freeze this unsafe behavior. Unknown facts and names must not grant evidence or authored semantics.

## P3 Decision

Remove unsupported observed claims in the legacy path, retain only concretely proven graph/runtime facts, and prevent prepare from synthesizing verified readiness or a target architecture. New refactor assessment remains the downstream classifier. Do not build a second classifier, add compatibility readers, alter ledger/model authority or implement a new scheduler. This is the first coherent upstream safety slice, not the whole future optimization roadmap. Full scope/caching/direction-policy work remains separately bounded in the report.

## Detailed Design

- fast-worker owns only packages/core/pressure-engine/src/** and packages/core/pressure-engine/test/**. Remove name/task-text/summary-derived observed claims; preserve exact graph cycles and explicit expired migration-date evidence. Existing task-text cues may remain low advisory heuristics; do not add new heuristics. Add negative controls proving innocuous names do not become observed risks, positive controls for real graph evidence.
- deep-worker owns only packages/core/application/src/**, packages/core/application/test/**, packages/core/refactor-decision/src/**, packages/core/refactor-decision/test/**. Missing readiness evidence is explicit unknown, never .8/true/true. Retire the hardcoded proposal authoring function and its fixed semantic outputs. A high-pressure prepare without an accountable target proposal must require proof/authoring rather than return an invented intervention. Explicit valid numeric/boolean evidence remains checked; invalid evidence fails clearly. Update intentional RF0 behavior characterizations and tests, retaining non-regression assertions.
- Parent owns workflow artifacts, report, downstream handoff, docs/spec.md, context-compiler src/test, directly affected eval report docs/verification/m6-representative-eval-report.md, integration-only affected tests outside worker ownership, verification, review and Git terminal actions. After pressure handoff, fast-worker sequentially owns evals/run.ts and directly affected datasets/history for the integration cutover. Parent does not edit a worker-owned file until handoff.

## Out of Scope

Downstream implementation, new scheduling/LLM runtime, new graph metrics or schema versions, model/SQLite mutation, package upgrades, native-write refactors, Cloud changes, release publication/deployment, unrelated failures.

## Workflow Inventory

- Active plan: `plans/plan-20260905-architecture-evidence-integrity.md`
- Contract: `tasks/contracts/20260905-architecture-evidence-integrity.contract.md`
- Review: `tasks/reviews/20260905-architecture-evidence-integrity.review.md`
- Notes: `tasks/notes/20260905-architecture-evidence-integrity.notes.md`
- Deferred goals: tasks/todos.md
- Current checks: .ai/harness/checks/latest.json
- Isolation: codex/architecture-evidence-integrity at 79c5ef8
- Tooling issue: current global repo-harness resolves a downstream checkout whose installed contracts are stale. Use an isolated published harness tool or direct documented verification; do not repair the other machine's development scope.

## Task Breakdown

- [x] Freeze plan, regression intent and handoff boundaries.
- [x] fast-worker: pressure evidence honesty with focused regression tests.
- [x] deep-worker: unknown confidence and accountable proposal boundary with tests.
- [x] Parent: integrate consumers and document resulting semantics.
- [x] Parent: focused tests, typecheck, full relevant verification and one acceptance review.
- [x] Parent: commit accepted work, merge into local main, read back Git state and handoff.

## Evidence Contract

- State/progress path: this Task Breakdown.
- Verification evidence: task review and ignored run outputs, no fabricated acceptance receipts.
- Evaluator rubric: names/absent evidence cannot produce observed structural claims or fixed targets; true graph/runtime facts remain observed; RF2 161-test baseline stays green.
- Stop condition: accepted upstream changes committed and merged plus portable downstream handoff; stop unrelated repair loops after three rounds.
- Rollback surface: one coherent merge commit.

## Promotion Gate

- **Merge/PR unit**: one local main merge of codex/architecture-evidence-integrity.
- **Rollback surface**: revert the complete evidence-integrity work-package.
- **Verification boundary**: pressure, readiness, context projection, RF2 target/migration invariant and the existing eval runner.
- **Review/acceptance boundary**: one Codex acceptance review after implementation freeze, with source-bound verification.
- **High-risk surface**: structural decision evidence and authored refactor proposal validation.
- **Why not checklist row**: this changes a shared trust boundary across application, context compilation and proposal validation.

## Integration trace refinement

Context compiler (single-repo and landscape paths) also infers caller coverage from nonempty symbols and test evidence from generic verified records. Parent removes those inferences and projects explicit unknowns through existing context fields. The eval runner imports the retired proposal generator and generates fake symbols from task strings; adapt its invariant to the real RF2 target-delta authority and use explicit ground-truth facts, preserving gates and surfacing recall limits instead of fabricating evidence. These are direct consumers of the changed behavior, not unrelated cleanups.

## Bounded integration decisions

- The existing prepare readiness fields pass to context compiler as typed readinessEvidence so top-level confidence and the context projection share one input. Independent context compilation without supplied evidence remains unknown; retrieved symbols and generic verification never fill missing fields.
- Preserve all 32 legacy drift labels unchanged. Remove task-to-facts generation, append four explicit graph/date controls to the same dataset, and report the resulting recall misses. The precision threshold and unrelated eval gates stay unchanged. Archive the retired target generator characterizations and replace the active invariant with actual RF2 authored inputs, including rejection controls.
- One adjacent, directly blocking fix is authorized by the existing work-package: RF2 targetDelta currently permits requiredRelations to overlap temporaryRelations. This defeats the target/migration invariant when retiring the fake generator. Deep-worker sequentially owns only packages/contracts/src/refactor.ts and packages/contracts/test/refactor-contracts.test.ts to add the existing invariant rejection and its red/green proof. There is no new schema version or data translation. No further adjacent feature work is included.
