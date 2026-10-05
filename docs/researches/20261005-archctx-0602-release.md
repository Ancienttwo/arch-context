# archctx / archctx-contracts 0.6.2 release candidate

## Changes

- Patch release of `archctx-contracts` (and aligned workspace product version) after PR #254.
- Loosen `schemas/repo/architecture-flow.schema.json` `id` and `capabilityId` patterns so the first segment after the `flow.` / `capability.` prefix may contain hyphens (e.g. `flow.my-service.x`, `capability.payment-gateway.charge`).

## Compatibility

Schema-only widening. Existing flow and capability IDs remain valid. Consumers that previously rejected hyphenated first segments will accept them after upgrading to `archctx-contracts@0.6.2`.

## Version anchors

Bump root and workspace package versions, `ARCHCONTEXT_PRODUCT_VERSION`, contracts fixtures, practice catalog `productVersion` / recomputed `catalogDigest`, review-action default, and organization-runner example pins from `0.6.1` to `0.6.2`.

## Verification evidence

Regenerated version-bound FG4/FG6 no-provider deterministic readbacks so `modelDigest` matches the 0.6.2 `REVIEW_ACTION_NO_LLM_MODEL_DIGEST`. Both inspect commands report `failures: []`.

## Publish

Public artifact remains unscoped `archctx-contracts`, staged from private `@archcontext/contracts` plus root `schemas/` via `scripts/publish-archcontext-contracts.mjs`. Publish waits for release-prep CI, then Aimpact runs:

```bash
cd ~/Projects/arch-context
bun run publish:contracts
```

Do not tag or create a GitHub Release before the npm publish succeeds. After publish, tag `v0.6.2` and create the GitHub Release from the merged main commit.
