# Architecture Ledger AL10 Release Packaging Readback

## Scope

- Closes: AL10-10 and AL10-11 only.
- Keeps open: runbooks, telemetry, product interviews, governance, Go/No-Go and GA gates.
- Authority: local SQLite migration sequence and FG6 one-package npm dry-run tarball.

## Migration Compatibility Matrix

| State | From applied | To applied | Latest migration | Integrity | Result |
| --- | ---: | ---: | --- | --- | --- |
| fresh-empty | 0 | 18 | 0018_immutable_evidence_checkpoints | ok | pass |
| pre-ledger-0005 | 5 | 18 | 0018_immutable_evidence_checkpoints | ok | pass |
| ledger-v1-0006 | 6 | 18 | 0018_immutable_evidence_checkpoints | ok | pass |
| pre-search-fts-0008 | 8 | 18 | 0018_immutable_evidence_checkpoints | ok | pass |
| current-0017 | 17 | 18 | 0018_immutable_evidence_checkpoints | ok | pass |
| current-0018 | 18 | 18 | 0018_immutable_evidence_checkpoints | ok | pass |

## Package Bundle

- Package: archctx@0.3.0
- Tarball: archctx-0.3.0.tgz
- Package files: 81
- CLI bytes: 1757505
- CLI digest: sha256:477ecfc562f2d4552616e4e954e2187bde2ba98470459a46617b63115e14257a

## Bundle Signatures

| Group | Present | Required | Missing |
| --- | ---: | ---: | --- |
| migrations | 26 | 26 | - |
| hooks | 5 | 5 | - |
| renderers | 5 | 5 | - |
| agent-adapter-contracts | 7 | 7 | - |

## Readback

```bash
bun scripts/architecture-ledger-al10-release-packaging-readback.ts inspect --evidence docs/verification/architecture-ledger-al10-release-packaging-readback.json --json
bun scripts/architecture-ledger-al10-release-packaging-readback.ts run --out docs/verification/architecture-ledger-al10-release-packaging-readback.json --report docs/verification/architecture-ledger-al10-release-packaging.md --json
```
