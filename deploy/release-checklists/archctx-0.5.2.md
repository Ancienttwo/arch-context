# archctx 0.5.2 release checklist

Status: pre-publish. The manifest fix and every local gate below are complete; the hosted Verify
run, npm preflights, publish, and post-publish readbacks remain.

Scope: one packaging fix. `0.5.1` was published on 2026-09-03 with a release manifest that omitted
the `koffi` runtime dependency: the bundle keeps koffi external (`--external=koffi`), the CLI
requires it at module load, and a fresh `npm install archctx@0.5.1` dies at startup with
`Cannot find the native Koffi module`. The root cause is a manifest-assembly drift —
`scripts/local-product-tarball-smoke.mjs` assembled its own manifest with koffi and asserted it,
while `scripts/fg6-npm-release-dry-run.ts` assembled the published manifest without it, so both
repo-internal smokes stayed green against a broken artifact.

This release declares `koffi@3.1.6` (mirroring `packages/core/package.json`) in the assembled
release manifest, adds the same `descriptor-relative filesystem dependency` assertion to the
dry-run readback and inspect path, and installs a new causation gate: the staged tarball must
install and run from a clean room outside the repository, where no workspace `node_modules` can
mask a missing dependency. No protocol, ledger shape, engine range, or behavior changes beyond the
manifest; the code inside the tarball is byte-equivalent to `0.5.1` apart from the product version
sweep and the regenerated catalog digest.

The `0.5.1` post-mortem lives in `deploy/release-checklists/archctx-0.5.1.md`; `0.5.1` must not be
installed and this release supersedes it on `latest`.

- [x] `archctx`, `archctx-contracts`, every workspace manifest, `ARCHCONTEXT_PRODUCT_VERSION`, the
  product-version manifest fixture, the capabilities fixture, `actions/review-action/action.yml`,
  the two example workflows, `bun.lock` workspace entries, and `catalog.yaml` `productVersion` are
  exactly `0.5.2`, with the catalog regenerated so `catalogDigest` binds the new version
  (`sha256:4280dd4d375235d4777500fabb7a5d9c254261fb353a9fcc5a6f50bc571d99aa`).
- [x] Repository-wide `0.5.1` sweep leaves no stale live pin. Remaining references are historical
  release checklists, archived plan/task records, research notes, the deliberate post-mortem
  statements in `docs/spec.md` and `docs/runbooks/personal-user-install.md`, and the synthetic
  `archctx/0.5.0` runtime-version fixtures in `scripts/fg5-full-plane-dlp-readback.ts`.
- [x] `scripts/fg6-npm-release-dry-run.ts` `buildReleaseManifest` declares `koffi` from the core
  manifest; the readback records `descriptorFsDependencyDeclared` and `inspectNpmReleaseDryRun`
  rejects a manifest without koffi; `bun test scripts/fg6-npm-release-dry-run.test.ts` covers the
  assembly and the rejection.
- [x] `bun run typecheck` passes on the release candidate.
- [x] `bun run verify` passes on the release candidate, including `node scripts/packaged-cli-smoke.mjs`.
- [x] `bun run verify:governance` reports every readback green, with the three no-LLM readbacks
  regenerated at `0.5.2`.
- [x] `bun run readback:fg6:npm-release-dry-run` reports `failures: []` at `0.5.2` and stages
  `archctx-0.5.2.tgz` and `archctx-contracts-0.5.2.tgz` with digests recorded below; the staged
  tarball's `package.json` declares
  `"dependencies": { "@colbymchenry/codegraph": "1.5.0", "@node-rs/jieba": "^2.0.1", "koffi": "3.1.6" }`.
- [x] `bun run readback:fg6:local-product-tarball` installs the staged tarball, starts the loopback
  daemon and stdio MCP surface, and records product version `0.5.2` with the `1.5.0` CodeGraph
  dependency binary.
- [x] `bun run record:al10:release-packaging` reports `AL10-10` and `AL10-11` verified.
- [x] Clean-room causation gate (outside the repository, plain `npm install` of the staged
  tarball, no workspace `node_modules` in scope): `archctx capabilities --json` reports
  `package.version` `0.5.2` with all nine features including `refactor-resolution-v1`;
  `help --json` lists 42 commands; `doctor --json` reports product, CLI, daemon, and MCP surfaces
  at `0.5.2`; `update --check --json` resolves the current version — on Node `24.18.0` and at the
  `22.22.0` engine floor. `archctx-contracts-0.5.2.tgz` installs clean and imports via bun with
  165 exports at version `0.5.2`. This gate is what `0.5.1` failed.
- [ ] Hosted `Verify` run is green on the merged release-prep commit.
- [ ] `bun run preflight:archctx:npm` reports `ready`.
- [ ] `bun run preflight:contracts:npm` reports `ready`.
- [ ] Publish `archctx-contracts@0.5.2` and read back version, integrity, shasum, and clean-room
  import.
- [ ] Publish `archctx@0.5.2` and read back version, integrity, shasum, Node engine, exact
  CodeGraph and koffi dependencies, and the capabilities handshake including
  `refactor-resolution-v1`.
- [ ] Record the official npm artifact in `docs/verification/architecture-ledger-al10-npm-release-readback.json`
  from a real clean-room install, then close `bun run readback:release` with `failures: []`.
- [ ] Update `docs/spec.md` `## Release State` and `docs/runbooks/personal-user-install.md` to name
  `0.5.2` as the published artifact once the registry readback is recorded.

## Publish execution

Both publish steps run under an allocated PTY (`script -q`) so npm can perform interactive web
authorization; the authorizer opens the printed `npmjs.com/auth/cli/...` URL and approves.

```bash
bun run publish:contracts
npm_config_cache=<fresh-cache-dir> node scripts/publish-archctx.mjs --confirm-publish \
  --tarball _ops/npm/fg6-release-dry-run/archctx-0.5.2.tgz \
  --registry https://registry.npmjs.org/
```

`scripts/publish-archctx.mjs` refuses to publish when the tarball is missing, when the version is
already on the registry, or when `npm whoami` fails, and it never publishes without
`--confirm-publish`. The contracts step uses its own isolated npm cache; the archctx step needs an
explicit writable cache because `~/.npm/_cacache` contains root-owned files on this machine.

## Post-publish readback

Not started. Fill this section from the live registry after publishing; do not pre-write expected
digests here.

## Pre-publish staging

Staged by `bun run readback:fg6:npm-release-dry-run` on the `0.5.2` release candidate (working
tree of the release-prep branch); re-verified at the merged main commit before publish. Artifact
directory `_ops/npm/fg6-release-dry-run/`:

| tarball | size | npm shasum | SHA-256 |
|---|---|---|---|
| `archctx-0.5.2.tgz` | 438492 | `3f247035699d9e15e2bf8935b7b16a3d50b31ce6` | `d8c72fea9310f57ade89b8e51638b6bf2770bcf2c7a43d260bea1e518e30f9b8` |
| `archctx-contracts-0.5.2.tgz` | 87653 | `adc159e15bceec26480bfa607907717ce0e81924` | `470705385f5cf31b72279eead41f8a68c694c25503cc0c9764538e87be9daf3d` |

The prepared-but-unpublished `0.5.0` candidate and the published-but-broken `0.5.1` artifact must
not be installed; `0.5.2` is the only installable identity of this scope.
