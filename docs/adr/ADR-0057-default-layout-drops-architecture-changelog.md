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
3. `docs/architecture/changelog.md` joins the `default` profile's `retiredTargetPaths`
   (`layout.ts:165`, empty for `default` today). The existing orphan rule decides its fate
   (`index.ts:2699-2709`, `orphanHoldsOnlyIntactGeneratedRegion` at `index.ts:2794`):
   - a changelog that holds only its intact generated region is deleted;
   - a changelog with any human text is `human-review`: the apply refuses with
     `projection-orphan-review-required`, and a human removes the file.

   Today a retired path is read only when a current-format committed manifest records it
   (`layout.ts:221-227`). Every `default` repository reaches 0.14.0 with a v3 manifest, which the
   ADR-0056 §11 re-baseline treats as absent, so adding the path alone leaves the file unread and
   unmanaged. Slice E therefore reads a `default` retired path that exists on disk whatever the
   manifest records, and keeps `changelog.md` in the managed Markdown paths (`index.ts:2848-2853`)
   so the marker scan finds its region.

## Consequences

- A `default` repository's next apply deletes its placeholder changelog and drops the index link.
  A changelog that a human edited stops the apply until someone reviews and removes it.
- Removing the target type is a breaking change to `@archcontext/contracts` and the runtime
  schemas. A manifest or target file that names `architecture-changelog` no longer validates. The
  0.14.0 release notes list the break.
- The ledger's accepted events stay readable through `archctx book timeline`, which reads the local
  ledger and commits nothing.
- A future changelog needs a Git-visible source and its own ADR.
