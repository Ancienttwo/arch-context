# archctx 0.4.8 release checklist

Scope: ship `projection recover` with immutable receipt binding, land the audit hardening batch
`#108`–`#117`, and unify the toolchain on Bun `1.4.0` with an explicit per-runtime SQLite binding
selection. Protocol identifiers, the `projection-result/v2` contract, the `archcontext.runtime-rpc/v1`
RPC schema, and the Node engine range `>=22.22 <26` are unchanged from `0.4.7`.

Recovery is the reason the version moves. A committed accepted projection apply that returns
`applied-reconcile-required` can only be recovered through `projection recover --request-json`, and a
receipt without the exact immutable binding must be rejected rather than downgraded. Receipts written
by `0.4.7` and earlier stay readable and stay unrecoverable; that is the intended fail-closed shape,
not a gap to patch with a compatibility path.

- [x] `archctx`, `archctx-contracts`, every workspace manifest, `ARCHCONTEXT_PRODUCT_VERSION`, the
  product-version manifest fixture, and `packages/core/practice-catalog/assets/catalog.yaml`
  `productVersion` are exactly `0.4.8`.
- [x] Repository-wide `0.4.7` sweep leaves no stale live pin. The remaining references are historical
  release checklists and archived plan/task records, the deliberate pre-publish statements in
  `docs/spec.md` `## Release State` and `docs/runbooks/personal-user-install.md`, and the
  old-receipt semantics notes in `docs/spec.md` and `packages/contracts/src/projection.ts`.
- [x] Audit batch `#108`–`#117` is merged: daemon-owned developer-review cleanup (`#108`), repository
  and worktree scope on job complete/retry/cancel (`#109`), non-`github.com` remote rejection before
  issue publishing (`#110`), symlink-escape refusal on Context7 pin writes (`#111`), obsolete managed
  YAML removal on `ledger project --write` (`#112`), landscape validation and durable reconcile on
  repository removal (`#113`), bounded and timed-out runtime RPC request bodies (`#114`), deadlines
  and cancellation on `RuntimeRpcClient` (`#115`), canonical-payload `byteLength` and Context7 budget
  metadata at the daemon boundary (`#116`), and credential-value scanning of issue drafts (`#117`).
- [x] `openSqliteDatabase` and `openSqliteDatabaseSync` select the binding by runtime — Bun takes
  `bun:sqlite`, Node takes `node:sqlite`, an unrecognised runtime throws — so Bun's `node:sqlite`
  shim can no longer leak a file descriptor into a later compaction.
- [x] Hosted `Verify` run `33576103497` on `1d80e53` is green: `Governance Verify` plus all nine
  platform targets across Ubuntu, macOS, and Windows on Node `22.22.x`, `24.x`, and `25.x`.
- [x] `bun run typecheck` passes on the release candidate.
- [x] `bun run readback:fg6:npm-release-dry-run` reports `failures: []` at `0.4.8` and stages
  `archctx-0.4.8.tgz` (SHA-256 `f105a5cd3f5ea0f4986fd4384a9c7119da27a84792ff4fc337c0a80580db8503`)
  and `archctx-contracts-0.4.8.tgz` (SHA-256
  `a9be92f610a00dabe9a2e9d46f3e970236c2bef64217e83cbf2430211b4e4f99`).
- [x] `bun run readback:fg6:local-product-tarball` installs the staged tarball, starts the loopback
  daemon and stdio MCP surface, and records product version `0.4.8` with the `1.5.0` CodeGraph
  dependency binary.
- [x] `bun run record:al10:release-packaging` reports `AL10-10` and `AL10-11` verified with `7`
  migration cases, `87` package files, and `4` bundle signature groups.
- [x] `bun run preflight:archctx:npm` reports `ready`: tarball found, registry readback
  `not-published`, npm identity `ancienttwo`.
- [x] `bun run preflight:contracts:npm` reports `ready`: manifest ok, pack ok (`178` files),
  unscoped public name, registry readback `not-published`.
- [ ] Publish `archctx-contracts@0.4.8` and read back version, integrity, shasum, and clean-room import.
- [ ] Publish `archctx@0.4.8` and read back version, integrity, shasum, Node engine, exact CodeGraph
  dependency, and the capabilities handshake.
- [ ] Record the official npm artifact in `docs/verification/architecture-ledger-al10-npm-release-readback.json`
  from a real clean-room install, then close `bun run readback:release` with `failures: []`.
- [ ] Update `docs/spec.md` `## Release State` and `docs/runbooks/personal-user-install.md` to name
  `0.4.8` as the published artifact once the registry readback is recorded.

## Publish execution

Both publish scripts inherit stdio, so npm can prompt for one-time passwords or open web
authentication only in the maintainer's real terminal. A non-TTY shell cannot complete the upload.

```bash
bun run publish:contracts
node scripts/publish-archctx.mjs --confirm-publish \
  --tarball _ops/npm/fg6-release-dry-run/archctx-0.4.8.tgz \
  --registry https://registry.npmjs.org/
```

`scripts/publish-archctx.mjs` refuses to publish when the tarball is missing, when the version is
already on the registry, or when `npm whoami` fails, and it never publishes without
`--confirm-publish`. Credentials resolve from `NODE_AUTH_TOKEN`, `CI_TOKEN`, or `NPM_TOKEN` in the
environment or in `_ops/env/archctx.npm.env`, written into a short-lived `0600` npmrc that is removed
even on `SIGINT`/`SIGTERM`.

## Carried evidence gap

The `0.4.7` npm readback record was never merged into `main`, so
`docs/verification/architecture-ledger-al10-npm-release-readback.json`,
`docs/verification/fg6-release-distribution-readback.json`, and
`docs/verification/release-provenance-readback.json` still describe `0.4.6` while public npm serves
`0.4.7`. The `0.4.8` post-publish readback regenerates all three from the live registry and
supersedes the gap. Do not backfill `0.4.7` numbers into `0.4.8` evidence, and do not retroactively
tick the open publish boxes in `deploy/release-checklists/archctx-0.4.7.md`.
