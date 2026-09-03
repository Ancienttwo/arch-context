# Architecture Ledger AL10 Release Packaging Readback

## Scope

- Closes: AL10-10 and AL10-11 only.
- Keeps open: runbooks, telemetry, product interviews, governance, Go/No-Go and GA gates.
- Authority: local SQLite migration sequence and FG6 one-package npm dry-run tarball.

## Migration Compatibility Matrix

| State | From applied | To applied | Latest migration | Integrity | Result |
| --- | ---: | ---: | --- | --- | --- |
| fresh-empty | 0 | 20 | 0020_projection_apply_recovery_proof | ok | pass |
| pre-ledger-0005 | 5 | 20 | 0020_projection_apply_recovery_proof | ok | pass |
| ledger-v1-0006 | 6 | 20 | 0020_projection_apply_recovery_proof | ok | pass |
| pre-search-fts-0008 | 8 | 20 | 0020_projection_apply_recovery_proof | ok | pass |
| current-0017 | 17 | 20 | 0020_projection_apply_recovery_proof | ok | pass |
| current-0018 | 18 | 20 | 0020_projection_apply_recovery_proof | ok | pass |
| current-0019 | 20 | 20 | 0020_projection_apply_recovery_proof | ok | pass |

## Package Bundle

- Package: archctx@0.5.2
- Tarball: archctx-0.5.2.tgz
- Package files: 87
- CLI bytes: 1983047
- CLI digest: sha256:2f9047536dd4b834db3e050d7f7f2a02ee4554fb7444d11f701b4016183313b3

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
