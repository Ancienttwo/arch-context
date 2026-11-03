# archctx / archctx-contracts 0.11.2 preparation

Baseline: `origin/main@c49c3ca6`, the merge of #472.
This records a release candidate, not publication. Both registry latest versions were read back as 0.11.1 during preparation.

## Changes

- #458 / #459: tests only. Disable Git auto-maintenance in committing fixtures. No product behavior change.
- #460 / #464: tests only. Build repeated fixture state once per file in the four slowest CLI suites. No product behavior change.
- #465 / #466: tests only. Drive the adopted scenario per caller again. No product behavior change.
- #461 / #463: repository only. Record ADR-0052 for the Governance composite verification receipt. No product behavior change.
- #468 / #469: repository only. Retire closed evidence gates. No product behavior change.
- #470 / #473: repository only. Generate deterministic readbacks at runtime. No product behavior change.
- #471 / #472: repository only. Clarify evidence cleanup rules. No product behavior change.
- #462 / #467: CI only. Split the Linux full worker and accept the composite receipt. No product behavior change.

## Compatibility

Version 0.11.2 is a patch release carrying the 0.11.1 product code. Upgrade `archctx` and `archctx-contracts` together. Reason codes, the projection manifest schema, both projection profiles, RPC v2 and the SQLite migrations are unchanged.

## Evidence and remaining gates

- [x] Version authorities synchronized across the root and package manifests, `product-version.ts`, the contracts fixtures, the practice catalog manifest (`catalogDigest` regenerated from `loadPracticeCatalog`), the review action default, and the example workflows.
- [x] Hosted Verify passed on the merged changes' PR heads: `954396ad` (#459), `21caaff1` (#464), `2b82d0f7` (#466), `da06ec1a` (#463), `6077069e` (#469), `0e26d8c1` (#473), `5a44aa1e` (#472), `314e93a6` (#467).
- [ ] Release-candidate PR head: hosted full/matrix Verify before merge. Governance Verify produces the deterministic readback evidence in its run.
- [ ] Rebuild both package tarballs from accepted main and read back version, contents and digests.
- [ ] Publish interactively with npm web authentication; wait for both registry versions and read back version, dist-tag and integrity.
- [ ] Create the tag and GitHub Release only for the published commit.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publication is a separate step: publish interactively, wait for both registry versions, and read back version/dist-tag/integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Reverting the candidate before publication restores the prior code and version authorities. Published versions are immutable and require a new corrective version.
