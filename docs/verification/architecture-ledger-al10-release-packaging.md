# Architecture Ledger AL10 Release Packaging Readback

## Scope

- Closes: AL10-10 and AL10-11 only.
- Keeps open: runbooks, telemetry, product interviews, governance, Go/No-Go and GA gates.
- Authority: local SQLite migration sequence and FG6 one-package npm dry-run tarball.

## Migration Compatibility Matrix

| State | From applied | To applied | Latest migration | Integrity | Result |
| --- | ---: | ---: | --- | --- | --- |
| fresh-empty | 0 | 9 | 0009_architecture_ledger_search_fts | ok | pass |
| pre-ledger-0005 | 5 | 9 | 0009_architecture_ledger_search_fts | ok | pass |
| ledger-v1-0006 | 6 | 9 | 0009_architecture_ledger_search_fts | ok | pass |
| pre-search-fts-0008 | 8 | 9 | 0009_architecture_ledger_search_fts | ok | pass |
| current-0009 | 9 | 9 | 0009_architecture_ledger_search_fts | ok | pass |

## Package Bundle

- Package: archctx@0.1.4-beta.0
- Tarball: archctx-0.1.4-beta.0.tgz
- Package files: 79
- CLI bytes: 1184447
- CLI digest: sha256:d3b860353222bae8ffc01aa9c0b733fa8b719e01926f9b240d38f046e0016add

## Bundle Signatures

| Group | Present | Required | Missing |
| --- | ---: | ---: | --- |
| migrations | 5 | 5 | - |
| hooks | 5 | 5 | - |
| renderers | 5 | 5 | - |
| agent-adapter-contracts | 7 | 7 | - |

## Readback

```bash
bun scripts/architecture-ledger-al10-release-packaging-readback.ts inspect --evidence docs/verification/architecture-ledger-al10-release-packaging-readback.json --json
bun scripts/architecture-ledger-al10-release-packaging-readback.ts run --out docs/verification/architecture-ledger-al10-release-packaging-readback.json --report docs/verification/architecture-ledger-al10-release-packaging.md --json
```
