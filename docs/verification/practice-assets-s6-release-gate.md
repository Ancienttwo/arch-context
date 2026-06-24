# Practice Assets S6 Release Gate

## Status

This document is the S6 release-gate evidence ledger. The catalog-scale gate is
verified; the broader S6 eval, performance, packaging, cross-platform, docs,
rollout, and release gates remain pending.

## Catalog Scale Gate

### P1 Map

The catalog-scale boundary is the built-in static practice catalog, not repo
overlays or dynamic documentation.

- Asset loader: `packages/core/practice-catalog/src/index.ts`
- Practice assets: `packages/core/practice-catalog/assets/practices/`
- Profile assets: `packages/core/practice-catalog/assets/profiles/`
- Source registry: `packages/core/practice-catalog/assets/sources/`
- Static manifest: `packages/core/practice-catalog/assets/catalog.yaml`
- CLI validation surface: `archctx practices validate --strict`
- Release readback surface:
  `scripts/practice-assets-s6-catalog-readback.ts` and
  `docs/verification/practice-assets-s6-catalog-readback.json`

Out of scope for this slice: expanding the eval dataset to 120 scenarios,
performance gates, packaged product OS matrix, rollout flags, and final release
signoff.

### P2 Trace

The verified path is:

1. `loadPracticeCatalog({ includeRepoOverlay: false })` reads built-in
   practices, profiles, and source records.
2. Practice source refs are validated against the source registry.
3. Built-in profile include refs are validated against the built-in asset
   registry. This preserves repo overlay disable semantics while still catching
   broken profile definitions in the shipped catalog.
4. The loader computes deterministic asset digests, source IDs, manifest
   entries, and the catalog digest.
5. `packages/core/practice-catalog/assets/catalog.yaml` is compared byte-shape
   against the generated manifest.
6. `scripts/practice-assets-s6-catalog-readback.ts` records and inspects the
   catalog gate packet. The inspector rejects undersized catalogs, missing
   category negative scope, missing profiles, missing required sources,
   reference-only source use, provenance gaps, unsuperseded deprecated assets,
   and stale static manifests.

The output side effect is
`docs/verification/practice-assets-s6-catalog-readback.json`, which records 41
total practices, 40 active practices, 8 profiles, 19 source records, at least 4
active practices in each category, zero provenance gaps, and a static manifest
match.

### P3 Decision

The current catalog loader exists as a deterministic static asset path with repo
overlays layered later. The S6 change keeps that invariant: the shipped catalog
can grow and gain profiles without allowing repo overlays to invalidate built-in
profile definitions. New practice matches default to declared evidence for
recommendation, which keeps scale growth from crowding existing heuristic eval
results.

At 10x scale, the first failure point would be unreviewed catalog growth or a
stale generated manifest. The chosen gate makes those failures deterministic:
counts, category coverage, source license posture, provenance completeness,
deprecation lineage, and manifest freshness all fail closed before release.

## Source Pinning

- Required built-in source records are present for MADR, Backstage, ArchUnit,
  Structurizr DSL, Twelve-Factor, OpenTelemetry, Kubernetes, and OpenSSF.
- Structurizr DSL is pinned as `LicenseRef-Structurizr-Docs`, level B,
  built-in with attribution.
- Twelve-Factor is pinned from `https://github.com/heroku/12factor` as MIT,
  level A, built-in with attribution.
- Kubernetes documentation is pinned from
  `https://github.com/kubernetes/website` as CC-BY-4.0, level B, built-in with
  attribution.
- OWASP Cheat Sheet Series and arc42 are retained as reference-only
  ShareAlike sources. No built-in practice references them.

## Verified Commands

- `bun test packages/core/practice-catalog/test/practice-catalog.test.ts`
- `bun test scripts/practice-assets-s6-catalog-readback.test.ts`
- `bun run record:s6:catalog`
- `bun run readback:s6:catalog`
- `bun packages/surfaces/cli/src/main.ts practices validate --strict`
- `bun run verify:practices`
- `bun evals/run.ts --check`
- `bun run typecheck`
- `git diff --check`
- `bun run verify`

## Pending S6 Gates

- Eval dataset expansion: S6-08 through S6-14.
- Quality targets beyond the current representative eval: S6-15 through S6-22.
- Performance and reliability gates: S6-23 through S6-28.
- Packaging and cross-platform gates: S6-29 through S6-33.
- Documentation, operations, rollout, and final release signoff: S6-34 through
  S6-40 and S6-EG1 through S6-EG7.
