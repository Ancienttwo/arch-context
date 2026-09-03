# archctx 0.5.0 release checklist

Status: draft. Nothing below is ticked and nothing has been published.

Scope: ship the refactor intelligence surface — `archctx refactor scan|record` over the new
`refactorScan` RPC and the RF3 `refactorRecord` RPC — and expose `module-statistics-v1`,
`refactor-assessment-v1` and `recommendation-v3` through `ARCHCTX_FEATURES`. Protocol identifiers,
the `projection-result/v2` contract, the `archcontext.runtime-rpc/v1` RPC schema, and the Node engine
range `>=22.22 <26` are unchanged from `0.4.8`.

The minor bump exists for one reason: RF3 rewrites persisted recommendations to
`archcontext.recommendation/v3`, and `archctx ledger migrate --recommendation-v3` appends that
upgrade as an event rather than editing rows. A `0.4.x` client reading a migrated ledger sees a
schema version it does not know, so the version has to move. `refactor verify` and
`refactor-resolution-v1` are deliberately not in this release; they ship at `0.5.1`.

- [ ] `archctx`, `archctx-contracts`, every workspace manifest, `ARCHCONTEXT_PRODUCT_VERSION`, the
  product-version manifest fixture, and `packages/core/practice-catalog/assets/catalog.yaml`
  `productVersion` are exactly `0.5.0`, and the catalog was regenerated so `catalogDigest` binds the
  new `productVersion` rather than being edited by hand.
- [ ] Repository-wide `0.4.8` sweep leaves no stale live pin. The remaining references are historical
  release checklists and archived plan/task records, and the deliberate pre-publish statements in
  `docs/spec.md` `## Release State` and `docs/runbooks/personal-user-install.md`.
- [ ] `archctx capabilities --json` lists all eight features, including `module-statistics-v1`,
  `refactor-assessment-v1` and `recommendation-v3`, and reports `package.version` `0.5.0`.
- [ ] `archctx refactor scan --json` run twice at the same HEAD is byte-identical. The scan reads no
  clock: both `createdAt` fields are the HEAD committer date and `requestId` is derived from the
  request digest.
- [ ] `archctx refactor record` is idempotent against an already-open recommendation: a second record
  of the same assessment appends the run and reports `duplicate-active-fingerprint` suppressions.
- [ ] `bun run typecheck` passes on the release candidate.
- [ ] `bun run verify` passes on the release candidate, including `node scripts/packaged-cli-smoke.mjs`
  with its `refactor scan` coverage.
- [ ] Hosted `Verify` run is green: `Governance Verify` plus all nine platform targets across Ubuntu,
  macOS, and Windows on Node `22.22.x`, `24.x`, and `25.x`.
- [ ] `bun run readback:fg6:npm-release-dry-run` reports `failures: []` at `0.5.0` and stages
  `archctx-0.5.0.tgz` and `archctx-contracts-0.5.0.tgz` with their SHA-256 digests recorded here.
- [ ] `bun run readback:fg6:local-product-tarball` installs the staged tarball, starts the loopback
  daemon and stdio MCP surface, and records product version `0.5.0` with the `1.5.0` CodeGraph
  dependency binary.
- [ ] `bun run record:al10:release-packaging` reports `AL10-10` and `AL10-11` verified.
- [ ] `bun run preflight:archctx:npm` reports `ready`: tarball found, registry readback
  `not-published`, npm identity `ancienttwo`.
- [ ] `bun run preflight:contracts:npm` reports `ready`: manifest ok, pack ok, unscoped public name,
  registry readback `not-published`.
- [ ] Publish `archctx-contracts@0.5.0` and read back version, integrity, shasum, and clean-room import.
- [ ] Publish `archctx@0.5.0` and read back version, integrity, shasum, Node engine, exact CodeGraph
  dependency, and the capabilities handshake including the three new features.
- [ ] Record the official npm artifact in `docs/verification/architecture-ledger-al10-npm-release-readback.json`
  from a real clean-room install, then close `bun run readback:release` with `failures: []`.
- [ ] Update `docs/spec.md` `## Release State` and `docs/runbooks/personal-user-install.md` to name
  `0.5.0` as the published artifact once the registry readback is recorded.

## Publish execution

Both publish scripts inherit stdio, so npm can prompt for one-time passwords or open web
authentication only in the maintainer's real terminal. A non-TTY shell cannot complete the upload.

```bash
bun run publish:contracts
node scripts/publish-archctx.mjs --confirm-publish \
  --tarball _ops/npm/fg6-release-dry-run/archctx-0.5.0.tgz \
  --registry https://registry.npmjs.org/
```

`scripts/publish-archctx.mjs` refuses to publish when the tarball is missing, when the version is
already on the registry, or when `npm whoami` fails, and it never publishes without
`--confirm-publish`. Credentials resolve from `NODE_AUTH_TOKEN`, `CI_TOKEN`, or `NPM_TOKEN` in the
environment or in `_ops/env/archctx.npm.env`, written into a short-lived `0600` npmrc that is removed
even on `SIGINT`/`SIGTERM`.

## Post-publish readback

Not started. Fill this section from the live registry after publishing; do not pre-write expected
digests here.

## Migration note

`archctx ledger migrate --recommendation-v3` upcasts every v2 recommendation still latest for its id
and appends one migration event. It never rewrites a row, so a ledger that has not been migrated
keeps serving v2 records and `refactor record` keeps reading them. The v2 read path is retained for
this release and is removed at `0.6.0`; do not add a compatibility shim that translates v3 back to
v2 for older clients.
