# ArchContext Contracts npm Distribution Readback

> Date: 2026-07-12
> Source package: `@archcontext/contracts@0.3.0`
> npm package: `archctx-contracts@0.3.0`
> Package license: `Apache-2.0`
> Status: verified and published

## Decision

`@archcontext/contracts` remains the workspace source package name. Public npm
distribution uses the unscoped `archctx-contracts` name so the product does not
depend on ownership of the `@archcontext` npm organization.

The publish helper is the authority for the transformation. It copies `src`,
`fixtures`, and the repository `schemas` tree into a temporary package, changes
only the public package name, and preserves version and license metadata.

## Registry Readback

```text
package: archctx-contracts@0.3.0
latest: 0.3.0
license: Apache-2.0
tarball: https://registry.npmjs.org/archctx-contracts/-/archctx-contracts-0.3.0.tgz
shasum: 3249f22c2cd208348e978ac7852fb6a8ff430d10
integrity: sha512-yJoI4+xwlrZhdYbr5GhExAoyy5jFnyqWY3w97CJvKFhWJruK/fuWGxPKl3EIP+exD7syoykDu8TQkKNHy/6BOg==
```

The registry digest matches the pre-publish `npm pack` result. The package has
164 files and exports both the TypeScript contract root and public JSON schemas.

## Installed Runtime Verification

The canonical post-publish helper completed with no blockers:

```text
node scripts/publish-archcontext-contracts.mjs publish --confirm-publish --json
status: published
publish: already-published
registry readback: published
clean-room import smoke: ok
```

The clean-room smoke installed `archctx-contracts@0.3.0`, imported
`digestJson` and `productVersionManifest`, resolved representative repository
and runtime schemas from the package exports, and confirmed product version
`0.3.0`.

## Invariants

- The internal workspace package remains `@archcontext/contracts`.
- The public distribution remains `archctx-contracts`.
- Registry publication does not promote SQLite to architecture authority.
- Ledger-affecting writes still cross the ChangeSet or daemon-owned event
  boundary.
