# archctx / archctx-contracts 0.7.0

## Changes

Projection (#267, #269, #270, #272, #285, #286, #287):

- `AC_CODE_FACTS_UNAVAILABLE` (`reasonCode: index-missing`, retryable, `action: codegraph-init`). Docs and projection commands, the recovery fixed point and `complete_task` return it when `codeFacts.required` is `true` and the CodeGraph index is missing (#258, #279). Before, a missing index read as a major change of every capability.
- Content-addressed node stamps. Each `entity-summary` target records `sourceFootprintDigest` and `scale`; `verifiedAgainst` is removed (#257). Footprints read Git-visible files only, with CRLF read as LF (#269, #270).
- `projection run` in `check` mode returns `freshness`. It runs in-process, starts no daemon and writes no runtime state (#259, #270). A `check` result has no `priorCommittedApplies`.
- Renderer `archcontext.docs-renderer/v5` (#269). The committed manifest is machine-independent: provenance v3, and HEAD, worktree and CodeGraph state move to `runtimeSnapshot` (#266, #277).
- Orphan documents: an untouched generated or skeleton-only orphan is deleted; any other orphan is `orphaned-document-review` (#268, #276).
- `acceptObservedMajorChange: true` accepts the observed major change in one request. An unprovable proof declines it with `majorChangeAcceptance: "declined-unprovable-proof"` (#261, #275).
- A repeated accepted apply replays with `replayed: true`. A different request under a committed `requestId` returns `AC_PROJECTION_APPLY_COMMITTED` with `details.readbackRequest` (#265, #278).
- `plan` mode returns a preview per file; `docs preview` is removed. Major-change results and refresh signals carry `capabilities[]`. The manifest contract is published in archctx-contracts (#264, #287).

ChangeSet (#271, #283):

- One explicit approval model for CLI and MCP: `approved: true` plus expected hashes and worktree digest. The one-time approval token, `archctx approve`, `archctx projection approve` and the token RPC methods are removed.
- `archctx plan --op create_entity|update_entity_fields|delete_entity`, `--operations-file`, `--body-file`, `--body -`, and `archctx hash --path`.

Refactor (#273, #284):

- `recommendations acknowledge|accept|reject|defer|waive` decide a current scan candidate in one ledger append.
- Observations carry bounded `evidence`. `StructuralObservationPayloadV1` copies `metrics`, `signalIds` and `evidence`. `recommendations show` returns one recommendation with its evidence, baseline, affected modules and decisions.
- A rejected or waived suggestion stays decided until a severity metric gets worse. `refactor scan` reports `recording` and `limits`; record, decide and candidate `show` return `AC_REFACTOR_RUN_TOO_LARGE` for a run that does not fit one ledger event. `recommendations list --status` is added.

Release readiness (#282):

- Version 0.7.0 for every package, the product version, fixtures, the review action and the workflow examples.
- The projection manifest is `archcontext.architecture-docs-projection-manifest/v2`.
- New capability flags `code-facts-unavailable-error-v1` and `projection-manifest-contract-v2`. `projection-manifest-contract-v2` replaces `projection-manifest-contract-v1`, which no release advertised and no code reads.
- The capabilities schema accepts any feature flag that matches `^[a-z0-9]+(-[a-z0-9]+)*-v[0-9]+$`, so a validator built from it accepts flags a later release adds.
- archctx-contracts publishes `schemas/runtime/recommendation-v3.schema.json`, `runtime-refactor-scan.schema.json` and `runtime-recommendation-show.schema.json`, with fixtures. A test validates real scan and show output against them.
- This repository's `docs/architecture/` is re-projected with renderer v5 and manifest v2.

## Compatibility

This release changes the wire contract incompatibly. A consumer that pins `archctx` or `archctx-contracts` at 0.6.3 and decodes results with the 0.6.3 schemas rejects every new projection result:

- The 0.6.3 schemas require `rendererVersion: "archcontext.docs-renderer/v4"`. Every result and handshake now reports `archcontext.docs-renderer/v5`.
- The 0.6.3 schemas require `generatedFrom.codeGraphBinaryDigest`. Snapshots, receipts and recovery bindings no longer carry it, and the new schemas reject it.
- A replayed apply carries `replayed: true`, which the 0.6.3 result schema does not allow. `replayed` is excluded from `receiptDigest`.
- The committed manifest is v2 with provenance v3. archctx 0.6.3 (renderer v4) rewrites it back to v1, so mixed installations churn.
- The 0.6.3 capabilities schema has a closed `features` enum and rejects the flags added since 0.6.3.
- The `docs` envelopes no longer carry `provenance.baseHeadSha`, `provenance.worktreeDigest`, `provenance.codeGraphDigest`, `provenance.indexedWorktreeDigest` or `provenance.generatedFrom.codeGraphStatus`. Read them from `runtimeSnapshot`.
- The one-time approval token is gone. MCP and CLI writes need explicit approval.
- Pending refresh signals get a new `idempotencyKey` once, because `capabilities[]` is part of the signal identity.

Release `archctx` and `archctx-contracts` together, at the same version. Consumers upgrade both pins at the same time.

Refactor records written by 0.6.3 or earlier have no `payload.metrics`, `payload.signalIds` or `payload.evidence`. The ledger keeps them as written. A consumer detects such a record by the absence of `payload.evidence`; the new schemas accept it. Refactor evidence bindings carry the bound `evidenceId` in `provenance.inputDigest`; the runtime result schemas accept that form.

Migration: follow "Upgrading to archctx 0.7.0" in `docs/runbooks/architecture-documentation-projections.md`. Recover in-flight 0.6.3 apply receipts before the upgrade. The first projection after the upgrade rewrites every generated document and the manifest. `docs/researches/20261010-projection-output-compatibility.md` lists every removed field.

CodeGraph remains pinned to 1.6.1. The pinned Bun toolchain is 1.4.3.

## Verification

Release verification is in progress. Publish both npm packages after the release-prep CI passes. Create tag `v0.7.0` and the GitHub Release only after both npm publishes succeed.
