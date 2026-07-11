# Task Contract: DE3 Manifest-Addressed Cache And Required Domains

> **Status**: Complete
> **Approved by**: accepted DE0-DE5 program plan and explicit user instruction to execute the complete Sprint sequentially
> **Program Plan**: `plans/plan-20260711-1328-data-engine-authority-incremental.md`
> **Task Profile**: code-change
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-07-11 18:33
> **Review File**: `tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md`
> **Notes File**: `tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md`

## Goal

Complete only DE3 of the accepted data-engine program:

1. Give every Explorer view a canonical required/optional/not-used input-domain contract.
2. Fail closed before compilation or cache access when a required domain, digest, or
   authority binding is absent, unavailable, or mismatched. A null ledger cursor is
   valid only when the manifest explicitly names Git-visible `.archcontext/` as authority.
3. Address exact cache hits by the complete canonical manifest digest and verify the
   stored manifest/projection body before use.
4. Preserve Delta comparability through the manifest's compatibility digest while
   binding each base/head projection to its own exact manifest digest.

## Why

DE0 introduced a complete input manifest, but domain requirements remain implicit in
daemon branches, missing optional arrays hash like known-empty inputs, and SQLite cache
rows are selected by projection digest or latest view rather than exact manifest. DE3
makes input ownership explicit and closes stale/missing-domain cache acceptance before
DE4 changes the read planner.

## Scope

- In scope: ProjectionInputManifest domain contract; compiler preflight; daemon exact
  manifest cache hit/miss path; migration `0016`; stored projection/manifest integrity;
  TestLocalStore parity; determinism, sensitivity, stale task, cross-worktree, required
  domain, corrupted cache, and exact-hit tests; DE3 readback and AL10 migration package.
- Out of scope: DE4 read planner/partial graph reads, DE5 retention/GC/telemetry,
  Global Subject Search, UI redesign, cloud sync, or ledger authority promotion.

## Allowed Paths

```yaml
allowed_paths:
  - docs/adr/ADR-0045-authority-separated-data-engine.md
  - docs/verification/data-engine-de3-readback.json
  - docs/verification/data-engine-de3-readback.md
  - package.json
  - plans/plan-20260711-1328-data-engine-authority-incremental.md
  - tasks/contracts/20260711-1749-data-engine-de3-manifest-cache.contract.md
  - tasks/notes/20260711-1328-data-engine-authority-incremental.notes.md
  - tasks/reviews/20260711-1328-data-engine-authority-incremental.review.md
  - packages/contracts/src/ports.ts
  - packages/contracts/test/contracts.test.ts
  - packages/contracts/fixtures/valid/explorer-projection-v2.json
  - packages/contracts/fixtures/invalid/explorer-projection-v2-derived-subject.json
  - packages/contracts/fixtures/boundary/explorer-projection-v2-budget.json
  - schemas/runtime/explorer-projection-v2.schema.json
  - packages/local-runtime/local-store-sqlite/src/index.ts
  - packages/local-runtime/local-store-sqlite/test/factories.ts
  - packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
  - packages/local-runtime/runtime-daemon/src/explorer-projection.ts
  - packages/local-runtime/runtime-daemon/src/index.ts
  - packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - packages/surfaces/cli/test/cli.test.ts
  - packages/surfaces/explorer-ui/test/explorer-ui.test.ts
  - scripts/architecture-ledger-al10-release-packaging-readback.ts
  - scripts/architecture-ledger-al10-release-packaging-readback.test.ts
  - scripts/explorer-view-compiler-readback.mjs
  - scripts/packaged-cli-smoke.mjs
  - scripts/data-engine-de3-readback.ts
```

## Invariants

- Required-domain policy is a typed view contract, not daemon convention. Missing or
  unavailable required inputs reject with a stable precondition reason; no empty graph,
  observed facts, binding, backlink, drift, pressure, or task-session value is invented.
- Every input domain has one canonical requirement/status/digest record in the manifest.
  Missing optional and known-empty are distinct. All domain records contribute to the
  exact manifest digest.
- Authority source is explicit. `git` requires a null ledger cursor; `ledger` requires a
  cursor whose repository, worktree, graph digest, and evidence-state digest all match
  the compiled inputs. Git authority is never rejected merely because SQLite has no
  matching authority event.
- Exact cache lookup uses repository/worktree plus manifest digest. Stored row columns,
  manifest digest, cursor digest, projection digest, scope, and compiler/view identity
  verify before return. Invalid rows are misses or explicit corruption errors, never hits.
- Delta may compare different exact manifests only when their compatibility digests
  match; full-manifest equality is not required because graph/evidence state must change.
- Git-visible `.archcontext/` remains product authority. Cache remains disposable and
  contains no raw source/diff/prompt/completion/CodeGraph body or secret material.

## Stop Conditions

- Required inputs can be replaced with synthesized empty values.
- Cache lookup still depends on latest view or projection digest for an exact-hit path.
- Full manifest equality is used as Delta compatibility and prevents real base/head
  architecture changes from being compared.

## Exit Criteria

```yaml
exit_criteria:
  files_exist:
    - docs/verification/data-engine-de3-readback.json
  commands_succeed:
    - bun run typecheck
    - bun test packages/contracts/test/contracts.test.ts packages/local-runtime/local-store-sqlite packages/local-runtime/runtime-daemon
    - bun run record:de3:data-engine
    - bun run readback:de3:data-engine
    - bun run verify:explorer
    - bun run verify
  manual_checks:
    - "Each view exposes one canonical required optional and not-used domain policy, including authority and evidence"
    - "Required missing/unavailable/mismatched domains fail before cache or compile"
    - "Exact repeated input returns the manifest-addressed cached projection"
    - "Cross-worktree stale-task and corrupted manifest rows never hit cache"
    - "Delta compares compatible base/head manifests while retaining exact pairing"
```

## Rollback Point

- Checkpoint: DE3 commit after DE2 commit `d28fae1`.
- Revert strategy: revert the DE3 checkpoint and delete/rebuild disposable projection
  cache rows; never edit authoritative events, snapshots, or Git-visible model files.
