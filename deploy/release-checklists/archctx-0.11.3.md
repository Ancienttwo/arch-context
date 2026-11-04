# archctx / archctx-contracts 0.11.3 preparation

Baseline: `origin/main@ae4dc766`, the merge of #483.
This records a release candidate, not publication. Both registry latest versions were read back as 0.11.2 during preparation on 2026-11-04.

## Changes

- #476 / #477: repository only. Keep Governance Verify focused on full Verify and retire 20 inspection-only readback scripts. No product behavior change.
- #481 / #482: repository only. Delete 45 readback scripts with no live callers, their tests and aliases. No product behavior change.
- #480 / #483: repository only. Add `docs/runbooks/npm-release.md` for the npm publication procedure. No product behavior change.

## Compatibility

Version 0.11.3 is a patch release carrying the 0.11.2 product code. Upgrade `archctx` and `archctx-contracts` together. Reason codes, the projection manifest schema, both projection profiles, RPC v2 and the SQLite migrations are unchanged.

## Evidence and remaining gates

- [x] Version authorities synchronized across the root and package manifests, `product-version.ts`, the contracts fixtures, the practice catalog manifest (`catalogDigest` regenerated from `loadPracticeCatalog`), the review action default, and the example workflows.
- [x] Hosted Verify, including Governance Verify, passed on the merged changes' PR heads: `97ee7d42` (#477), `46f88a12` (#482), `0af9409a` (#483).
- [ ] Release-candidate PR head: hosted full/matrix Verify before merge. Governance Verify produces the deterministic readback evidence in its run.
- [ ] Rebuild both package tarballs from accepted main and read back version, contents and digests.
- [ ] Publish interactively with npm web authentication; wait for both registry versions and read back version, dist-tag and integrity.
- [ ] Create the tag and GitHub Release only for the published commit.

Publication procedure: `docs/runbooks/npm-release.md`.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publication is a separate step: publish interactively, wait for both registry versions, and read back version/dist-tag/integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Reverting the candidate before publication restores the prior code and version authorities. Published versions are immutable and require a new corrective version.
