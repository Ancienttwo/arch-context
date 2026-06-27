# Architecture Ledger AL10 Official NPM Release Readback

Status: verified

Scope: official public npm release for the `archctx` one-package distribution. This moves npm `latest` to `0.1.4`; it does not by itself enable production `ledger-authoritative` mode or hard enforcement.

## Published Artifact

- Package: `archctx@0.1.4`
- Dist-tag: `latest`
- Install: `npm install -g archctx@latest`
- Explicit install: `npm install -g archctx@0.1.4`
- Tarball: `https://registry.npmjs.org/archctx/-/archctx-0.1.4.tgz`
- Shasum: `d5688ff53b14ba5a5f71cc3877bdfbb204e026ef`
- SHA256: `d7c3746721ba590173857002bb671d28986a5df63c30ed87bfbe34209577972e`
- Integrity: `sha512-ZvMTWgqwYxvqJ7cFK8JEOAfFxjpxLgbx3opPUOBAeziWSPAOxo7rN62VF2QsZBg0Wq9+X306m6tgXHkZ+ShEVw==`

## Registry Readback

- `latest` points to `0.1.4`.
- `beta` remains `0.1.4-beta.0`.
- `archctx@0.1.4` is registry-visible with Node engine `>=24 <26`, `archctx` and `codegraph` bins, homepage `https://archcontext.repoharness.com`, and license `UNLICENSED`.

## Source And Artifact Provenance

- Root source manifest: `package.json` is `archcontext@0.1.4`, `private: true`.
- Private source packages: `@archcontext/contracts`, `@archcontext/core`, `@archcontext/local-runtime`, `@archcontext/surfaces`, and `@archcontext/cloud` are version-aligned at `0.1.4`.
- Generated npm artifact: `archctx@0.1.4`, publishable, generated through `docs/verification/fg6-npm-release-dry-run.json`.
- Release/source/help consistency readback: `bun run readback:release`.

## Install Smoke

The clean install smoke used a temporary npm prefix with `node@24` and `archctx@latest`.

- Node: `v24.18.0`
- Help surface: ok, requestId `help`, 36 commands
- `archctx doctor --json`: ok, product/CLI/daemon/MCP version `0.1.4`
- `archctx update --check --json`: ok, currentVersion `0.1.4`, latestVersion `0.1.4`, status `current`

## Verification

- `bun run verify:governance` with a temporary `ARCHCONTEXT_STATE_DIR`
- `bun run readback:fg6:npm-release-dry-run`
- `bun scripts/fg6-npm-release-dry-run.ts inspect --evidence docs/verification/fg6-npm-release-dry-run.json --json`
- `npm publish _ops/npm/fg6-release-dry-run/archctx-0.1.4.tgz --tag latest --access public --registry=https://registry.npmjs.org/`
- `npm view archctx version dist-tags versions --json --registry=https://registry.npmjs.org/`
- `npm view archctx@0.1.4 name version dist.tarball dist.shasum dist.integrity bin engines homepage license --json --registry=https://registry.npmjs.org/`
- `bun run readback:fg6:release-distribution`
- `bun scripts/fg6-release-distribution-readback.ts inspect --evidence docs/verification/fg6-release-distribution-readback.json --json`
- `bun run readback:release`
- `bun scripts/release-provenance-readback.ts inspect --evidence docs/verification/release-provenance-readback.json --json`
- temporary `node@24` + `archctx@latest` install smoke

## Boundary

This release publishes the official npm distribution. Authority promotion, production `ledger-authoritative` enablement, hard enforcement, and AL10-14 beta-user interview closure still require their own canonical evidence.
