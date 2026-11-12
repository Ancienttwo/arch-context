---
schemaVersion: archcontext.adr/v1
id: adr.0057.default-layout-drops-architecture-changelog
title: The Default Layout Drops the Architecture Changelog Target
status: accepted
decidedAt: 2026-11-11
appliesTo:
  - module.architecture-context.contracts
  - component.architecture-context.projection-renderer
  - module.architecture-context.local-runtime
supersedes: []
---

# ADR-0057: The Default Layout Drops the Architecture Changelog Target

> **Status**: Accepted on [#540](https://github.com/Ancienttwo/arch-context/issues/540) on 2026-11-11 by joint decision of the orchestrator and the advisor (https://github.com/Ancienttwo/arch-context/issues/540#issuecomment-6799946215), under the owner's release instruction recorded at https://github.com/Ancienttwo/arch-context/issues/541#issuecomment-6799854742.
> **Amends**: the [ADR-0056](ADR-0056-render-equivalent-freshness-history-target.md) non-goal "The `default` layout does not change". The `default` layout still gains neither the history target nor agent-context rows; it loses the `architecture-changelog` target.
> **Implementation**: slice E of [#541](https://github.com/Ancienttwo/arch-context/issues/541), released in 0.14.0.

## Context

Line references are to main at `c543dd58`.

The `default` profile renders `docs/architecture/changelog.md` as a `mixed` target
(`packages/core/projection-engine/src/layout.ts:54`, placed by the default branch at
`layout.ts:158`). The engine renders it from `input.timeline`
(`packages/core/projection-engine/src/index.ts:2225`, `renderArchitectureChangelog` at
`index.ts:2541`), which defaults to `[]` (`index.ts:464`). No production caller passes a timeline,
so every committed changelog holds only the line "No accepted architecture ledger events selected
for this projection."

The only intended source of that timeline is the ledger's accepted events. The ledger is
operational runtime state, not Git-visible authority ([ADR-0040](ADR-0040-hybrid-architecture-ledger.md),
[ADR-0050](ADR-0050-architecture-ledger-authority-matrix.md)). A committed document rendered from it
would differ by machine, and `check` and `complete` would report drift on a clean tree whenever two
ledgers disagree.

`repo-harness/v1` already retires the target (`layout.ts:165`) and gets
`docs/architecture/history.md` from Git history instead (ADR-0056 §8). Neither `docs/spec.md` nor
any ADR promises changelog content.

## Decision

1. The `default` layout no longer renders `architecture-changelog`. The target leaves
   `FIXED_TARGETS` (`layout.ts:54`), the index link (`index.ts:2269`), the `model-store-yaml`
   default placement rule (`packages/local-runtime/model-store-yaml/src/index.ts:101-108`) and this
   repository's `.archcontext/projections/targets.json:51-59`.
2. The target type is removed with no alias: from `ProjectionTargetType`
   (`packages/contracts/src/ledger.ts:149`), the manifest's `TARGET_TYPES`
   (`packages/contracts/src/projection-manifest.ts:158`) and the enums in
   `schemas/runtime/projection-manifest.schema.json:230` and
   `schemas/runtime/projection-target.schema.json:16`. The renderer and the timeline input go with
   it.
3. `docs/architecture/changelog.md` is retired only by the ADR-0056 §11 re-baseline: the
   operator-invoked `archctx docs apply --approved` on a superseded manifest, which fails closed.
   The path joins the `default` profile's `retiredTargetPaths` (`layout.ts:165`, empty for
   `default` today) for that run.

   No ordinary run can find the file. Once the target leaves the layout, the path is outside the
   expected paths and the orphan roots (`modules/` and `relations/`, `layout.ts:166`), and a
   retired path is read back only when a current-format committed manifest records it
   (`layout.ts:221-227`). Every `default` repository reaches 0.14.0 with a v3 manifest, which the
   re-baseline treats as absent.

   - **Loading.** The inputs are loaded before the re-baseline option takes effect: the option is
     set at `packages/local-runtime/runtime-daemon/src/projection-service.ts:38` and reaches only
     the render, while the existing files are loaded at `projection-service.ts:245` through
     `loadArchitectureDocumentationInputs` (`index.ts:1071`). Slice E passes the migration context
     to that loading boundary. The boundary reads the retired path from disk only when the command
     is the approved apply and the committed manifest is superseded.
   - **Disposition.** The re-baseline deletes the changelog only when the whole file is its one
     generated region, the region digests to its marker's `outputDigest`, and the region body is
     the empty-state render ("No accepted architecture ledger events selected for this
     projection."). Anything else is `human-review`, reported once in the re-baseline's result:
     human text, a missing or unparseable marker, or a digest mismatch. The apply then refuses with
     `projection-orphan-review-required`, and a human removes the file. Today's orphan rule
     (`index.ts:2699-2709`) skips a file in which it finds no generated region, so slice E adds
     this classification rather than reusing that rule.
   - **After the re-baseline.** The v4 manifest is the only authority. It records no changelog row,
     so a file created at that path later is not projection-owned, and no run reads, deletes or
     reports it.

## Consequences

- The 0.14.0 re-baseline of a `default` repository deletes its placeholder changelog and drops the
  index link. Any other changelog stops the re-baseline until a human reviews and removes it.
- Removing the target type is a breaking change to `@archcontext/contracts` and the runtime
  schemas. A manifest or target file that names `architecture-changelog` no longer validates. The
  0.14.0 release notes list the break.
- The ledger's accepted events stay readable through `archctx book timeline`, which reads the local
  ledger and commits nothing.
- A future changelog needs a Git-visible source and its own ADR.
