# archctx / archctx-contracts 0.12.0 preparation

Baseline: `origin/main@57dc8f4f`, the merge of #503.
Published from the merged release-candidate commit `478fc5c1`, the merge of #505. Both registry versions went live on 2026-11-09. The tag and GitHub Release were created the same day, after the readback below.

## Changes

- **#499, #501, #502: breaking removal.** ADR-0053 retires the GitHub App governance bridge: Developer Review, Organization Runner, the hosted Review Challenge, attestation verification and Check delivery. Rollout step 3 lands in this release. The breaking surfaces are listed under Release notes.
- **#503: generated docs only.** The rolling projection writer regenerated `docs/architecture/` without the retired components. No behavior change.

## Release notes

Use this section as the GitHub Release notes file.

> **archctx / archctx-contracts 0.12.0 removes the GitHub App governance bridge (ADR-0053).** Architecture review runs locally. ArchContext no longer publishes a Check to pull requests.
>
> Breaking changes:
>
> - `archctx github status`, `connect`, `disconnect`, `review` and `verify-head` are removed. `github connect` already failed closed with `AC_CAPABILITY_UNSUPPORTED`, so no working integration breaks.
> - RPC v2 drops the `developerReview.*` methods.
> - `archctx-contracts` drops the governance exports: everything from `github-governance` (Review Challenge, attestation, Check delivery, device and runner identity, governance feature flags), `CONTROL_PLANE_ROUTES` and `controlPlaneRouteDigest`. It also drops the `developer-review-*` failure policies, `AC_ATTESTATION_REJECTED`, `CloudMetadataPort.submitAttestation`, `ReviewCheckoutGitPort` and `DetachedReviewWorktreeVerification`.
> - The product version manifest drops the `reviewChallenge`, `attestation`, `deviceIdentity` and `runnerIdentity` schema pins.
> - Eight schemas under `schemas/cloud/` are removed: `attestation`, `attestation-v2`, `review-challenge-v2`, `check-delivery`, `device-identity`, `governance-key-status`, `runner-identity` and `org-runner-identity`.
> - `archctx doctor` no longer reports `hardening.privacyRouteDigest` or `hardening.secureDefaults.githubContentsPermission`.
> - `actions/review-action` and the Organization Runner reusable workflow are removed. Neither was ever published.
>
> Unchanged: the local review guard against caller-provided attestation fields in `complete-task` (CLI, RPC and MCP) is kept, as are `CloudEgressEnvelope` and `schemas/cloud/cloud-egress-envelope.schema.json`.
>
> The npm `homepage` and the packaged README now point at https://github.com/Ancienttwo/arch-context.

## Compatibility

Upgrade `archctx` and `archctx-contracts` together. A consumer of any removed export, RPC method or CLI command must drop it. No external consumer was found (ADR-0053).

Unchanged: the reason codes of kept surfaces, the projection manifest schema, both projection profiles, the remaining RPC v2 methods and the SQLite migrations. CodeGraph stays at 1.6.2, Bun at 1.4.3, and Node at `>=22.22 <26`.

## Removed from the published payload

The `archctx` tarball ships the whole `schemas/` tree, because the root package has no `files` allowlist. The tree goes from 85 files in 0.11.4 to 77: the eight `schemas/cloud/` files above are removed, and `schemas/runtime/product-version-manifest.schema.json` changes. `RELEASE_SCHEMA_FILES` in `scripts/fg6-npm-release-dry-run.ts` lists only practice schemas and is not affected. Readback should confirm that the eight files are absent from the built tarball, not assume it.

## Evidence and remaining gates

- [x] Version authorities synchronized: the root and package manifests, `bun.lock`, `product-version.ts`, the contracts fixtures (`archctx-capabilities`, `product-version-manifest`) and the practice catalog manifest. `catalogDigest` was regenerated from `loadPracticeCatalog`.
- [x] Release-candidate PR head: hosted full/matrix Verify passed before merge (35 check runs, including all three Windows shards).
- [x] Owner rollout step 2: the `archcontext-staging` App posted one check run on the #496 and #499 heads, and none on the #501, #502 or #503 heads. ADR-0053's FG2 evidence records this repository as its only installation. The owner authorized publication on that basis.
- [x] Rebuild both package tarballs from accepted main, and read back the version, the contents (including the absence of the eight schemas) and the digests.
- [x] Publish interactively with npm web authentication. Wait for both registry versions, then read back version, dist-tag and integrity.
- [x] Create the tag and GitHub Release only for the published commit, using the Release notes above.

## Publication record

- Published commit: `478fc5c10247a3c531b7a31f3eb7377c22145dae`, the merge of #505.
- The annotated tag `v0.12.0` sits on that commit, and the GitHub Release `v0.12.0` resolves to the same SHA.
- Registry: `archctx@0.12.0` has shasum `e160da3f7bb19d48ede0b103bcb597d9673c8e65` and `archctx-contracts@0.12.0` has shasum `b111cd254c05b8d703c0862413ab4c9c5ef44539`. Both dist-tags `latest` point at 0.12.0.
- `archctx-contracts`: the first `publish:contracts` run uploaded the package, but its readback ran before the registry exposed the version and reported `blocked`. After the version became visible, a second run reported `already-published`, skipped the upload, and passed the readback and the clean-room import smoke.
- Byte identity: the registry archives match the tarballs built in the release worktree, with sha256 `5ff4a6c7…f75e0ef` and `04bd163b…ce79bfd2`.
- Payload: the `archctx` archive carries 77 files under `schemas/`. `schemas/cloud/` holds only `cloud-egress-envelope` and `entitlement`, and none of the eight retired schemas is present. The `homepage` field is `https://github.com/Ancienttwo/arch-context`.
- Release assets: both `.tgz` files plus `SHA256SUMS` are attached, and a download of the release verifies against that manifest.
- Clean-room install from the registry: `archctx --version` reports 0.12.0, and `github` is absent from the command list.

Publication procedure: `docs/runbooks/npm-release.md`.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publishing is a separate step: publish interactively, wait for both registry versions, and read back version, dist-tag and integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Reverting the candidate before publication restores the prior version authorities. Published versions are immutable, so a fix after publication needs a new version. ADR-0053 rollout steps 4 to 6 (Worker, secrets, domain, App and D1 teardown) are owner actions after publication.
