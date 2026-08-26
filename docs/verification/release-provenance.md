# Release Provenance Readback

- Status: failed
- Generated At: 2026-08-26T17:24:49.237Z
- Root source package: `archcontext` 0.4.6, private=true
- Generated npm package: `archctx` 0.4.6
- npm latest: 0.4.5
- Source help commands: 41
- Published help commands: 41
- Official release smoke help commands: 41

## Package Relationship

The root workspace package and private workspace packages are source manifests. They stay private and version-aligned. The public npm artifact is generated as `archctx` from the release dry-run stage and is verified through registry and install-smoke evidence.

## Result

FAILED:
- distributionReadbackVerified
- officialNpmReadbackVerified
- registryLatestMatchesRoot

## Boundary

This readback proves release/source consistency only. It does not promote `ledger-authoritative`, enable hard enforcement, or replace production GA external readback.
