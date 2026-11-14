# npm release

Release `archctx` and `archctx-contracts` together. Replace `<version>`,
`<merge-sha>`, `<worktree>` and `<notes>` in the commands below with the
release values. Use `deploy/release-checklists/archctx-<version>.md` as the
per-version release record.

## Release candidate

Prepare a release-candidate PR with synchronized version authorities and the
per-version checklist. Hosted Verify must pass on its head before the owner
merges it; that routine run is an impact plan, not the complete matrix. After
the merge, run release validation on the merged commit with the owner's
approval ([governance-revalidation.md](governance-revalidation.md)):

```sh
gh workflow run verify.yml --repo Ancienttwo/arch-context --ref main -f sha=<merge-sha>
```

Publish only from that merged release-candidate commit, and only after the
release validation run's `Verify gate` passed for `<merge-sha>`.

## Build and preflight

Create a detached worktree at the merged commit, enter it, and install its
locked dependencies:

```sh
git worktree add --detach <worktree> <merge-sha>
cd <worktree>
export NPM_CONFIG_USERCONFIG="$HOME/.npmrc"
bun install --frozen-lockfile
```

With `NPM_CONFIG_USERCONFIG` set, the publish scripts use that npm
configuration and do not read `_ops/env/archctx.npm.env`. Build both tarballs
and record the dry-run report in ignored `artifacts/`:

```sh
bun scripts/fg6-npm-release-dry-run.ts run --out artifacts/release-<version>/fg6-npm-release-dry-run.json --json
bun run preflight:archctx:npm
bun run preflight:contracts:npm
```

Confirm the dry run is verified and both preflights report `ready` before
publishing. The tarballs are written to `_ops/npm/fg6-release-dry-run/`;
the `archctx` publish command uses its tarball there. The contracts publish
command stages its package itself.

## Publish

In an interactive terminal in the release worktree, run in this order:

```sh
bun run publish:archctx
bun run publish:contracts
```

Use npm web authentication when it displays a URL. Never ask for or pass an
OTP. If the web-auth link expires and npm failed without uploading, rerun the
command and use the fresh link. If npm accepted an upload and reports it is
processing, do not publish that version again; wait for registry visibility.

For `archctx-contracts`, once its accepted version is visible in the registry,
`bun run publish:contracts` can be run again to complete its readback and
clean-room import smoke. It reports `already-published` and skips the upload.

## Registry readback

Wait until both versions are visible, then record their metadata and dist-tags:

```sh
npm view archctx@<version> version dist.shasum dist.integrity
npm view archctx dist-tags
npm view archctx-contracts@<version> version dist.shasum dist.integrity
npm view archctx-contracts dist-tags
```

Download the registry tarballs and compare their SHA-256 digests with the
tarballs built in this worktree. Both pairs must match.

```sh
mkdir -p artifacts/release-<version>/registry
npm pack archctx@<version> archctx-contracts@<version> --pack-destination artifacts/release-<version>/registry
shasum -a 256 _ops/npm/fg6-release-dry-run/archctx-<version>.tgz artifacts/release-<version>/registry/archctx-<version>.tgz
shasum -a 256 _ops/npm/fg6-release-dry-run/archctx-contracts-<version>.tgz artifacts/release-<version>/registry/archctx-contracts-<version>.tgz
```

Install the published CLI in a clean temporary prefix and check its version:

```sh
release_prefix="$(mktemp -d)"
npm install --prefix "$release_prefix" archctx@<version>
"$release_prefix/node_modules/.bin/archctx" --version
```

## Tag and GitHub Release

Only after both registry versions are visible and readback has passed, create
the tag on the published merge commit and create the GitHub Release. Attach
the registry tarballs and their `SHA256SUMS`:

```sh
(cd artifacts/release-<version>/registry && shasum -a 256 archctx-<version>.tgz archctx-contracts-<version>.tgz > SHA256SUMS)
git tag -a v<version> <merge-sha> -m "archctx / archctx-contracts <version>"
git push origin v<version>
gh release create v<version> --verify-tag --title "archctx / archctx-contracts <version>" --notes-file <notes> artifacts/release-<version>/registry/archctx-<version>.tgz artifacts/release-<version>/registry/archctx-contracts-<version>.tgz artifacts/release-<version>/registry/SHA256SUMS
```

Published versions are immutable. A fix after publication requires a new
version.
