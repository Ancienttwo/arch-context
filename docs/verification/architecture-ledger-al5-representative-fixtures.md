# Architecture Ledger AL5 Representative Fixtures Readback

Date: 2026-06-26
Scope: AL5-15

## P1 Map

The fixture boundary is `packages/core/architecture-delta/test/fixtures/representative-architecture-changes.ts` plus the focused `architecture-delta` test. The production builder path is unchanged.

The fixtures cover the AL5 representative architecture-change set:

- monolith-to-service extraction
- persistence boundary change
- public API change
- payment webhook addition
- mapper removal
- package-layer change

## P2 Traced Path

Each fixture enters through the same deterministic candidate delta route:

1. Git path metadata
2. CodeGraph-style symbols and import edges
3. `buildArchitectureCandidateDelta(...)`
4. declared entity and relation mapping
5. derived candidate changes for nodes, relations, constraints, owners, lifecycle and migration state
6. evidence bindings with `authorityEffect: context-only`

The test asserts that the representative changes map without unresolved ambiguity and that every declared scenario emits its expected candidate change.

## P3 Decision

The fixtures do not add new production behavior. They exercise the existing domain split between direct mappings and derived candidate changes:

- path and symbol selectors map to declared entities
- relation selectors map by declared endpoints
- constraints are candidate changes derived from entity mappings, not independent mapping targets

This preserves the current authority boundary while adding coverage for realistic AL5 architecture changes.

## Verification

- `bun test packages/core/architecture-delta/test/architecture-delta.test.ts`
- `bun test packages/core/architecture-delta/test/architecture-delta.test.ts packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts packages/contracts/test/contracts.test.ts --timeout 90000`
- `bun run typecheck`
- `bun test`
- `node scripts/sprint-status-check.mjs`
- `git diff --check`

The new representative test asserts:

- all six AL5-15 fixture scenarios are present
- no representative scenario becomes unresolved or ambiguous
- expected node, relation, constraint, lifecycle and migration-state candidate changes are emitted
- declared entity and relation evidence bindings remain context-only
- the resulting delta digest matches `architectureCandidateDeltaDigest(...)`
