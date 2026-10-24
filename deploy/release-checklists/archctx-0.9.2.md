# archctx 0.9.2 release checklist

Status: preparation only. The target pair is `archctx@0.9.2` and `archctx-contracts@0.9.2`.
The latest published release is [archctx 0.9.1](https://github.com/Ancienttwo/arch-context/releases/tag/v0.9.1),
published 2026-10-22 with `archctx-0.9.1.tgz`, `archctx-contracts-0.9.1.tgz` and `SHA256SUMS`.
The npm registry lists 0.9.1 as the latest version of both packages. No 0.9.2 tag, release or upload exists.

## Changes

[#400](https://github.com/Ancienttwo/arch-context/pull/400) fixes [#399](https://github.com/Ancienttwo/arch-context/issues/399).
A downstream repository that ignored `/.archcontext/` lost its only model copy. Its committed projection
manifest then made `docs adopt` fail with `projection-manifest-upgrade-required` and no usable next step.

- `projection-manifest-upgrade-required` now names `archctx docs apply --approved --profile <default|repo-harness/v1>`
  and the projection runbook. It states that the model must be restored first and that the manifest digest cannot recover it.
- `ignoredRepositoryPaths` asks `git check-ignore --verbose --no-index` which model paths the ignore rules exclude.
  `--no-index` judges the rules alone, so a force-added file does not hide an ignored directory.
- `archctx status` adds `architectureModelIgnoredPaths` (`path`, `source`, `line`, `pattern`) when a model path is excluded.
- `archctx docs adopt` and `projection run` in `adopt` mode refuse before they render with `AC_PRECONDITION_FAILED`,
  `reasonCode: "architecture-model-ignored"` and `action: "commit-architecture-model"`. `details.commands` holds the
  `git check-ignore` command that prints each deciding rule.
- The projection runbook and quickstart list the paths to commit: `.archcontext/manifest.yaml`, `product.yaml`,
  `model/nodes|relations|flows/`, `decisions/`, `policies/`, `practices/` and `projections/`.

## Compatibility

Upgrade `archctx` and `archctx-contracts` together. Runtime RPC stays v2, and no schema, method or dependency changes.
`architecture-model-ignored` is a new registered failure reason, and `status` gains one optional field.
A repository whose ignore rules exclude a model path can no longer run `docs adopt` until it fixes the rule.
That refusal is intended: adoption commits documents and a manifest that name an uncommitted model only by digest.
Other `docs` actions, `complete` and the projection writer are unchanged.

## Version authorities

The release PR changes the same 16 version-bound files as 0.9.1 (#396): the root and five workspace manifests,
`ARCHCONTEXT_PRODUCT_VERSION`, `bun.lock` workspace lines, the two valid version fixtures, the review action
default, the two docs/examples workflows, the practice catalog `productVersion`/`catalogDigest`, and the two
deterministic readback records (`modelDigest`, `generatedAt`). Synthetic test fixtures that name 0.9.1 are not
version authorities and stay unchanged.

## Verification and release gates

- [x] #400 local checks at `d1871ff8`: `bun run typecheck` passed; git-adapter and failure-envelope tests passed
  (41 tests, 1195 assertions); the new CLI regression covers `status`, `docs adopt` and protocol adopt.
- [x] Release sweep on `main@b4d62fa7`: `bun install` changed only the five workspace lines in `bun.lock`. Two catalog
  generations were byte-identical. Both readbacks passed with no failures. Contracts, practice-catalog and readback
  tests: 269 passed, 0 failed, 1161 assertions. No 0.9.1 pin remains in a live authority.
- [x] `bun scripts/fg6-npm-release-dry-run.ts run --artifact-dir /Volumes/D/archctx-092-release-dry-run/artifacts`:
  `ok: true`, status `verified`, no failures, for `archctx@0.9.2` and `archctx-contracts@0.9.2`. This branch does not
  contain #400, so the dry run proves packaging only. Publication rebuilds both tarballs from merged main.
- [ ] Hosted Verify passes on the exact heads of #400 and of the release PR.
- [ ] Merge #400 first, then the release PR, each with explicit approval. Use an explicit squash message for #400:
  its first commit message contains `[skip ci]`, and a default squash body would skip Verify on `main`.
- [ ] Hosted Verify passes on the merged `main` commit.
- [ ] In the primary checkout at merged `main` (the publish scripts read the ignored `_ops/env/archctx.npm.env` and
  stage under `_ops/npm/fg6-release-dry-run/`): `bun install --frozen-lockfile`,
  `bun scripts/fg6-npm-release-dry-run.ts run --out /Volumes/D/archctx-092-release/npm-dry-run.json --json` and
  `node scripts/local-product-tarball-smoke.mjs --out /Volumes/D/archctx-092-release/tarball-smoke.json`. The `--out`
  paths keep the tracked `docs/verification/` records unchanged. The smoke installs the tarball in a clean room.
- [ ] `bun run preflight:contracts:npm` and `bun run preflight:archctx:npm`.
- [ ] With separate publish approval, in an interactive terminal: `bun run publish:contracts`, then `bun run publish:archctx`.
  Use npm web authentication when npm shows an authentication URL. Do not request an OTP from `EOTP` alone. If npm
  accepts an upload and reports processing, wait for registry visibility; do not publish that version again.
- [ ] Read back `npm view archctx@0.9.2` and `npm view archctx-contracts@0.9.2` (version, shasum, integrity) and
  compare them with the staged tarballs.
- [ ] Tag `v0.9.2` on the published `main` commit. Create the GitHub release with `archctx-0.9.2.tgz`,
  `archctx-contracts-0.9.2.tgz` and `SHA256SUMS`, then download the assets and verify the checksums.
- [ ] Downstream: repo-harness bumps its exact `archctx` pin from 0.9.1 to 0.9.2 in a separate change.
