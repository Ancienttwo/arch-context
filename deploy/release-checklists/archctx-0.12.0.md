# archctx / archctx-contracts 0.12.0 preparation

Baseline: `origin/main@57dc8f4f`, the merge of #503.

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
- [ ] Release-candidate PR head: hosted full/matrix Verify passes before merge.
- [ ] Owner rollout step 2 confirmed: every installation of App `4102781` is suspended or uninstalled. No `archcontext-staging` check appeared on the #501 head.
- [ ] Rebuild both package tarballs from accepted main, and read back the version, the contents (including the absence of the eight schemas) and the digests.
- [ ] Publish interactively with npm web authentication. Wait for both registry versions, then read back version, dist-tag and integrity.
- [ ] Create the tag and GitHub Release only for the published commit, using the Release notes above.

Publication procedure: `docs/runbooks/npm-release.md`.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publishing is a separate step: publish interactively, wait for both registry versions, and read back version, dist-tag and integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Reverting the candidate before publication restores the prior version authorities. Published versions are immutable, so a fix after publication needs a new version. ADR-0053 rollout steps 4 to 6 (Worker, secrets, domain, App and D1 teardown) are owner actions after publication.
