# archctx 0.6.1 release candidate

## Changes

- Upgrade the bundled CodeGraph dependency from 1.5.0 to 1.6.1, with runtime manifests, projection contracts and release checks aligned to the exact version.
- Rebuild existing CodeGraph indexes after upgrading: extraction version 27 replaces version 24 and includes the upstream resolution and navigation changes.

## Compatibility

The CLI, daemon and MCP entrypoints are unchanged. Projection snapshots and receipts now require CodeGraph 1.6.1. Persisted evidence from an older CodeGraph version must be regenerated before it can satisfy the current exact-version contract.

## Verification

All candidate commands use Bun 1.4.0 in the isolated `codex/release-061` worktree, based on `597a416`.

- `bun run verify:governance`: exit 0, all 24 commands pass with no skips. The full suite reports 2360 pass, one skip and zero failures across 212 files.
- npm release dry-run: exit 0, both public packages are verified with no failures.
- Local product tarball smoke: exit 0. The installed CLI reports 0.6.1, CodeGraph is 1.6.1, the daemon is loopback-only, MCP exposes seven tools, and reinstall/uninstall preserve runtime state.
- Practices: strict validation passes with 41 practices, 19 sources and eight profiles; catalog digest is `sha256:ebfdab809c0fa136197717d3d7190648fa60b779f193d05434dc7812a414474d`.
- Version-bound FG4/FG6 no-provider recordings were regenerated and both inspections pass.
- Architecture projection: initialized the candidate CodeGraph index, then reconciled only `docs/architecture/.projection-manifest.json` through `docs apply --approved`. Subsequent drift is clean, with `majorChange.mode: none`.
- Architecture specialist: no introduced finding; final readiness depends on verification and platform CI below.

The following hashes describe local candidate artifacts. Rebuild from the final approved commit before publishing.

- `archctx-0.6.1.tgz`: 523154 bytes, 88 entries, SHA-256 `92cb1d75864f075785c40249252cc0d6e27c312b502650c3e742889662fb54d9`.

- `archctx-contracts-0.6.1.tgz`: 94796 bytes, 180 entries, SHA-256 `61361b382e7be924de37ecf2c0ad29147706ce67d3776e375943203500ffb039`.
