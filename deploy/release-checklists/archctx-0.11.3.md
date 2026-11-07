# archctx / archctx-contracts 0.11.3

Baseline: `origin/main@ae4dc766`, the merge of #483.
Published from the merged release-candidate commit `7c25d63b`, the merge of #485. Both registry versions went live on 2026-11-04T10:34Z; the tag and GitHub Release were created on 2026-11-07 after the readback below.

## Changes

- #476 / #477: repository only. Keep Governance Verify focused on full Verify and retire 20 inspection-only readback scripts. No product behavior change.
- #481 / #482: repository only. Delete 45 readback scripts with no live callers, their tests and aliases. No product behavior change.
- #480 / #483: repository only. Add `docs/runbooks/npm-release.md` for the npm publication procedure. No product behavior change.

## Compatibility

Version 0.11.3 is a patch release carrying the 0.11.2 product code. Upgrade `archctx` and `archctx-contracts` together. Reason codes, the projection manifest schema, both projection profiles, RPC v2 and the SQLite migrations are unchanged.

## Evidence and remaining gates

- [x] Version authorities synchronized across the root and package manifests, `product-version.ts`, the contracts fixtures, the practice catalog manifest (`catalogDigest` regenerated from `loadPracticeCatalog`), the review action default, and the example workflows.
- [x] Hosted Verify, including Governance Verify, passed on the merged changes' PR heads: `97ee7d42` (#477), `46f88a12` (#482), `0af9409a` (#483).
- [x] Release-candidate PR head: hosted full/matrix Verify before merge. Governance Verify produces the deterministic readback evidence in its run.
- [x] Rebuild both package tarballs from accepted main and read back version, contents and digests.
- [x] Publish interactively with npm web authentication; wait for both registry versions and read back version, dist-tag and integrity.
- [x] Create the tag and GitHub Release only for the published commit.

## Publication record

- Published commit: `7c25d63b92677307e886734c3626d960d37b7bb4` (merge of #485). Hosted Verify on it: 30 check runs, none failed or cancelled.
- The annotated tag `v0.11.3` sits on that commit, and the GitHub Release `v0.11.3` resolves to the same SHA.
- Registry: `archctx@0.11.3` shasum `53e880e032242f952d8b44fd790417cfe45d564d`, `archctx-contracts@0.11.3` shasum `ac4a81c1929a87bf2887ab24792e5c3d82dd96ec`; both dist-tags are `latest`.
- Provenance: both shasums match the `fg6-npm-release-dry-run` record built on `7c25d63b`, so the published archives provably came from that commit.
- Release assets: both `.tgz` files plus `SHA256SUMS` are attached, and a download of the release verifies against that manifest.
- Clean-room install of `archctx@0.11.3` reports version 0.11.3.

Publication procedure: `docs/runbooks/npm-release.md`.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publication is a separate step: publish interactively, wait for both registry versions, and read back version/dist-tag/integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Reverting a candidate before publication restores the prior code and version authorities. This version is published: versions are immutable and a fix requires a new corrective version.
