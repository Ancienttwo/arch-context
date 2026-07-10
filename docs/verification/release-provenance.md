# Release Provenance Readback

- Status: verified
- Generated At: 2026-07-10T16:40:12.965Z
- Root source package: `archcontext` 0.2.2, private=true
- Generated npm package: `archctx` 0.2.2
- npm latest: 0.2.2
- Source help commands: 38
- Published help commands: 38
- Official release smoke help commands: 38

## Package Relationship

The root workspace package and private workspace packages are source manifests. They stay private and version-aligned. The public npm artifact is generated as `archctx` from the release dry-run stage and is verified through registry and install-smoke evidence.

## Result

PASS: release, source manifests, help surface, docs, and npm registry agree.

## Boundary

This readback proves release/source consistency only. It does not promote `ledger-authoritative`, enable hard enforcement, or replace production GA external readback.
