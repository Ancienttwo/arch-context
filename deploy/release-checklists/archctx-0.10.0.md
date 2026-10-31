# archctx / archctx-contracts 0.10.0 preparation

Baseline: `origin/main@81104126ed8083eba54676ba0dc5904ba100e32b`.
This records a release candidate, not publication. Both registry latest versions were read back as 0.9.4 during preparation.

## Changes

- Earlier accepted main changes since 0.9.4 include the RPC optional-argument default restoration (#423/#424), structured upgrade diagnostics for superseded projection manifests (#427/#428), the readiness probe skipping a live CodeGraph build (#426/#429), and typed classification of not-ready code facts in `projection run` (#425/#430).
- #432: the repository deletes its local plan/task workflow; task state lives only in GitHub issues and pull requests, and the root rules carry only invariants, the `repo-harness-issue-flow` line and the archimap entry. Product code unchanged.
- #433: **public output change.** Under the `repo-harness/v1` profile the documentation projection emits capability (entity) documents, the ADR-0049 runtime topology pair when the model has topology nodes, and the manifest only. `architecture-index`, `architecture-changelog`, `decision-index`, `diagram-mermaid`, `diagram-likec4` and `diagram-structurizr` are no longer generated for that profile. `default` output is unchanged. `docs apply` deletes an intact retired file with its manifest row; a retired file carrying human edits refuses with `AC_PRECONDITION_FAILED` / `projection-orphan-review-required` and stays, listed by `docs drift` as `human-review`.

## Compatibility

Version 0.10.0 is a minor release. Upgrade `archctx` and `archctx-contracts` together.

- Migration for repositories on the `repo-harness/v1` profile: the first `archctx docs apply --approved --profile repo-harness/v1` after upgrading removes the six retired whole-model files when their bytes still match the manifest row; a hand-edited file stops the apply and must be resolved by moving the human text or restoring the projection bytes. Nothing is written by `docs plan` or `docs drift`.
- Topology nodes keep their only projection, the runtime topology pair (ADR-0049 unchanged).
- A superseded v2 tree under `repo-harness/v1` with no topology nodes has no current generated target, so the old re-baseline path cannot name its v5-wrapped diagram files automatically; the operator removes them during the documented 0.7.x migration.
- `default` profile output is byte-identical to 0.9.4. RPC remains v2. There is no SQLite migration and no architecture authority promotion.

## Evidence and remaining gates

- [x] Version authorities synchronized across the root and package manifests, `product-version.ts`, the contracts fixtures, the practice catalog manifest (regenerated from its producer, `catalogDigest` updated), the review action default, and the example workflows.
- [x] `bun run typecheck` exits 0 on the candidate.
- [x] Practice catalog tests: 10 passed. Contracts, `version-usage` and release-provenance tests: 267 passed.
- [x] Hosted Verify on every merged change before this candidate: `22fe8211` (#424), `a5c05aa3`/its successor run (#428), `e074eefa` (#429), `51e6f134` (#430), `7c490631` (#435), `81104126` (#436).
- [ ] Release-candidate PR head: hosted full/matrix Verify before merge.
- [ ] Rebuild both package tarballs from accepted main and read back version, contents and digests.
- [ ] Publish interactively with npm web authentication; wait for both registry versions and read back version, dist-tag and integrity.
- [ ] Create the tag and GitHub Release only for the published commit.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publication is a separate step: when authorized, publish interactively, wait for both registry versions, and read back version/dist-tag/integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Reverting the candidate before publication restores the prior code and version authorities. Published versions are immutable and require a new corrective version.
