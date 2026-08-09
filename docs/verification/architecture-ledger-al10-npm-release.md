# Architecture Ledger AL10 Official NPM Release Readback

Status: verified

Scope: official public npm release for the `archctx` one-package distribution. This moves npm `latest` to `0.4.0`; it does not by itself enable production `ledger-authoritative` mode or hard enforcement.

## Published Artifact

- Package: `archctx@0.4.0`
- Dist-tag: `latest`
- Install: `npm install -g archctx@latest`
- Explicit install: `npm install -g archctx@0.4.0`
- Tarball: `https://registry.npmjs.org/archctx/-/archctx-0.4.0.tgz`
- Shasum: `ea6cacb33353272d01989f7bdbacf852187ac55b`
- SHA256: `d4a165d1599bf303bce79d9cbe58a0879571d2d0483cd2622e8087ccd5a532be`
- Integrity: `sha512-LFl8PqYv6Yu/VUbQHKJR00v2VZerRiyEvTlPXZVYEVjh1DzD37QmvlCq6zTUgZE3+wVLJJRpKe69u1vj2P4N7w==`

## Registry Readback

- `latest` points to `0.4.0`.
- `beta` remains `0.1.4-beta.0`.
- `archctx@0.4.0` is registry-visible with Node engine `>=24 <26`, the `archctx` bin, exact `@colbymchenry/codegraph@1.5.0`, homepage `https://archcontext.repoharness.com`, and license `Apache-2.0`.

## Source And Artifact Provenance

- Root source manifest: `package.json` is `archcontext@0.4.0`, `private: true`.
- Source packages: `@archcontext/contracts`, `@archcontext/core`, `@archcontext/local-runtime`, `@archcontext/surfaces`, and `@archcontext/cloud` are version-aligned at `0.4.0`; only `@archcontext/contracts` is a publishable contracts surface.
- Generated npm artifact: `archctx@0.4.0`, publishable, generated through `docs/verification/fg6-npm-release-dry-run.json`.
- Release/source/help consistency readback: `bun run readback:release`.

## Install Smoke

The clean install smoke used a temporary npm prefix with `node@24` and `archctx@latest`.

- Node: `v24.19.0`
- Help surface: ok, requestId `help`, 41 commands
- `archctx doctor --json`: ok, product/CLI/daemon/MCP version `0.4.0`; package-local CodeGraph version `1.5.0`
- `archctx update --check --json`: ok, currentVersion `0.4.0`, latestVersion `0.4.0`, status `current`

## Verification

- `bun run verify` (1218 pass, 0 fail)
- `bun run readback:fg6:npm-release-dry-run`
- `bun scripts/fg6-npm-release-dry-run.ts inspect --evidence docs/verification/fg6-npm-release-dry-run.json --json`
- `npm publish _ops/npm/fg6-release-dry-run/archctx-0.4.0.tgz --tag latest --access public --registry=https://registry.npmjs.org/`
- `npm view archctx version dist-tags versions --json --registry=https://registry.npmjs.org/`
- `npm view archctx@0.4.0 name version dist.tarball dist.shasum dist.integrity bin dependencies engines homepage license --json --registry=https://registry.npmjs.org/`
- `bun run readback:fg6:release-distribution`
- `bun scripts/fg6-release-distribution-readback.ts inspect --evidence docs/verification/fg6-release-distribution-readback.json --json`
- `bun run readback:release`
- `bun scripts/release-provenance-readback.ts inspect --evidence docs/verification/release-provenance-readback.json --json`
- temporary `node@24` + `archctx@latest` install smoke

## Boundary

This release publishes the official npm distribution with AXR1-AXR7 architecture-source-tree runtime fixes and exact package-local CodeGraph `1.5.0`. Authority promotion and production `ledger-authoritative` enablement still require their own canonical evidence.
