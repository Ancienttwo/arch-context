# Architecture Ledger AL10 Official NPM Release Readback

Status: verified

Scope: official public npm release for the `archctx` one-package distribution. This moves npm `latest` to `0.2.0`; it does not by itself enable production `ledger-authoritative` mode or hard enforcement.

## Published Artifact

- Package: `archctx@0.2.0`
- Dist-tag: `latest`
- Install: `npm install -g archctx@latest`
- Explicit install: `npm install -g archctx@0.2.0`
- Tarball: `https://registry.npmjs.org/archctx/-/archctx-0.2.0.tgz`
- Shasum: `8cebc9e3cccf5fe941435fc52578d3b8079e275d`
- SHA256: `0511a985e413a3a8f4c0fc0423a912e2a4d834244f88e505283a30b380937d54`
- Integrity: `sha512-VQ/CdgnyqkfB8VcCGXGHJBs67HmLy5z8luG/ynNMGzXUopoowNATlLdbVHFypqGVxCU9wTkuReOJrX1WQx9QEQ==`

## Registry Readback

- `latest` points to `0.2.0`.
- `beta` remains `0.1.4-beta.0`.
- `archctx@0.2.0` is registry-visible with Node engine `>=24 <26`, `archctx` and `codegraph` bins, homepage `https://archcontext.repoharness.com`, and license `Apache-2.0`.

## Source And Artifact Provenance

- Root source manifest: `package.json` is `archcontext@0.2.0`, `private: true`.
- Source packages: `@archcontext/contracts`, `@archcontext/core`, `@archcontext/local-runtime`, `@archcontext/surfaces`, and `@archcontext/cloud` are version-aligned at `0.2.0`; only `@archcontext/contracts` is a publishable contracts surface.
- Generated npm artifact: `archctx@0.2.0`, publishable, generated through `docs/verification/fg6-npm-release-dry-run.json`.
- Release/source/help consistency readback: `bun run readback:release`.

## Install Smoke

The clean install smoke used a temporary npm prefix with `node@24` and `archctx@latest`.

- Node: `v24.18.0`
- Help surface: ok, requestId `help`, 37 commands (36 at 0.1.5, plus the new `audit` command family)
- `archctx doctor --json`: ok, product/CLI/daemon/MCP version `0.2.0`
- `archctx update --check --json`: ok, currentVersion `0.2.0`, latestVersion `0.2.0`, status `current`

## Verification

- `bun test --timeout 120000` (962 pass, 0 fail)
- `bun run readback:fg6:npm-release-dry-run`
- `bun scripts/fg6-npm-release-dry-run.ts inspect --evidence docs/verification/fg6-npm-release-dry-run.json --json`
- `npm publish _ops/npm/fg6-release-dry-run/archctx-0.2.0.tgz --tag latest --access public --registry=https://registry.npmjs.org/`
- `npm view archctx version dist-tags versions --json --registry=https://registry.npmjs.org/`
- `npm view archctx@0.2.0 name version dist.tarball dist.shasum dist.integrity bin engines homepage license --json --registry=https://registry.npmjs.org/`
- `bun run readback:fg6:release-distribution`
- `bun scripts/fg6-release-distribution-readback.ts inspect --evidence docs/verification/fg6-release-distribution-readback.json --json`
- `bun run readback:release`
- `bun scripts/release-provenance-readback.ts inspect --evidence docs/verification/release-provenance-readback.json --json`
- temporary `node@24` + `archctx@latest` install smoke

## Boundary

This release publishes the official npm distribution, adding the opt-in local `audit` flow and its `audit approve` GitHub issue publishing path. Authority promotion, production `ledger-authoritative` enablement, hard enforcement, and AL10-14 beta-user interview closure still require their own canonical evidence.
