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

- Package: archctx@0.4.4
- Tarball: archctx-0.4.4.tgz
- Package files: 86
- CLI bytes: 1730144
- CLI digest: sha256:864e7d97f3686571862b3056ffc6ac62e6a7fae4fea73b83dfeb5827c92b3c8f

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
