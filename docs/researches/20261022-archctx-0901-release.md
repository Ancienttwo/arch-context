# archctx / archctx-contracts 0.9.1

## Changes

#395 fixes #387: the projection writer now fetches and rechecks its base from the same single push URL used for publication. When fetch and push repositories have different base tips, the resulting PR no longer inherits unrelated fetch-repository source commits. The private base ref uses the existing remote/base writer lock. A matching single fetch URL also refreshes its tracking ref; different fetch repositories retain their tracking refs. FETCH_HEAD is preserved, and an unreadable or missing publication base fails the run.

Upgrade `archctx` and `archctx-contracts` together to 0.9.1. This preparation changes version metadata and generated version-bound records only; runtime RPC, schemas and dependencies are unchanged.

## Verification

Prepared from `main@3569521939ef34147298a64d81bfd625b5cf9b80`, which includes merged #395, using Bun 1.4.3.

- `bun install --frozen-lockfile` passed after the sweep; only the five workspace version lines changed in `bun.lock`.
- `loadPracticeCatalog({ includeRepoOverlay: false })` regenerated the catalog; two generations were byte-identical. Only `productVersion` and `catalogDigest` changed.
- `bun run readback:fg4:deterministic-conclusion` and `bun run readback:fg6:no-provider-deterministic` passed with no failures. Only `modelDigest` and `generatedAt` changed.
- `bun test packages/contracts/test/contracts.test.ts packages/core/practice-catalog scripts/fg4-deterministic-conclusion-readback.test.ts scripts/fg6-no-provider-deterministic-readback.test.ts`: 269 passed, 0 failed, 1161 assertions.
- `bun scripts/fg6-npm-release-dry-run.ts run --out /tmp/archctx-091-npm-dry-run.json --artifact-dir /Volumes/D/archctx-091-release-dry-run --json`: `ok: true`, status `verified`, no failures, for both `archctx@0.9.1` and `archctx-contracts@0.9.1`. This script uses local `npm pack` and `npm pack --dry-run`; it does not publish.
- `git diff --check` passed. No 0.9.0 references remain in live package, action or example-workflow authorities.

The architecture-projection check on the clean base failed with `AC_CODE_FACTS_UNAVAILABLE` / `index-missing`. No CodeGraph index or unrelated architecture projections were created. Full local verification was not run; hosted CI on the release PR is the release gate. No tests were weakened.

This task does not publish npm packages, create a tag or GitHub Release, or merge the PR. Publication requires a separate authorized step after hosted CI and merge, rebuilding artifacts from merged main.
