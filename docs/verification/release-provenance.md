# Release Provenance Readback

- Status: verified
- Generated At: 2026-06-28T12:22:10.336Z
- Root source package: `archcontext` 0.1.5, private=true
- Generated npm package: `archctx` 0.1.5
- npm latest: 0.1.5
- Source help commands: 36
- Published help commands: 36
- Official release smoke help commands: 36

## Package Relationship

The root workspace package and private workspace packages are source manifests. They stay private and version-aligned. The public npm artifact is generated as `archctx` from the release dry-run stage and is verified through registry and install-smoke evidence.

## Result

PASS: release, source manifests, help surface, docs, and npm registry agree.

## Boundary

This readback proves release/source consistency only. It does not promote `ledger-authoritative`, enable hard enforcement, or replace production GA external readback.
