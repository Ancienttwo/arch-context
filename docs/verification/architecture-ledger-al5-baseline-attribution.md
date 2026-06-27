# Architecture Ledger AL5 Baseline Attribution Readback

Date: 2026-06-26
Scope: AL5-14, AL5-EG4

## P1 Map

The implementation boundary is `packages/core/architecture-delta`. The builder now accepts an optional baseline comparison input and applies attribution before the final `ArchitectureCandidateDelta/v1` draft is emitted.

The authoritative mutation boundary is unchanged. Baseline comparison only changes candidate attribution inside the proposal delta; it does not write ledger state, apply ChangeSets, mutate `.archcontext/`, or alter runtime daemon state.

## P2 Traced Path

Input path:

1. Git change cursor and CodeGraph context
2. `buildArchitectureCandidateDelta(...)`
3. declared target mapping and candidate generation
4. optional `baseline.candidateChanges`
5. candidate target/state/change key comparison
6. task-introduced `candidateChanges`
7. top-level `extensions.baselineAttribution`

Pre-existing candidate keys are removed from `candidateChanges` so downstream policy, review, ChangeSet proposal and ledger event planning see only task-introduced candidates. The suppressed baseline candidates remain visible in `extensions.baselineAttribution.suppressedCandidateChanges` with baseline candidate IDs and reason code `pre-existing-baseline-candidate`.

## P3 Decision

Baseline attribution is key-based on target kind, target id, parent id, state dimension and change kind. This deliberately ignores mapping IDs, because the same pre-existing architecture issue can be rediscovered through both path and symbol evidence in the current task. Treating those as separate task-introduced findings would recreate the over-attribution bug.

The attribution summary is stored in the top-level delta extension. `architectureCandidateDeltaDigest(...)` already excludes top-level extensions, while the candidate list itself changes when pre-existing issues are suppressed. This keeps deterministic candidate output stable without adding a second delta schema.

## Verification

- `bun test packages/core/architecture-delta/test/architecture-delta.test.ts`
- `bun run typecheck`
- `bun test packages/core/architecture-delta/test/architecture-delta.test.ts packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts packages/contracts/test/contracts.test.ts --timeout 90000`
- `bun test`
- `node scripts/sprint-status-check.mjs`

The new test asserts:

- a baseline candidate suppresses matching current candidate changes
- changed subjects and evidence context remain present
- `extensions.baselineAttribution` records baseline and task-introduced counts
- suppressed candidates carry baseline candidate IDs and reason
- the resulting delta digest still matches `architectureCandidateDeltaDigest(...)`
