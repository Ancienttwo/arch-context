# Architecture Ledger AL10 Official NPM Release Readback

Status: verified

Scope: official public npm release for the `archctx` one-package distribution. This moves npm `latest` to `0.4.2`; it does not by itself enable production `ledger-authoritative` mode or hard enforcement.

## Published Artifact

- Package: `archctx@0.4.2`
- Dist-tag: `latest`
- Install: `npm install -g archctx@latest`
- Explicit install: `npm install -g archctx@0.4.2`
- Tarball: `https://registry.npmjs.org/archctx/-/archctx-0.4.2.tgz`
- Shasum: `d249a726be28ea673ff677cd239f327093446327`
- SHA256: `f323122bb43bada4b4d6ef1ed6bb1a09544bd359d3799d7fe39471d2ac6f40cd`
- Integrity: `sha512-mDsl6fKZ5sg4tZrt+cN3ym0oHJOcYWQsRPzAu9eNbUez79qRgq7aA8moRpYWMTBGQUlq78QmyQHE0r14cZq51w==`

## Registry Readback

- `latest` points to `0.4.2`.
- `beta` remains `0.1.4-beta.0`.
- `archctx@0.4.2` is registry-visible with Node engine `>=24 <26`, the `archctx` bin, exact `@colbymchenry/codegraph@1.5.0`, homepage `https://archcontext.repoharness.com`, and license `Apache-2.0`.

## Source And Artifact Provenance

- Root source manifest: `package.json` is `archcontext@0.4.2`, `private: true`.
- Source packages: `@archcontext/contracts`, `@archcontext/core`, `@archcontext/local-runtime`, `@archcontext/surfaces`, and `@archcontext/cloud` are version-aligned at `0.4.2`; only `@archcontext/contracts` is a publishable contracts surface.
- Generated npm artifact: `archctx@0.4.2`, publishable, generated through `docs/verification/fg6-npm-release-dry-run.json`.
- Release/source/help consistency readback: `bun run readback:release`.

## Install Smoke

The clean install smoke used a temporary npm prefix with `node@24` and `archctx@latest`.

- Node: `v24.19.0`
- Help surface: ok, requestId `help`, 41 commands
- `archctx capabilities --json`: package version `0.4.2`, projection request/result v1, refresh signal v1, docs renderer v2
- `archctx doctor --json`: ok, product/CLI/daemon/MCP version `0.4.2`; package-local CodeGraph version `1.5.0`
- `archctx update --check --json`: ok, currentVersion `0.4.2`, latestVersion `0.4.2`, status `current`

## Verification

- `bun run verify` under Node 24.18.0 (1229 pass, 0 fail)
- `bun run readback:fg6:npm-release-dry-run`
- `bun scripts/fg6-npm-release-dry-run.ts inspect --evidence docs/verification/fg6-npm-release-dry-run.json --json`
- `node scripts/publish-archcontext-contracts.mjs publish --confirm-publish --json` with interactive Web Auth
- `node scripts/publish-archctx.mjs --confirm-publish --tarball <temp>/archctx-0.4.2.tgz --registry https://registry.npmjs.org/ --json` with interactive Web Auth
- `npm view archctx version dist-tags versions --json --registry=https://registry.npmjs.org/`
- `npm view archctx@0.4.2 name version dist.tarball dist.shasum dist.integrity bin dependencies engines homepage license --json --registry=https://registry.npmjs.org/`
- `bun run readback:fg6:release-distribution`
- `bun scripts/fg6-release-distribution-readback.ts inspect --evidence docs/verification/fg6-release-distribution-readback.json --json`
- `bun run readback:release`
- `bun scripts/release-provenance-readback.ts inspect --evidence docs/verification/release-provenance-readback.json --json`
- temporary `node@24` + `archctx@latest` install smoke

## Boundary

This release publishes the official npm distribution with the 0.4.1 accepted-change projection bridge and the 0.4.2 Claude runtime-trace stability fix, while retaining exact package-local CodeGraph `1.5.0`. Authority promotion and production `ledger-authoritative` enablement still require their own canonical evidence.
