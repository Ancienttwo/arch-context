# archctx / archctx-contracts 0.6.3

## Changes

- Fix false documentation drift when an older renderer writes a manifest without `semanticBaseline.evidence`.
- Keep checks strict when evidence is present, changed or null; proof-only acceptance still rejects a baseline without evidence.
- Move ChangeSet and MCP approval code into a daemon service; keep the writer lock, journal ownership and one-time token rules unchanged.
- Publish `archctx-contracts` with the aligned 0.6.3 product version; schemas and public exports are unchanged from 0.6.2.

## Compatibility

CLI, daemon and MCP interfaces are unchanged. CodeGraph remains pinned to 1.6.1. The CLI includes the flow ID schema fix already released in `archctx-contracts@0.6.2`.

## Verification

All candidate commands use Bun 1.4.0.

- Typecheck passes; 228 focused contracts, catalog and release tests pass.
- Both npm package dry-runs pass with no failures.
- The installed CLI tarball smoke passes under a Node-only runtime.
- Both npm publish preflights report ready with no blockers.
- Version-bound deterministic records were regenerated for 0.6.3.
- Architecture projection was rebuilt through a daemon ChangeSet; the model and flow proof digests are unchanged.

Publish both npm packages after the release-prep CI passes. Rebuild the tarballs from the merged main commit. Create tag `v0.6.3` and the GitHub Release only after both npm publishes succeed.
