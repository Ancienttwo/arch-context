---
schemaVersion: archcontext.adr/v1
id: adr.0047.projection-manifest-v3
title: Projection Manifest v3 and Per-Target Identity
status: accepted
decidedAt: 2026-10-14
appliesTo:
  - module.architecture-context.contracts
  - component.architecture-context.projection-renderer
  - component.architecture-context.local-runtime.projection-service
  - component.architecture-context.local-runtime.runtime-daemon
supersedes: []
---

# ADR-0047: Projection Manifest v3 and Per-Target Identity

## Context

The committed projection manifest (`docs/architecture/.projection-manifest.json`, v2) stored
global values next to the target rows: a model-global `sourceDigest`, a `provenance` block
(`sourceTreeDigest`, `modelDigest`, `projectionInputDigest`, renderer, layout), the global
`projectionDigest` and `receiptDigest`, `targetCount`, `fileCount` and one global proof evidence
record. Every one of them changes whenever any capability's documentation changes. Two branches
that change different capabilities therefore conflicted on the same lines, although their
documents did not overlap. The rows were an array in two-space JSON, so a changed row also touched
lines that belonged to its neighbours.

The global proof evidence made committed-change acceptance coarse. A flow proof change was
explained only when the global source tree, the global selector evidence and the renderer had not
moved, so a source edit in one capability refused an unrelated proof change in another.

Stamps covered only nodes with their own module document. Under `repo-harness/v1`, a component or
module that declared `source.include` had no stamp, and a change to its footprint was visible only
through the global source tree digest.

## Decision

### 1. Manifest v3 layout

The manifest moves to `archcontext.architecture-docs-projection-manifest/v3`
(`ArchitectureDocsProjectionManifestV3`, `schemas/runtime/projection-manifest.schema.json`). One
serializer writes it, and the byte layout is part of the contract:

- Header lines that change only on a protocol upgrade: `schemaVersion`, `rendererVersion`,
  `profile`, `layoutVersion`, `generatedFrom`.
- `semanticBaseline.modelDigest`: the one Git-visible model anchor.
- `semanticBaseline.capabilities`: one indented block per capability, sorted by id, with
  `capabilityId`, `memberNodeIds`, `semanticFingerprint`, `flowProofFingerprint`, `proofStatus`,
  `facets` and `selectorEvidenceDigest`. The selector evidence digest covers only the selectors
  that the capability's required flows cite.
- `targets`: keyed by targetId, sorted. The key is on one line and the row is one JSON line under
  it, with keys in the order `type`, `scope`, `path`, `ownership`, `format`, `outputDigest`, then
  `sourceStamps` and `scale` where they apply.

Removed from the committed file: `sourceDigest`, `provenance.*`, the global `projectionDigest`,
`receiptDigest`, `projectionInputDigest`, the global `sourceTreeDigest`, the global evidence,
`targetCount` and `fileCount`. A value that is still needed is computed when the manifest is read:
the declared source tree digest from every row's `sourceStamps`, the flow proof digest from the
capability entries, and the projection digest from the renderer, the profile and every row's
`outputDigest` (`architectureDocsProjectionManifestDigests`). The runtime provenance stays on the
plan, the result envelopes and the apply receipts, and is never committed. The id of the docs
projection ChangeSet derives from the digest of the owned output bytes.

Two changes to different capabilities touch disjoint lines and merge cleanly with
`git merge-file`. Two changes to the model both change the `modelDigest` line and conflict there,
on purpose: the merged model needs its own projection.

The reader is strict. `rendererVersion` may name any renderer, because a renderer upgrade must
still read the manifest the previous renderer wrote. A manifest that names v3 and fails the
contract is refused with `projection-manifest-invalid`. A manifest that is not JSON, or that names
no recognizable `schemaVersion`, carries no baseline, as before.

### 2. Per-target identity

A projection target is identified by its target path plus its row: the per-target `outputDigest`
and, on entity-summary rows, the source stamps. This replaces "target path plus source snapshot
digest" in the authority matrix.

Each declared footprint is stamped on the row of its nearest ancestor-or-self node that has an
`entity-summary` target under the active profile. `sourceStamps` maps each such node id to its
footprint content digest; `scale` stays on the row whose own node declares a footprint. A declared
footprint with no such node fails with the typed `projection-footprint-uncovered` error, which
names the node ids. Stamps do not follow flow participants: a proof change is caught by the
semantic classification, and following participants would move stamps on unrelated edits.

### 3. Per-capability proof acceptance

`assertProofChangesExplained` runs per capability. A capability whose flow proof changed while its
semantic fingerprint did not is explained only when the renderer version, that capability's
`selectorEvidenceDigest` and the stamps of every node in its baseline `memberNodeIds` are
unchanged. Other capabilities' sources and evidence do not take part.

### 4. One Git-visible anchor, not a SQLite baseline

The semantic baseline stays in the committed manifest, anchored by `semanticBaseline.modelDigest`.
It is not moved into a daemon-owned SQLite record. Committed-change acceptance and projection
classification must work in a CI clone and in a fresh HOME, where no runtime state exists.
ADR-0037 keeps runtime SQLite rebuildable from Git, and a baseline that exists only in SQLite
could not be rebuilt. The cost is one line on which concurrent model changes conflict, which is
the conflict a reviewer must see.

### 5. Migration: refuse, then re-baseline once

A v1 or v2 manifest is read only for its `schemaVersion`. Every command that reads the committed
manifest refuses it with `projection-manifest-upgrade-required`. Only `archctx docs apply
--approved --profile <profile>` treats it as absent and writes a v3 manifest; the profile must be
given, because the old manifest is not read for it. There is no v2 reader, no translation and no
dual read. The tolerance for a manifest without proof evidence and the read of a v1 baseline are
removed. The freshness reason `projection-snapshot-provenance-missing` is removed with the
committed provenance.

Because the v2 rows are not read, nothing proves that the projection owns a whole-file output
(`.mmd`, `.likec4`, `.structurizr.json`) that 0.7.x wrote with a renderer v5 marker. The
re-baseline refuses those files as `projection-ambiguous-ownership`; the operator removes them with
`git rm` before the re-baseline, which writes them again. A tree whose whole-file outputs already
equal the current render needs no removal.

The re-baseline does not classify the model against the old baseline, so operators reach a clean
fixed point (`check` = `noop`) on 0.7.x and drain pending apply receipts before upgrading. The
contracts package takes a breaking minor change.

### 6. Phase 1 capability isolation

The per-target rows and per-capability entries are the identity Phase 1 isolation uses (issue
#327, slice S7). `projection run` in `check`, `plan` and `apply` mode without an accepted change
asks the renderer to isolate (`isolateBlockedCapabilities`); the `docs` commands and `adopt` never
do.

- The blocked set is every capability the major change names: its P1 or P2 proof is unprovable,
  or its flow proof moved since the committed baseline without an accepted change. It is closed
  over the targets that depend on it: an `entity-summary` target whose node, or a node it stamps,
  is a member of a blocked capability is blocked, also when it depends on a clean capability too.
- Isolation applies only when every blocked capability kept its semantic fingerprint, so it is
  blocked by its proof alone and everything else classifies as `none`. Then the other targets are
  written as a drift repair without a receipt. The blocked documents are not written, and the
  manifest keeps the blocked targets' rows and the blocked capabilities' baseline entries byte for
  byte, so a later run classifies them against the same baseline. A blocked capability whose
  proof returns to its baseline needs no further write.
- `check` and `plan` return `planned-partial` and `apply` returns `applied-partial`, with
  `coverage { complete: false, blockedCapabilityIds, blockedTargets[{ targetId, path,
  capabilityIds, reasonCodes }], appliedTargetIds }`. A complete result omits `coverage`. A
  partial result carries no human action, no refresh signal and no apply receipt, and the
  contracts refuse a receipt or a complete status with `coverage`. A partial result is never
  acceptance: the complete render that `docs drift`, `complete` and `ledger accept-committed`
  use still reports the blocked capabilities.
- The whole run stays blocked when anything else stands in the way: a semantic change in a
  blocked capability, an added or removed capability, an accepted change, an adoption or
  ownership rejection, an orphan that needs review, a blocked document that is not exactly the
  output its row records, a manifest header from another renderer, profile, layout or CodeGraph
  version, or nothing else to write. Global failures (invalid or superseded manifest, invalid
  model, missing code facts, expected-snapshot or preimage drift) fail before classification.
- Capability `projection-capability-isolation-v1`. Partial writes that accept a semantic change
  with row-scoped receipts (Phase 2) are not implemented.

### 7. Per-target change classification

The rows and capability entries also answer "which documents does this change really affect"
(issue #327 finding 2, slice S4). `projection run` `check` and `plan` results carry `changes[]`,
one entry per target path over the current targets, the committed rows and the orphans; the
manifest is not a target.

- Each entry compares the target with the committed manifest: its row's `sourceStamps` and
  `outputDigest`, the `semanticFingerprint` of the capabilities it documents, and for a module
  document their `flowProofFingerprint` and `selectorEvidenceDigest`. No new fingerprint is
  computed. An unknown comparison (no v3 manifest, or no row for the target) is `null`, never
  `false`.
- `classification` is derived by one rule in the contracts package: blocked > baseline-missing >
  proof-change > semantic-change > output-change > stamp-only > unchanged. `stamp-only` requires
  unchanged output bytes and known, unchanged semantic and proof comparisons on a target nothing
  blocks.
- `plannedAction` is the result's `files[]` action for the path, the same decision `apply`
  commits, so the targets with a planned action are exactly the documents apply writes or
  deletes. `blocked` comes from the isolation's carried-forward targets (the `coverage`
  authority), review orphans and adoption or ownership rejections, and never plans a write.
- Classification is a report. It changes no status, write, receipt, gate, `staleNodes` or
  `projection freshness` answer.

## Consequences

- Branches that document different capabilities merge without manifest conflicts; model changes
  still conflict on `modelDigest`.
- Global digests that consumers read (`projectionDigest`, `sourceTreeDigest`) are recomputed from
  the rows. They equal the values the runtime reports for the same tree.
- Under `repo-harness/v1`, a component or module footprint change names that node in
  `staleNodes`.
- A capability blocked by its proof alone no longer stops the stamps and documents of the
  others; its own documents stay as committed until its flow is fixed or its change accepted.
- Every repository re-baselines once. A 0.7.x installation cannot read a v3 manifest, so all
  installations that project a repository upgrade together.
- Agent-context markers still carry a model-global `sourceDigest`; that is a separate change with
  its own agent-context renderer bump.
