# Schema Upgrade Guide

## Rules

- Schema versions use `archcontext.<entity>/vN`.
- New fields must be optional or live under `extensions` until all adapters understand them.
- Removed fields require a migration note and compatibility test.
- Digest calculation uses canonical JSON, not raw YAML bytes.

## Minimum Check

Run:

```bash
bun test packages/contracts/test/contracts.test.ts
```

## Architecture Ledger AL0

Schema set `2026-06-25.al0-ledger` adds the contract surface for the hybrid
architecture ledger. These schemas are runtime contracts; they do not by
themselves create SQLite tables or switch authority away from `.archcontext/`.

New runtime schemas:

- `schemas/runtime/architecture-event.schema.json`
- `schemas/runtime/architecture-snapshot.schema.json`
- `schemas/runtime/evidence-item.schema.json`
- `schemas/runtime/evidence-binding.schema.json`
- `schemas/runtime/recommendation-run.schema.json`
- `schemas/runtime/recommendation.schema.json`
- `schemas/runtime/agent-job.schema.json`
- `schemas/runtime/investigation-report.schema.json`

Rules:

- Ledger-affecting CLI/MCP behavior must use stable JSON envelopes and daemon
  mutation paths; do not add commands that edit SQLite directly.
- Additive contract data belongs under `extensions` until all adapters
  understand it.
- Free-text practice IDs, evidence IDs, or summaries cannot grant checkpoint or
  complete authority. Authority comes from `EvidenceBinding/v1`.
- Schema fixtures must include valid, invalid, and boundary coverage before an
  AL0 task is marked complete.
- Raw source bodies, raw diffs, prompt/completion bodies, full CodeGraph output,
  secrets, credentials, and private keys are forbidden in ledger schemas and
  fixtures.

Verification:

```bash
bun test packages/contracts/test/contracts.test.ts
bun run typecheck
```

## Sprint 2: Single-repo to Multi-repo

- Migrate every node document atomically from `archcontext.node/v1` to
  `archcontext.node/v2`; the runtime has no v1 compatibility reader. Existing
  `archcontext.relation/v1` documents remain valid.
- Multi-repo references may use `repo.id::node.id`; unscoped single-repo IDs keep their original meaning.
- New landscape state is additive: `archcontext.landscape/v1`, `archcontext.cross-repo-relation/v1`, `archcontext.org-runner-identity/v1`, and `archcontext.entitlement/v1`.
- Local SQLite tables for landscape and cross-repo edges are derived state and can be rebuilt from Git-tracked model files plus CodeGraph indexes.
- Entitlement adds `billingInterval`; it does not add team billing, seat pools, or organization-owned subscription scope.

Verification:

```bash
bun test packages/contracts packages/local-runtime/runtime-daemon packages/local-runtime/local-store-sqlite
```

## Release 0.7.0: Refactor Data Schemas

archctx-contracts 0.7.0 publishes JSON Schemas for the refactor data that was
previously described only by TypeScript types:

- `schemas/runtime/recommendation-v3.schema.json`: `RecommendationV3`
  (`archcontext.recommendation/v3`). `category` selects the payload and the
  authoring rules: a `structural_observation` is daemon-authored and advisory, a
  `refactor_proposal` is agent- or human-authored with `complete` enforcement at
  `architecture` scale and `checkpoint` otherwise, and a `practice` record
  carries `practiceId`.
- `schemas/runtime/structural-observation-payload.schema.json`:
  `StructuralObservationPayloadV1` with its observation `evidence` (one variant
  per observation kind, samples bounded at 20 entries, id lists at 32).
- `schemas/runtime/runtime-refactor-scan.schema.json`: the
  `archcontext.runtime-refactor-scan/v1` result of `archctx refactor scan`.
- `schemas/runtime/runtime-recommendation-show.schema.json`: the
  `archcontext.runtime-recommendation-show/v1` result of
  `archctx recommendations show`.

The scan and show schemas embed the recommendation definitions; contract tests
keep the embedded copies equal to the standalone schemas. Evidence items,
evidence bindings and decisions reference the existing
`evidence-item.schema.json`, `evidence-binding.schema.json` and
`recommendation-feedback.schema.json`. Load the whole `schemas/` directory, or
pass `resolveSchema` (for example from `jsonSchemaResolver`) to
`validateJsonSchema`, so that these references resolve; without a resolver the
validator reports each one as unresolved. The schemas check structure. The
TypeScript validators (`recommendationV3InvariantIssues`,
`refactorObservationEvidenceIssues`, `refactorScanInvariantIssues`) still own
the cross-field rules: sorted lists, digests that bind their payload, and
sample counts that equal a metric.

### Structural observations recorded before observation evidence

A `structural_observation` recorded before observation evidence existed (by
archctx 0.6.3 or earlier, before #262) has no `payload.metrics`,
`payload.signalIds` or `payload.evidence`. Its `schemaVersion` is still
`archcontext.recommendation/v3`, and the payload carries no version marker of
its own. `recommendations show` and the ledger return it as stored; it is never
rewritten. Such a record does not validate against
`recommendation-v3.schema.json`, and `recommendationV3InvariantIssues` reports
it as missing those fields.

Detect it before validating: a record with `category: "structural_observation"`
whose `payload` has no `evidence` field was written before evidence existed. A
runtime that advertises the `refactor-observation-evidence-v1` capability writes
all three fields on every new structural observation. There is no translation
reader: treat the old record as evidence-less.

### Evidence bindings recorded by 0.6.x

archctx 0.7.0 `refactor record` and `refactor verify` write
`provenance.inputDigest` as the `sha256:` digest of the binding's input: the
baseline snapshot digest or the resolution digest (#289). A binding that 0.6.x
recorded carries the evidence id there. Ledger replay does not validate binding
provenance and never rewrites a binding. `recommendations show` returns such a
binding as stored, and it does not validate against
`evidence-binding.schema.json` or the `runtime-recommendation-show` schema that
references it. Validation reports only `provenance.inputDigest`. Treat that
field of an old binding as opaque provenance.
