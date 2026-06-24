# Upgrade And Rollback Strategy

This runbook covers product upgrade and rollback. Practice Assets v1 specific
authoring, source, license, false-positive, quarterly review, and staged
rollout operations live in `docs/runbooks/practice-assets-v1.md`.

## Upgrade

1. Validate current model with `archctx validate`.
2. Run schema migration checks.
3. Write new generated projections.
4. Keep previous local state snapshot until first successful `complete_task`.

## Practice Assets v1 Release Drill

Before treating a Practice Assets v1 package as releasable, verify the shipped
package rather than the source checkout:

```bash
bun run readback:s6:catalog
bun run readback:s6:eval
bun run readback:s6:runtime
bun run readback:fg6:npm-release-dry-run
bun run readback:fg6:local-product-tarball
```

Required release evidence:

- Catalog manifest digest matches generated static assets.
- Source registry attribution, license, digest, and review data are complete.
- Tarball contains `assets/`, `schemas/`, `NOTICE.md`, `README.md`, and `bin/`.
- Installed product runs without Bun on `PATH`.
- Install, reinstall-upgrade, uninstall, and retained local state are verified.

## Rollback

1. Restore previous package version.
2. Restore local state snapshot if needed.
3. Rebuild generated projection from Git `.archcontext/`.
4. Rerun `bun run verify`.

## Practice Assets v1 False-Positive Rollback

Use the smallest rollback that removes the bad gate without deleting evidence:

1. Set `.archcontext/policies/practices.yaml` to `mode: advisory` to disable
   complete-stage practice enforcement.
2. Run `archctx docs purge --all` and leave Context7 disabled when external
   documentation caused the false positive.
3. Add an exact waiver only when the owner, subject, expiry, and evidence digest
   are known.
4. Disable a bad repo overlay with `overlay.mode: disable`.
5. Supersede built-in assets with a higher revision; do not delete historical
   revisions referenced by policy, waiver, catalog digest, or attestation.
6. Verify:

   ```bash
   archctx sync
   archctx prepare --task "<same task>"
   archctx checkpoint --task-session-id <same-session>
   archctx complete --task-session-id <same-session>
   bun run readback:fg6:rollback-compat
   ```

## Catalog Revision And Session Stale Drill

When a catalog revision changes:

1. Increment affected practice revisions.
2. Regenerate catalog evidence with `bun run record:s6:catalog`.
3. Run `bun run readback:s6:runtime` and confirm stale checkpoint sessions report
   `reasonCode: stale-catalog`.
4. Run `archctx docs purge --all` if the revision invalidates external
   documentation context.
5. Rerun `bun run readback:s5:context7` to prove Context7 remains advisory-only
   and Local Core remains unchanged when the provider is disabled or failing.
