# Architecture Ledger AL5 ChangeSet Promotion Readback

Date: 2026-06-26
Scope: AL5-11, AL5-EG5

## P1 Map

The implementation boundary is `packages/core/changeset-engine`. It consumes `ArchitectureCandidateDelta/v1` and `ArchitectureCandidateDeltaPolicyEvaluation/v1` from `packages/contracts/src/ledger.ts`, then produces a schema-valid `archcontext.changeset/v1` draft plus an `ArchitectureEventV1` preview batch.

The authoritative mutation boundary is unchanged: `ChangeSetEngine.apply()` remains the only path that writes `.archcontext/` files and rebuilds projections. The new candidate planner is pure and does not write SQLite state, YAML models, generated projections, source bodies, or diff bodies.

## P2 Traced Path

Input path:

1. `ArchitectureCandidateDeltaV1.candidateChanges`
2. `ArchitectureCandidateDeltaPolicyEvaluationV1.decisions`
3. `planArchitectureCandidateChangeSet(...)`
4. accepted policy actions, defaulting to `auto-accept`
5. schema-valid `ChangeSetDraft`
6. deterministic `architecture_candidate_changeset_planned` event with `architectureEventHash(...)`
7. `ChangeSetEngine.preview(...)`

Deferred candidates remain explicit in `deferredCandidateChanges` with their policy action and reason. A policy evaluation whose delta id, digest, repository, or worktree does not match the delta is rejected before a plan is produced.

## P3 Decision

Accepted candidates are represented as ChangeSet operations with candidate metadata, not as direct ledger writes. This preserves the hybrid ledger invariant: deterministic analysis may draft a proposal, but authoritative state changes still require ChangeSet preview, approval, apply, and projection rebuild.

The event payload is marked `preview-only` and `no-raw-source-or-diff-bodies`. It carries candidate IDs, policy decision digests, evidence IDs, and operation metadata sufficient for review without persisting raw code or diff content.

## Verification

- `bun test packages/core/changeset-engine/test/changeset-engine.test.ts`
- `bun run typecheck`

The new test asserts:

- only `auto-accept` candidates enter the ChangeSet by default
- deferred candidates are preserved with policy action
- the ChangeSet validates against `schemas/runtime/changeset.schema.json`
- `ChangeSetEngine.preview(...)` accepts the generated draft
- operations do not carry `body`
- event hash output is deterministic and matches `architectureEventHash(...)`
