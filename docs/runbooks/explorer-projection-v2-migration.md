# Explorer Projection v2 Migration

> **Status**: Complete — V1 runtime and public contract removed
> **Started**: 2026-07-11
> **Removal boundary**: remove `ExplorerProjection/v1` before `archctx` `0.3.0`
> **Decision**: `docs/adr/ADR-0044-authority-aware-explorer-view-compiler.md`

## Migration outcome

EV0 introduced the additive contract. EV1–EV4 completed the consumer cutover and
removed the bounded coexistence path in the same Sprint. There is no remaining
runtime, RPC, HTTP, CLI, HTML, TypeScript, schema, or fixture consumer of
`ExplorerProjection/v1`.

## Consumer inventory

| Consumer | Completed V2 state | Evidence |
|---|---|---|---|
| Public TypeScript + JSON Schema | V2 query/projection/inspector/backlink/delta only | contracts tests |
| Runtime daemon | `compileExplorerProjection` and digest-addressed cache | runtime tests |
| Runtime RPC | `explorerProjectionV2` + `explorerProjectionDelta` | RPC/CLI tests |
| HTTP | `/projection/v2`, `/delta`, `/events`; V1 routes return 404 | Explorer integration test |
| CLI | `archctx explore projection` returns V2; `delta` compares cached digests | CLI tests and packaged smoke |
| Explorer HTML | V2 semantic level/view/focus/expand/Inspector reader | Explorer UI tests |
| Package/release | migration `0012`, V2 schemas, packaged V2 smoke | full `bun run verify` |

## Final surface

- Runtime RPC methods: `explorerProjectionV2`, `explorerProjectionDelta`.
- CLI readback: `archctx explore projection` and `archctx explore delta`.
- Token-authenticated HTTP readback: `GET /projection/v2`.
- Token-authenticated invalidation: `GET /events` (digest-only SSE).
- Token-authenticated delta: `GET /delta` with explicit base/head digests.
- V1 `/projection`, `/search`, RPC, CLI subcommand, renderer types, schemas, and
  fixtures have been deleted.

## Removal gates

V1 may be deleted only when all are true:

- [x] EV1 HTML reads V2 with bounded focus/expand queries.
- [x] CLI default `explore projection` returns V2.
- [x] HTTP V1 `/projection` and `/search` routes are absent.
- [x] RPC/client inventory reports no V1 callers.
- [x] Packaged CLI, schema, privacy, scale, and Explorer security tests pass without V1.
- [x] This runbook records the pre-1.0 breaking contract removal.

`bun run verify:explorer` is the release gate: it fails on runtime V1 references,
budget overruns, p95 regression, or forbidden private fields.

## Rollback

Rollback is a branch revert. Migration `0012_explorer_projection_index` creates
only rebuildable cache/index tables; `clearExplorerDerivedState` can delete their
contents. Rollback does not edit `.archcontext/` truth or ledger authority state.
