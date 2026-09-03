# archctx 0.5.1 release checklist

Status: draft. Nothing below is ticked and nothing has been published.

Scope: close the refactor measure → record → verify loop on a caller-reachable surface. `archctx
refactor verify --request-json` reaches the RF4 `refactorVerify` RPC over the newly frozen
`archcontext.refactor-verification-request/v1`, `recommendations resolve --evidence-digest` accepts
the resolution digest that verify recorded, and `refactor-resolution-v1` joins `ARCHCTX_FEATURES`.
Protocol identifiers, the `projection-result/v2` contract, the `archcontext.runtime-rpc/v1` RPC
schema, and the Node engine range `>=22.22 <26` are unchanged from `0.5.0`.

The patch bump is honest: no persisted shape changed. `RefactorVerificationRequestV1` is additive in
`archctx-contracts`, every `0.5.0` contract is byte-identical, and a `0.5.0` client reading a ledger
written by `0.5.1` sees only records it already understands. The one behaviour change is at the
ingress: `refactorVerify` now requires `schemaVersion` and refuses a malformed request before it
measures anything.

`0.5.0` was prepared but never published. `npm view archctx version` reports `0.4.8` on `latest`
(checked 2026-09-03), so this release publishes the first artifact since `0.4.8` and must carry the
whole `0.5.0` scope with it: the `refactor scan|record` surface and the `recommendation/v3` ledger
migration ship here, and `deploy/release-checklists/archctx-0.5.0.md` stays as the record of that
prepared-but-unpublished candidate rather than as a completed release.

- [x] `archctx`, `archctx-contracts`, every workspace manifest, `ARCHCONTEXT_PRODUCT_VERSION`, the
  product-version manifest fixture, and `packages/core/practice-catalog/assets/catalog.yaml`
  `productVersion` are exactly `0.5.1`, and the catalog was regenerated so `catalogDigest` binds the
  new `productVersion` rather than being edited by hand.
- [x] Repository-wide `0.5.0` sweep leaves no stale live pin. The remaining references are historical
  release checklists and archived plan/task records, the synthetic `archctx/0.5.0` runtime-version
  fixtures in `scripts/fg5-full-plane-dlp-readback.ts`, and the deliberate pre-publish statements in
  `docs/spec.md` `## Release State` and `docs/runbooks/personal-user-install.md`.
- [x] `archctx capabilities --json` lists all nine features, including `refactor-resolution-v1`, and
  reports `package.version` `0.5.1`.
- [x] `archctx refactor verify` without `--request-json` fails closed with `AC_SCHEMA_INVALID` and
  measures nothing; a malformed or invariant-violating request is refused at the same boundary.
- [x] `archctx refactor verify --request-json` on a recorded recommendation whose kill-list path was
  deleted returns `disposition: resolved`, and `archctx recommendations resolve --evidence-digest`
  accepts exactly that `resolutionDigest`.
- [x] `bun run typecheck` passes on the release candidate.
- [x] `bun run verify` passes on the release candidate, including `node scripts/packaged-cli-smoke.mjs`
  with its `refactor scan → record → verify → recommendations resolve` coverage.
- [x] `bun run verify:governance` reports every readback green, including the three no-LLM readbacks
  regenerated at `0.5.1`.
- [ ] Hosted `Verify` run is green: `Governance Verify` plus all nine platform targets across Ubuntu,
  macOS, and Windows on Node `22.22.x`, `24.x`, and `25.x`.
- [x] `bun run readback:fg6:npm-release-dry-run` reports `failures: []` at `0.5.1` and stages
  `archctx-0.5.1.tgz` and `archctx-contracts-0.5.1.tgz` with their SHA-256 digests recorded here.
- [x] `bun run readback:fg6:local-product-tarball` installs the staged tarball, starts the loopback
  daemon and stdio MCP surface, and records product version `0.5.1` with the `1.5.0` CodeGraph
  dependency binary.
- [x] `bun run record:al10:release-packaging` reports `AL10-10` and `AL10-11` verified.
- [ ] `bun run preflight:archctx:npm` reports `ready`: tarball found, registry readback
  `not-published`, npm identity `ancienttwo`.
- [ ] `bun run preflight:contracts:npm` reports `ready`: manifest ok, pack ok, unscoped public name,
  registry readback `not-published`.
- [ ] Publish `archctx-contracts@0.5.1` and read back version, integrity, shasum, and clean-room import.
- [ ] Publish `archctx@0.5.1` and read back version, integrity, shasum, Node engine, exact CodeGraph
  dependency, and the capabilities handshake including `refactor-resolution-v1`.
- [ ] Record the official npm artifact in `docs/verification/architecture-ledger-al10-npm-release-readback.json`
  from a real clean-room install, then close `bun run readback:release` with `failures: []`.
- [ ] Update `docs/spec.md` `## Release State` and `docs/runbooks/personal-user-install.md` to name
  `0.5.1` as the published artifact once the registry readback is recorded.

## Publish execution

Both publish scripts inherit stdio, so npm can prompt for one-time passwords or open web
authentication only in the maintainer's real terminal. A non-TTY shell cannot complete the upload.

```bash
bun run publish:contracts
node scripts/publish-archctx.mjs --confirm-publish \
  --tarball _ops/npm/fg6-release-dry-run/archctx-0.5.1.tgz \
  --registry https://registry.npmjs.org/
```

`scripts/publish-archctx.mjs` refuses to publish when the tarball is missing, when the version is
already on the registry, or when `npm whoami` fails, and it never publishes without
`--confirm-publish`.

## Post-publish readback

Not started. Fill this section from the live registry after publishing; do not pre-write expected
digests here.

## Migration note

`0.5.1` adds no migration of its own. The `archctx ledger migrate --recommendation-v3` upcast
prepared for `0.5.0` still applies, and because `0.5.0` never reached the registry, the first
published client to see a v3 ledger is `0.5.1` itself. The v2 read path is retained through this
release and is removed at `0.6.0`; do not add a compatibility shim that translates v3 back to v2 for
older clients.

## Pre-publish staging

Not started. Fill this table from `bun run readback:fg6:npm-release-dry-run` at the release
candidate commit; do not pre-write expected digests here.

| tarball | size | npm shasum | SHA-256 |
|---|---|---|---|

## Pre-publish staging

Staged by `bun run readback:fg6:npm-release-dry-run` at `fe5d53c` (main after PR #139), artifact
directory `_ops/npm/fg6-release-dry-run/`:

| tarball | size | npm shasum | SHA-256 |
|---|---|---|---|
| `archctx-0.5.1.tgz` | 438484 | `b91852954bd1b06ad80483ff03743144e2332830` | `6e6429bff7443bec96540a755bc0d4c132950aaca527a3b93fbca3e240e6946b` |
| `archctx-contracts-0.5.1.tgz` | 87653 | `e29b270d1d4a72f7920c0e0e0949ed27ea40b178` | `5d9ba7dfeed7971b421ae9ede499254b8ec51ddd0cc6020741bf18dfe78caf66` |

`bun run readback:fg6:local-product-tarball` and `bun run record:al10:release-packaging` were
regenerated from these tarballs. Both npm preflights and both publish steps run only in the
maintainer's real terminal (the unattended shell has no npm identity). 0.5.0 was staged at `65647fe`
but is not published either; both releases are handed off together.

