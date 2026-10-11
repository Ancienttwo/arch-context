# archctx / archctx-contracts 0.7.0

## Changes

Projection:

- #258, #279: when `.archcontext/manifest.yaml` requires code facts and the CodeGraph index is missing, `projection run`, `readback`, `recover`, the `docs` commands and `complete_task` return `AC_CODE_FACTS_UNAVAILABLE` (`reasonCode: index-missing`, retryable, action `codegraph-init`). Before, a missing index read as a major change of every capability. Capability `code-facts-unavailable-error-v1`.
- #257, #267, #269, #270: projection stamps are content digests. Each `entity-summary` target records `sourceFootprintDigest` and `scale`; `verifiedAgainst` is removed. Footprints read Git-visible files only, with CRLF read as LF, so freshness holds after squash merges, rebases and shallow clones. The docs renderer is `archcontext.docs-renderer/v5`.
- #259, #270: `projection run` in `check` mode returns per-node `freshness`. It runs in-process, starts no daemon and writes no runtime state. A `check` result has no `priorCommittedApplies`. Capability `projection-check-freshness-v1`.
- #261, #272, #275: `acceptObservedMajorChange: true` accepts the observed major change in one `apply` or `adopt` request. An unprovable capability proof declines it with `majorChangeAcceptance: "declined-unprovable-proof"` and an `unprovable-required-flow` action. Capability `projection-observed-major-change-acceptance-v1`.
- #265, #272, #278, #285: a repeated accepted apply replays the committed result with `replayed: true`. A different request under a committed `requestId` returns `AC_PROJECTION_APPLY_COMMITTED` with `details.readbackRequest`, which can be sent unchanged to `projection readback`. Capability `projection-apply-replay-v1`.
- #266, #272, #277, #286: the committed manifest is machine-independent. The manifest is `archcontext.architecture-docs-projection-manifest/v2` with provenance `archcontext.architecture-docs-projection-provenance/v3`. HEAD, the worktree digest and the CodeGraph state move to the per-run `runtimeSnapshot`.
- #268, #272, #276, #286: an orphaned module document that holds only its generated region or the renderer's skeleton is deleted in the same apply. Any other orphan is `orphaned-document-review`. Capability `projection-orphan-review-v1`.
- #264, #287: `plan` mode returns a bounded preview per file, and `docs preview` is removed. Major-change results, refresh signals and `docs drift|plan` carry `capabilities[]`. archctx-contracts publishes the projection manifest contract. Capabilities `projection-preview-v1`, `architecture-change-capabilities-v1` and `projection-manifest-contract-v2`.

ChangeSet:

- #260, #271: one explicit approval model for CLI and MCP: `approved: true` plus expected hashes and worktree digest. The one-time approval token, `archctx approve`, `archctx projection approve` and the token RPC methods are removed. `archctx plan --op create_entity|update_entity_fields|delete_entity` takes `--expected-hash`. Capability `changeset-entity-operations-v1`.
- #281, #283: `archctx plan --operations-file` plans several operations in one ChangeSet. `--body-file` and `--body -` read an entity body, and `archctx hash --path` reads the expected hash.

Refactor:

- #262, #273: structural observations carry bounded `evidence` with `metrics` and `signalIds`. `StructuralObservationPayloadV1` copies all three, so the recorded payload is self-contained. Capability `refactor-observation-evidence-v1`.
- #263, #273: `recommendations acknowledge|accept|reject|defer|waive --id` decides a current scan candidate in one ledger append. `recommendations show` returns one recommendation with its evidence, baseline, affected modules and decisions. Capability `recommendation-scan-decision-v1`.
- #274, #284: a rejected or waived suggestion stays decided across later runs and reopens only when a severity metric gets worse.
- #280, #284: `refactor scan` reports `recording` and `limits` instead of failing on the ledger size limit. Record, a scan-candidate decision and a scan-candidate `show` return `AC_REFACTOR_RUN_TOO_LARGE` for a run that does not fit one ledger event. `recommendations list --status` is budget-free. Capability `refactor-scan-limits-v1`.
- #289: `refactor record` and `refactor verify` write evidence bindings whose `provenance.inputDigest` is the `sha256:` digest of their input (the baseline snapshot digest or the resolution digest). This is the same digest as the item they bind, and it matches `evidence-binding.schema.json`. Before the fix they wrote the evidence id.

Release readiness (#282):

- Version 0.7.0 for every package, the product version, fixtures, the review action and the workflow examples.
- archctx-contracts publishes `schemas/runtime/recommendation-v3.schema.json`, `structural-observation-payload.schema.json`, `runtime-refactor-scan.schema.json` and `runtime-recommendation-show.schema.json`, with fixtures. Tests validate real daemon scan and show output against them.
- The archctx-contracts schema validator resolves a relative cross-file `$ref` through a schema resolver. Without a resolver it reports the reference as unresolved. Before, it skipped such a reference. A test makes sure that every cross-file `$ref` in `schemas/` resolves to a published schema.
- The capabilities schema accepts any feature flag that matches `^[a-z0-9]+(-[a-z0-9]+)*-v[0-9]+$`, so a validator built from it accepts flags that a later release adds. `examples` lists the flags of this release.
- New capability flags: `code-facts-unavailable-error-v1`, `projection-manifest-contract-v2` and `refactor-scan-limits-v1`. `projection-manifest-contract-v2` replaces `projection-manifest-contract-v1`, which no release advertised and no code reads.
- This repository's `docs/architecture/` is re-projected with renderer v5 and manifest v2.

## Compatibility

This release changes the wire contract incompatibly. A consumer that pins `archctx` or `archctx-contracts` at 0.6.3 and decodes results with the 0.6.3 schemas rejects every new projection result:

- The 0.6.3 schemas require `rendererVersion: "archcontext.docs-renderer/v4"`. Every result and handshake now reports `archcontext.docs-renderer/v5`.
- The 0.6.3 schemas require `generatedFrom.codeGraphBinaryDigest`. Snapshots, receipts and recovery bindings no longer carry it, and the new schemas reject it (`additionalProperties: false`). Read the CodeGraph identity from `runtimeSnapshot`.
- A replayed apply carries `replayed: true`, which the 0.6.3 result schema does not allow. `replayed` is excluded from `receiptDigest`.
- The committed manifest is v2 with provenance v3. archctx 0.6.3 (renderer v4) rewrites it back to v1, so mixed installations churn.
- The 0.6.3 capabilities schema has a closed `features` enum and rejects the flags added since 0.6.3.
- The `docs` envelopes no longer carry `provenance.baseHeadSha`, `provenance.worktreeDigest`, `provenance.codeGraphDigest`, `provenance.indexedWorktreeDigest` or `provenance.generatedFrom.codeGraphStatus`. Read them from `runtimeSnapshot`.
- `archctx approve`, `archctx projection approve` and the one-time approval token are removed. MCP and CLI writes need explicit approval.
- `archctx docs preview` is removed. Use `projection run` with `mode: "plan"`.
- Handle the new typed errors `AC_PROJECTION_APPLY_COMMITTED`, `AC_CODE_FACTS_UNAVAILABLE` and `AC_REFACTOR_RUN_TOO_LARGE`.
- Pending refresh signals get a new `idempotencyKey` once, because `capabilities[]` is part of the signal identity.

Release `archctx` and `archctx-contracts` together, at the same version. Consumers upgrade both pins at the same time.

Migration: follow "Upgrading from archctx 0.6.3" in `docs/runbooks/architecture-documentation-projections.md`. Recover in-flight 0.6.3 apply receipts before the upgrade. A committed-apply receipt written by an older build fails closed on recovery and replay after the upgrade. The first projection after the upgrade rewrites every generated document and the manifest. Until the first apply, freshness reports `projection-source-stamp-missing` and `projection-snapshot-provenance-missing`. `docs/researches/20261010-projection-output-compatibility.md` lists every removed field.

Ledger data written before 0.7.0 is kept as written, and `recommendations show` returns it as stored:

- A structural observation recorded before #262 has no `payload.metrics`, `payload.signalIds` or `payload.evidence`, and its payload has no version marker. It does not validate against `recommendation-v3.schema.json`. Detect it by a `structural_observation` payload without `evidence`. A runtime with `refactor-observation-evidence-v1` writes all three fields. See `docs/runbooks/schema-upgrade-guide.md`.
- An evidence binding recorded by 0.6.x `refactor record` or `refactor verify` keeps the evidence id in `provenance.inputDigest`. Ledger replay does not validate binding provenance. `recommendations show` and `book evidence` return such a binding as stored, and it does not validate against `evidence-binding.schema.json`. Bindings that 0.7.0 writes validate.

Known limit (#290): under the `repo-harness/v1` profile, a component that declares `source.include` has no module document to carry a stamp. `freshness` keeps reporting `projection-source-stamp-missing` for such a node after the first apply.

CodeGraph remains pinned to `@colbymchenry/codegraph` 1.6.1. The pinned Bun toolchain is 1.4.3.

## Verification

All candidate commands use Bun 1.4.3. The candidate is the merge of `origin/main` (#288) into this branch.

- `bun run verify` passes on the merge candidate: typecheck, architecture Mermaid render, 2510 tests (1 skip, 0 fail), packaged CLI smoke and the audit readbacks.
- The version-bound deterministic records (fg4, fg6) were regenerated with their record scripts.
- The architecture projection was re-applied through `archctx docs plan` and `archctx docs apply --approved` (daemon ChangeSet path) after the merge. Only the manifest changed: the `sourceFootprintDigest` stamp moved, and no major change was observed. The agent-context projection (`AGENTS.md`, `CLAUDE.md`) has no change. `docs drift --profile repo-harness/v1` is clean.
- Before the merge, this branch also passed the npm release dry-run (`archctx-0.7.0.tgz`, `archctx-contracts-0.7.0.tgz`), the installed CLI tarball smoke under Node 24, and both npm publish preflights, which stopped only on npm identity (`E401`). Run them again on the merged main commit.

Publish both npm packages after the release-prep CI passes. Rebuild the tarballs from the merged main commit. Create tag `v0.7.0` and the GitHub Release only after both npm publishes succeed.
