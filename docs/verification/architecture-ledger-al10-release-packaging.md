# Architecture Ledger AL10 Release Packaging Readback

## Scope

- Closes: AL10-10 and AL10-11 only.
- Keeps open: runbooks, telemetry, product interviews, governance, Go/No-Go and GA gates.
- Authority: local SQLite migration sequence and FG6 one-package npm dry-run tarball.

## Migration Compatibility Matrix

| State | From applied | To applied | Latest migration | Integrity | Result |
| --- | ---: | ---: | --- | --- | --- |
| fresh-empty | 0 | 19 | 0019_projection_apply_receipts | ok | pass |
| pre-ledger-0005 | 5 | 19 | 0019_projection_apply_receipts | ok | pass |
| ledger-v1-0006 | 6 | 19 | 0019_projection_apply_receipts | ok | pass |
| pre-search-fts-0008 | 8 | 19 | 0019_projection_apply_receipts | ok | pass |
| current-0017 | 17 | 19 | 0019_projection_apply_receipts | ok | pass |
| current-0018 | 18 | 19 | 0019_projection_apply_receipts | ok | pass |
| current-0019 | 19 | 19 | 0019_projection_apply_receipts | ok | pass |

## Package Bundle

- Package: archctx@0.4.7
- Tarball: archctx-0.4.7.tgz
- Package files: 86
- CLI bytes: 1737713
- CLI digest: sha256:c290e551d9b06b97451e4674337ad66dd6f2c707ce3c8d98c743d0b907fc66ad

## Bundle Signatures

| Group | Present | Required | Missing |
| --- | ---: | ---: | --- |
| migrations | 28 | 28 | - |
| hooks | 5 | 5 | - |
| renderers | 5 | 5 | - |
| agent-adapter-contracts | 7 | 7 | - |

## Readback

```bash
bun scripts/architecture-ledger-al10-release-packaging-readback.ts inspect --evidence docs/verification/architecture-ledger-al10-release-packaging-readback.json --json
bun scripts/architecture-ledger-al10-release-packaging-readback.ts run --out docs/verification/architecture-ledger-al10-release-packaging-readback.json --report docs/verification/architecture-ledger-al10-release-packaging.md --json
```
