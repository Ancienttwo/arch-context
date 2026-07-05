# ArchContext Contracts npm Scope Note

`@archcontext/contracts@0.1.4` is package-ready on `origin/main`, but public npm
publish under the `@archcontext` org scope is blocked by scope authorization and
the npm org cost boundary. The no-org distribution target is now
`archctx-contracts@0.1.4`; the internal workspace package remains
`@archcontext/contracts`.

The current authenticated npm identity is `ancienttwo`. Unscoped-name preflight
passes; original `@archcontext` scope package, org, and team readbacks return
`E403`, while `npm view @archcontext/contracts` returns `E404`.

The package manifest now declares the npm-visible SPDX license as
`Apache-2.0`; `packages/contracts/test/publishability.test.ts` and
`scripts/publish-archcontext-contracts.mjs` both gate on that metadata before a
publish can pass.

Canonical retry surface:

```bash
bun run preflight:contracts:npm
bun run publish:contracts
```

Durable readback:
`docs/verification/archcontext-contracts-npm-scope-readback.md`.

~~Do not switch ModelContext to the public dependency or enable
`MODELCONTEXT_REQUIRE_ARCHCONTEXT_CONTRACTS=1` until
`archctx-contracts` is published and clean-room install/import
readback passes.~~

**2026-07-06 published.** `archctx-contracts@0.1.5` is live on
registry.npmjs.org (Apache-2.0, 100 files). Publish path: interactive
`npm publish` with web-auth (npm now enforces 2FA or a bypass-2FA
granular token for new-package publishes; classic tokens were revoked
registry-wide 2025-12-09). Post-publish readback via
`bun run publish:contracts`: registry readback published, clean-room
install/import smoke ok. The ModelContext switch precondition is met;
enabling `MODELCONTEXT_REQUIRE_ARCHCONTEXT_CONTRACTS=1` now happens in
the ModelContext repo, not here.
