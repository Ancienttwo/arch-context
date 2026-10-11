# archctx / archctx-contracts 0.7.0

## Changes

Projection:

- #257, #267, #269, #270: projection stamps are content digests. Each `entity-summary` target records `sourceFootprintDigest`, measured over Git-visible files with CRLF normalized to LF, so freshness holds after squash merges, rebases and shallow clones. The docs renderer is `archcontext.docs-renderer/v5`.
- #258, #279: when `.archcontext/manifest.yaml` requires code facts and no CodeGraph index exists, `projection run`, `readback`, `recover`, the `docs` commands and `complete_task` fail with `AC_CODE_FACTS_UNAVAILABLE` (action `codegraph-init`) instead of reporting a major change for every capability. Capability `projection-code-facts-gate-v1`.
- #259, #270: `projection run` `check` reports per-node `freshness` and runs in-process without a daemon, local store or journal. Capability `projection-check-freshness-v1`.
- #261, #272, #275: `acceptObservedMajorChange: true` applies the observed major change in one `apply` or `adopt` request. An unprovable capability proof declines it with `majorChangeAcceptance: "declined-unprovable-proof"` and an `unprovable-required-flow` action. Capability `projection-observed-major-change-acceptance-v1`.
- #265, #272, #278, #285: repeating a committed accepted apply returns the committed result with `replayed: true`. `AC_PROJECTION_APPLY_COMMITTED` carries `details.readbackRequest`, which can be sent unchanged to `projection readback`. Capability `projection-apply-replay-v1`.
- #266, #272, #277, #286: the committed manifest is machine-independent. Provenance is `archcontext.architecture-docs-projection-provenance/v3`; the CodeGraph evidence digest, indexed-worktree digest and status are per-run `runtimeSnapshot` facts. The manifest is `archcontext.architecture-docs-projection-manifest/v2`.
- #268, #272, #276, #286: an orphaned module document that holds only its generated region or the renderer's skeleton is deleted in the same apply; anything else needs review. Capability `projection-orphan-review-v1`.
- #264, #287: `projection run` `plan` returns bounded `preview` content per file; refresh signals and `docs drift|plan` break a major change down per capability; archctx-contracts publishes the projection manifest schema. Capabilities `projection-preview-v1`, `architecture-change-capabilities-v1`, `projection-manifest-contract-v1`. The hidden `docs preview` command is removed.

ChangeSet:

- #260, #271: `archctx plan --op create_entity|update_entity_fields|delete_entity` with `--expected-hash`; CLI `apply` and MCP share one approval model (`approved: true` plus expected hashes and worktree digest). Capability `changeset-entity-operations-v1`.
- #281, #283: `archctx plan --operations-file` plans several operations in one ChangeSet, `archctx hash --path` reads the expected hash, and `--body-file` reads an entity body from a file.

Refactor:

- #262, #273: structural observations carry bounded `evidence` with `metrics` and `signalIds`, and the recorded payload is self-contained. Capability `refactor-observation-evidence-v1`.
- #263, #273: `recommendations accept|defer|reject|acknowledge|waive --id` decides a scan candidate without a separate record step. Capability `recommendation-scan-decision-v1`.
- #274, #284: rejected and waived refactor suggestions stay decided across later runs and reopen only when a severity metric gets worse.
- #280, #284: `refactor scan` reports `recording` and `limits` instead of failing on the ledger size limit; record, a scan-candidate decision and a scan-candidate `show` refuse an unrecordable run with `AC_REFACTOR_RUN_TOO_LARGE`; `recommendations list --status` is budget-free. Capability `refactor-scan-limits-v1`.
- #282: archctx-contracts publishes `recommendation-v3`, `structural-observation-payload`, `runtime-refactor-scan` and `runtime-recommendation-show` JSON Schemas.
- Evidence bindings written by `refactor record` and `refactor verify` set `provenance.inputDigest` to the `sha256:` digest of the input they were derived from (the baseline snapshot digest, the resolution digest), matching the item they bind and `evidence-binding.schema.json`. Before the fix they carried the evidence id, so a validator that resolves the cross-file `$ref` in `runtime-refactor-scan` and `runtime-recommendation-show` rejected real scan and show output. The archctx-contracts schema validator now resolves relative `$ref`s through a schema resolver and reports an unresolved one instead of skipping it.

## Compatibility

The wire contract is incompatible with 0.6.3 consumers. A consumer pinned to `archctx-contracts@0.6.3` rejects 0.7.0 results. Upgrade `archctx` and `archctx-contracts` together, then change:

- Accept `archcontext.docs-renderer/v5`, manifest `archcontext.architecture-docs-projection-manifest/v2` and provenance `archcontext.architecture-docs-projection-provenance/v3`.
- `generatedFrom` no longer has `codeGraphBinaryDigest` (`additionalProperties: false`); read CodeGraph identity from `runtimeSnapshot`.
- `replayed` is excluded from `receiptDigest`.
- `archctx approve`, `archctx projection approve` and one-time approval tokens are removed; send `approved: true` with the expected hashes and worktree digest.
- `archctx docs preview` is removed; use `projection run` with `mode: "plan"`.
- Handle the new typed errors `AC_PROJECTION_APPLY_COMMITTED`, `AC_CODE_FACTS_UNAVAILABLE` and `AC_REFACTOR_RUN_TOO_LARGE`.
- `check` results never carry `priorCommittedApplies`; read it from `apply` or `readback`.
- The capabilities `features` enum is closed. Validate with the 0.7.0 schema, which adds `projection-code-facts-gate-v1` and `refactor-scan-limits-v1` among others.

Before upgrading, recover every in-flight 0.6.3 projection apply receipt with `projection recover`. Committed-apply receipts written by an older build fail closed on recovery and replay after the upgrade ("current renderer, layout, or CodeGraph provenance differs"). The first `check` after the upgrade plans a rewrite of every generated document and the manifest; freshness reports `projection-source-stamp-missing` and `projection-snapshot-provenance-missing` until the first apply. See `docs/runbooks/architecture-documentation-projections.md`.

Structural observations recorded before #262 have no `payload.metrics`, `payload.signalIds` or `payload.evidence`, and the payload has no version marker. `recommendations show` returns them as stored; they do not validate against `recommendation-v3.schema.json`. Detect them by a `structural_observation` payload without `evidence`; a runtime with `refactor-observation-evidence-v1` writes all three fields. See `docs/runbooks/schema-upgrade-guide.md`.

Evidence bindings recorded by 0.6.x `refactor record` or `refactor verify` keep their stored `provenance.inputDigest`, which is the evidence id rather than a `sha256:` digest. Ledger replay does not validate binding provenance and keeps them as recorded; `recommendations show` and `book evidence` return them as stored, so for those records the `evidence.bindings` entries do not validate against `evidence-binding.schema.json`. Bindings written by 0.7.0 do.

Known gap: under the `repo-harness/v1` profile, components that declare `source.include` have no module document to carry a stamp, so `freshness` keeps reporting `projection-source-stamp-missing` after the first apply.

CodeGraph remains pinned to `@colbymchenry/codegraph` 1.6.1. Bun is pinned to 1.4.3.

## Verification

All candidate commands use Bun 1.4.3.

- `bun run verify` passes: typecheck, architecture Mermaid render, 2502 tests (1 skip, 0 fail), packaged CLI smoke and the audit readbacks.
- The npm release dry-run builds `archctx-0.7.0.tgz` and `archctx-contracts-0.7.0.tgz` with no failures.
- The installed CLI tarball smoke passes under a Node-only runtime (Node 24).
- Both npm publish preflights pack and validate the manifests; they are blocked only on npm identity (`E401`) until the publisher authenticates.
- Version-bound deterministic records were regenerated for 0.7.0.
- Architecture projection was rebuilt through the daemon projection apply with `acceptObservedMajorChange`; `docs drift` is clean afterwards.
- After the evidence-binding fix: `bun run typecheck`, the contracts, recommendation-engine, refactor-assessment, architecture-ledger, architecture-delta, runtime-daemon and CLI suites (1241 tests, 0 fail) and `node scripts/packaged-cli-smoke.mjs` pass. Every valid contracts fixture now validates with cross-file `$ref`s resolved. The full `bun run verify` above predates the fix.

Publish both npm packages after the release-prep CI passes. Rebuild the tarballs from the merged main commit. Create tag `v0.7.0` and the GitHub Release only after both npm publishes succeed.
