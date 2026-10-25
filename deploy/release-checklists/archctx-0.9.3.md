# archctx / archctx-contracts 0.9.3 release preparation

Prepared from `main@43c007e38bcd2a8099ee8c92b61ecabf69ff1d4a` after merging
[#405](https://github.com/Ancienttwo/arch-context/pull/405). Its exact head
`7733a75088416e2a58e53d85f07989aee7728acc` passed hosted Verify before merge.
This checklist records preparation, not publication.

## Changes since 0.9.2

- Topology nodes' existing `source.include` anchors now stamp both runtime-topology
  projection rows. Config changes invalidate those stamps without requiring changed
  rendered diagram bytes. Namespace anchors no longer fail with
  `projection-footprint-uncovered`.
- The runtime topology summary shows source anchors and identifies nodes without them.
- `check:architecture-mermaid` parses the repository's architecture diagrams in CI.
  Its optional render page uses a local pinned Mermaid bundle. Mermaid and linkedom
  are development dependencies; neither becomes a published runtime dependency.
- #404 reduces duplicate CI verification and limits Node 24/25 to compatibility checks.

## Compatibility and rollback

Upgrade `archctx` and `archctx-contracts` together. 0.9.2 rejects manifests containing
topology source stamps, so all readers must upgrade before anchored topology output is
committed. Manifests without topology anchors retain their existing contract. Runtime
RPC remains v2. #402 phase 2 owner acceptance remains separate from this release.

Before publication, revert the release preparation commit to restore version 0.9.2.
Rolling back #405 after adopting stamped topology requires removing the topology source
anchors through the supported model mutation flow and regenerating projections with the
matching version. Do not hand-edit generated manifests. Published npm versions are
immutable; any post-publication repair requires a new version.

## Version authorities

Root and five workspace manifests, lockfile workspace versions, product-version constant,
valid capabilities/version fixtures, action default and example workflow pins are 0.9.3.
The practice catalog and FG4/FG6 deterministic records are regenerated from their source
authorities. Historical release evidence remains unchanged.

## Preparation evidence

- [x] Frozen dependency install and `bun run typecheck`.
- [x] Contracts, practice-catalog and FG4/FG6 readback tests: 521 passed, 0 failed,
  3388 assertions across 14 files.
- [x] FG4 deterministic conclusion and FG6 no-provider readbacks passed.
- [x] Both packages pass `fg6-npm-release-dry-run`; no failures.
  Local evidence: `/Volumes/D/archctx-093-release/npm-dry-run.json`.
- [x] Installed product tarball smoke passed, including lifecycle/uninstall checks.
  Local evidence: `/Volumes/D/archctx-093-release/tarball-smoke.json`.
- [ ] Both npm preflights are blocked: `npm identity unavailable: npm error code E401`.
  Restore npm authentication before publication; no publish was attempted.
- [ ] Hosted Verify passes on the release PR's exact head.

## Publication gates

- [ ] Merge the release PR after hosted checks pass, then verify merged main.
- [ ] Rebuild both packages from the published main commit using
  `bun scripts/fg6-npm-release-dry-run.ts run --out /Volumes/D/archctx-093-release/npm-dry-run.json --artifact-dir /Volumes/D/archctx-093-release/artifacts --json`.
- [ ] Run `node scripts/local-product-tarball-smoke.mjs --out /Volumes/D/archctx-093-release/tarball-smoke.json`.
- [ ] Run contracts preflight and archctx preflight with the rebuilt tarball path.
- [ ] With publication authorization, publish contracts then archctx in an interactive
  terminal. Use npm web authentication when offered. If npm accepts an upload and reports
  processing, wait for registry visibility rather than uploading that version again.
- [ ] Read back both registry versions, shasums and integrities and compare staged artifacts.
- [ ] Tag `v0.9.3` at the published main commit and create the GitHub Release with both
  tarballs and SHA256SUMS; download and verify the release assets.
- [ ] Downstream consumers upgrade their exact pins in separate changes before authoring
  anchored topology manifests.
