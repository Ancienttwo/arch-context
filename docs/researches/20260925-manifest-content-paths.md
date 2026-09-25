# Manifest content-path correction — issue #171

Baseline: `901e4b8`.

The manifest's declared ADR location was `.archcontext/decisions`, but the active ADR loader `loadArchitectureDecisionRecords` reads `docs/adr`. The initializer's default manifest now declares `docs/adr`; the loader and existing ADR files remain the same authority.

This repository's existing manifest still declares the old location. A normal daemon `planUpdate`/`applyUpdate` attempt rejected `.archcontext/manifest.yaml` as outside the ChangeSet write allowlist. This slice preserves that boundary. Correcting existing manifests requires a separately defined configuration mutation path; this PR does not claim the corresponding #171 item fully resolved.

The practices entry has different semantics: `.archcontext/practices` is an optional repository overlay. `loadRepoOverlayAssets` returns an empty overlay when it does not exist. Built-in practices come from `packages/core/practice-catalog/assets/practices`, selected by `BUILTIN_PRACTICE_ASSETS_DIR`. Pointing the overlay entry at those built-ins or adding placeholder data would misrepresent that boundary. An absent overlay directory is valid and remains absent here.

Likewise, an initialized project may have no ADRs yet; the loader returns no records until `docs/adr` exists. These paths declare content locations, not required nonempty directories. This correction does not introduce configurable directory routing or change the fixed loaders. `tsconfig.json` already has no `apps/**` include at this baseline.

Validation: the existing model-store, ADR projection and practice-catalog tests pass (42 tests, 160 assertions), and typecheck passes. A temporary initialized project declared `docs/adr`; the ADR loader read a record written there, and the catalog loaded without errors while the repository overlay remained absent. There is no persistence-layout migration or write-path change. At larger repository size, the existing ADR/overlay directory scans remain the cost.
