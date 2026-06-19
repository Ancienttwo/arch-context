# Upgrade And Rollback Strategy

## Upgrade

1. Validate current model with `archctx validate`.
2. Run schema migration checks.
3. Write new generated projections.
4. Keep previous local state snapshot until first successful `complete_task`.

## Rollback

1. Restore previous package version.
2. Restore local state snapshot if needed.
3. Rebuild generated projection from Git `.archcontext/`.
4. Rerun `bun run verify`.
