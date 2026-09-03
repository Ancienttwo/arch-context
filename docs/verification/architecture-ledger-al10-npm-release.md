# Architecture Ledger AL10 Official NPM Release Readback

Status: verified

Scope: official public npm release for the `archctx` one-package distribution. This moves npm `latest` to `0.5.2`, superseding the broken `0.5.1`; it does not by itself enable production `ledger-authoritative` mode or hard enforcement.

## Published Artifact

- Package: `archctx@0.5.2`
- Dist-tag: `latest`
- Install: `npm install -g archctx@latest`
- Explicit install: `npm install -g archctx@0.5.2`
- Tarball: `https://registry.npmjs.org/archctx/-/archctx-0.5.2.tgz`
- Shasum: `3f247035699d9e15e2bf8935b7b16a3d50b31ce6`
- SHA256: `d8c72fea9310f57ade89b8e51638b6bf2770bcf2c7a43d260bea1e518e30f9b8`
- Integrity: `sha512-14vrH31DhxV0Wk1X4ygS2WCh6SS73Wr9BAqRdp50FWAQ0Iix42VAMVzzdJiI6JkBdRNp673FckF1JifYnN7HdQ==`

## Registry Readback

- `latest` points to `0.5.2`; `beta` remains `0.1.4-beta.0`.
- `archctx@0.5.2` is registry-visible with Node engine `>=22.22 <26`, the `archctx` bin, exact `@colbymchenry/codegraph@1.5.0`, `@node-rs/jieba@^2.0.1`, `koffi@3.1.6`, homepage `https://archcontext.repoharness.com`, and license `Apache-2.0`.
- `archctx-contracts@0.5.2` is published under `latest` with shasum `adc159e15bceec26480bfa607907717ce0e81924`; clean-room import via bun resolves 165 exports at version `0.5.2`.
- `0.5.1` remains on the registry as a historical artifact only: its manifest omitted `koffi`, so a fresh install dies at CLI startup. Do not install it.

## Source And Artifact Provenance

- Root source manifest: `package.json` is `archcontext@0.5.2`, `private: true`.
- Source packages: `@archcontext/contracts`, `@archcontext/core`, `@archcontext/local-runtime`, `@archcontext/surfaces`, and `@archcontext/cloud` are version-aligned at `0.5.2`; only `@archcontext/contracts` is a publishable contracts surface.
- Generated npm artifact: `archctx@0.5.2`, publishable, generated through `docs/verification/fg6-npm-release-dry-run.json`; the staged tarball digests were re-verified at merged main `ffaea92` before publish.
- Release/source/help consistency readback: `bun run readback:release`.

## Install Smoke

The clean install smoke ran from a clean room outside the repository with a plain `npm install archctx@0.5.2`, so no workspace `node_modules` could mask a missing dependency — the exact failure mode of `0.5.1`.

- Node `v24.18.0`: capabilities ok, version `0.5.2`, 9 features including `refactor-resolution-v1`; help ok, 42 commands; doctor ok, product/CLI/daemon/MCP `0.5.2`; update check current `0.5.2` / latest `0.5.2` / `current`.
- Node `v22.22.0` (engine floor): capabilities, doctor, and update check all ok at `0.5.2`, status `current`.

## Verification

- `bun run typecheck`, `bun run verify`, `bun run verify:governance` on the release candidate
- `bun run readback:fg6:npm-release-dry-run` (manifest asserts `koffi@3.1.6`), `bun run readback:fg6:local-product-tarball`, `bun run record:al10:release-packaging`
- clean-room install of the staged tarball outside the repository on Node 24.18.0 and Node 22.22.0
- hosted Verify run `33777570628` on main `ffaea92` green across Ubuntu, macOS, and Windows on Node 22.22.x, 24.x, and 25.x
- `bun run preflight:archctx:npm` and `bun run preflight:contracts:npm` both `ready`
- `bun run publish:contracts` and `node scripts/publish-archctx.mjs --confirm-publish --tarball _ops/npm/fg6-release-dry-run/archctx-0.5.2.tgz --registry https://registry.npmjs.org/`, both under interactive Web Auth on an allocated PTY
- `npm view archctx dist-tags versions time --json`, `npm pack` both published packages with shasum -a 1 / -a 256 matching the staged digests
- official clean-room install + smoke of the registry artifacts as recorded above
- `bun run readback:fg6:release-distribution`, `bun run readback:release`

## Boundary

This release publishes the official npm distribution carrying the `refactor scan|record|verify` surface, the `refactor-resolution-v1` capability, the v3 recommendation ledger rewrite, and the release-manifest declaration of the `koffi` runtime dependency. Authority promotion and production `ledger-authoritative` enablement still require their own canonical evidence.
