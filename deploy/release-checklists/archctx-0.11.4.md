# archctx / archctx-contracts 0.11.4 preparation

Baseline: `origin/main@522a960f`, the merge of #496.
This records a release candidate, not publication. Both registry latest versions were read back as 0.11.3 during preparation on 2026-11-07.

## Changes

- **#479 / #486: an optional public output field.** `archctx constraints check --json` now returns `data.layerEdges` for a `layer-direction` constraint: one row per `(constraintId, fromLayer, toLayer)` counting resolved imports. Documented in `docs/runbooks/ordered-layers.md`. This is the only shipped-surface behavior change in the release.
- **#494 / #496: repository only.** `schemas/runtime/dependency-constraint-evaluation.schema.json` describes the whole evaluation output, including the `layerEdges` absence contract. No behavior change.
- **#492 / #495: CI only.** Hosted receipts re-read a nonterminal job within a bounded budget instead of persisting a mid-flight snapshot as a settled verdict. No product behavior change.
- **#489 / #490 / #491: tests only.** The projection-writer suite splits two fixtures and budgets every test by platform, so Windows stops failing it near its deadline. No product behavior change.
- **#487, #488, #478: repository only.** `docs/approvals` removed, and ADR-0053 accepted to retire the GitHub App governance bridge. No product behavior change.

## Compatibility

Version 0.11.4 carries the 0.11.3 product code plus the additive `layerEdges` field. Upgrade `archctx` and `archctx-contracts` together. Reason codes, the projection manifest schema, both projection profiles, RPC v2 and the SQLite migrations are unchanged. `layerEdges` is optional and present only under the documented conditions, so a consumer that ignores it is unaffected. CodeGraph stays at 1.6.2, Bun at 1.4.3, and Node at `>=22.22 <26`.

## New in the published payload

`schemas/runtime/dependency-constraint-evaluation.schema.json` is new in this release and reaches users inside the `archctx` tarball: the root package has no `files` allowlist, so the whole `schemas/runtime/` tree ships (the 0.11.1 tarball already carries 56 files there). It is not in `RELEASE_SCHEMA_FILES` in `scripts/fg6-npm-release-dry-run.ts`, which lists only schemas that the dry run validates directly; that list is not an allowlist for packaging. Readback should confirm the new file is present in the built tarball rather than assume it.

## Evidence and remaining gates

- [x] Version authorities synchronized across the root and package manifests, `product-version.ts`, the contracts fixtures, the practice catalog manifest (`catalogDigest` regenerated from `loadPracticeCatalog`), the review action default, and the example workflows.
- [ ] Release-candidate PR head: hosted full/matrix Verify before merge. Governance Verify produces the deterministic readback evidence in its run.
- [ ] Rebuild both package tarballs from accepted main and read back version, contents and digests, including the new schema file.
- [ ] Publish interactively with npm web authentication; wait for both registry versions and read back version, dist-tag and integrity.
- [ ] Create the tag and GitHub Release only for the published commit.

Publication procedure: `docs/runbooks/npm-release.md`.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publication is a separate step: publish interactively, wait for both registry versions, and read back version/dist-tag/integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Reverting the candidate before publication restores the prior code and version authorities. Published versions are immutable and require a new corrective version.

## Version number note

`0.12.0` is reserved by accepted ADR-0053 for the governance removal (rollout step 3). 0.11.4 stays below it so that reservation still holds. The release notes for 0.11.4 must not use the "no product behavior change" wording 0.11.2 and 0.11.3 used, because this release adds a public output field.
