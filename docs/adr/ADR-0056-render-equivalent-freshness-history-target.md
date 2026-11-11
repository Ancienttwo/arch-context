---
schemaVersion: archcontext.adr/v1
id: adr.0056.render-equivalent-freshness-history-target
title: Render-Equivalent Projection Freshness and the Complete Projection Manifest
status: proposed
decidedAt: 2026-11-11
appliesTo:
  - module.architecture-context.contracts
  - component.architecture-context.projection-renderer
  - component.architecture-context.core.review-engine
  - component.architecture-context.local-runtime.projection-service
  - component.architecture-context.local-runtime.projection-apply
  - component.architecture-context.local-runtime.runtime-daemon
  - component.architecture-context.surfaces.cli
supersedes: []
---

# ADR-0056: Render-Equivalent Projection Freshness and the Complete Projection Manifest

> **Status**: Proposed. The owner set the direction on 2026-11-11: projection freshness means "the committed documents would render differently" ([#535](https://github.com/Ancienttwo/arch-context/issues/535)), and `docs/architecture/history.md` becomes an engine-owned manifest target ([#536](https://github.com/Ancienttwo/arch-context/issues/536)). On the same day the owner decided that the model-designated agent-context contract files also become manifest rows, so the manifest lists every projection output.
> **Amends**: [ADR-0043](ADR-0043-agent-context-provider.md) Consequences (agent-context stays outside the docs drift pipeline only for the `default` profile); [ADR-0047](ADR-0047-projection-manifest-v3.md) §2, §3 and §7, and its consequence about agent-context markers; [ADR-0048](ADR-0048-projection-writer-rolling-pr.md) §5; [ADR-0049](ADR-0049-architecture-layers-and-runtime-topology.md) §6; the Projected row of [ADR-0050](ADR-0050-architecture-ledger-authority-matrix.md).
> **Freshness contract history**: [#259](https://github.com/Ancienttwo/arch-context/issues/259), [#327](https://github.com/Ancienttwo/arch-context/issues/327).

## Context

### Freshness keys on raw source bytes

Each entity-summary and runtime topology row of the committed manifest carries `sourceStamps`:
the content digest of every declared source footprint the target documents. The freshness
evaluator compares them with the footprint digests measured now, and the snapshot evaluator also
compares the source tree digest the rows imply. Any byte under a footprint moves a stamp.

The stamps are part of the manifest bytes, and the drift check compares manifest bytes. A source
edit that leaves every document byte-identical therefore has three effects:

- `check` reports `projection-manifest-stale` and `planned`;
- the `complete` gate raises both `projection-drift` and `stale-context`;
- `archctx projection publish` commits and pushes a manifest-only change.

In aimpact-inc/repo-harness, 7 of 14 projection pull requests in 48 hours were such stamp-only
changes. Under `repo-harness/v1` one capability row carries the stamps of every member component
(in this repository, one row with 49 stamps), so nearly every source commit rewrites it.

Skipping the publish of a stamp-only change, as #535 first proposed, does not remove the cause.
The base branch would keep stamps that no longer match, and every `check` and `complete` on it
would report drift until the next real output change.

The renderer already has the right identity. Each document is keyed on the digest of its own
rendered body, so every render input is covered without being listed, and each manifest row
records that `outputDigest`. The stamps are a second, coarser authority beside it.

### history.md lives outside the engine

The rolling writer renders `docs/architecture/history.md` from Git history after its apply and
writes the file itself. The file is not a manifest row. `verify-pr` skips it during
classification and re-renders it as a special case. A consumer that reads the manifest rows as the
list of projection outputs (repo-harness#2372) cannot tell that a writer pull request touched
generated output only.

Two facts constrain any history target:

1. The history is the first-parent log of `.archcontext/model` and `.archcontext/manifest.yaml`.
   A commit that changes the model is a milestone of its own history, and its SHA hashes the file
   that would have to list it. History rendered at HEAD therefore cannot be current in the commit
   that changes the model, nor on the base branch after a squash merge, until a later commit
   refreshes it.
2. The history reader refuses shallow clones (`history-shallow-repository`). `check`, `complete`
   and `docs drift` work in shallow CI clones today, because freshness never reads Git history.

### Contract files are outside the manifest

The model designates agent-context contract files (`AGENTS.md`, `CLAUDE.md`) for each capability.
Only `archctx agent-context apply` writes them. The rolling writer's apply is `projection run`,
which renders no agent context, so the writer does not write them today. `verify-pr` finds them
from the model rather than from manifest rows. Their marker carries a digest of the whole model,
so every model edit rewrites every contract file even when no region body changes.

## Decision

### 1. Freshness is render equivalence

A target is fresh when the `outputDigest` that the current render produces equals the
`outputDigest` of the committed row for that target. The projection is fresh when all of these
hold:

- every target is fresh;
- the current targets and the committed rows are the same set;
- the manifest that the complete render would write equals the committed bytes.

The committed manifest records no digest of raw source.

- There is one evaluator, in the projection engine, over a render plan. It compares the complete
  render's rows (`renderedTargets`, which an isolated plan keeps as well) with the committed
  manifest the render classified against. It reads the committed record, not the files, so a
  hand-edited document remains drift (`projection-generated-region-manually-edited`,
  `projection-generated-file-manually-edited`), as today.
- The result is `ProjectionFreshnessV2`: `ok`, `reasonCodes` and
  `staleTargets[{ targetId, path, committedOutputDigest, renderedOutputDigest }]`. A digest is
  `null` for a target that exists on one side only. The reason codes are:
  - `projection-manifest-missing` and `projection-manifest-unreadable`, unchanged;
  - `projection-output-changed`, reported exactly when `staleTargets` is non-empty;
  - `projection-manifest-changed`, when every output is equal but the semantic baseline or a
    header line that the render would write differs (a model edit that no document prints, a
    selector evidence change, another CodeGraph version).
- The engine evaluation is `archcontext.projection-freshness/v3`.
- Freshness that is not ok implies drift that is not ok. Drift keeps its wider scope: integrity,
  adoption, ownership and orphans.

### 2. Where freshness is computed, and at what cost

- `check` computes it from the build it already runs.
- `complete` runs one projection build (the committed profile, no isolation, no accepted change). Under `repo-harness/v1` that plan includes the contract files.
  That is the CodeGraph snapshot and render its drift half runs today.
  - `projectionDrift` and `projectionFreshness` both come from that plan.
  - The separate footprint pass is removed. It made a second Git listing, loaded the model again,
    resolved the footprints and re-hashed every one.
  - `complete` reads no Git history.
  - The `stale-context` finding, its id and its `review.failOn` switch are unchanged; only the
    shape of its input changes.
- `archctx projection freshness` runs the same build as `check` over the committed profile. It
  stays stateless (no daemon, no local store, no ChangeSet) and may sync CodeGraph, as
  `flows check` does.
- The `nodes` scope and `archctx projection freshness --changed-path` are removed. A changed path
  cannot tell whether a document renders differently: a selector sink outside the footprint, or a
  model file, can change a document whose footprint the path does not touch. The answer needs the
  render, and once the render has run, narrowing saves nothing.
- `archctx checkpoint --changed-path` is unchanged and never renders. It does not reach the
  freshness evaluator today; the only freshness callers are `projection-service.ts` and the
  `complete` gate. repo-harness calls it as an edit-time hook with a 3-second deadline
  (`src/effects/architecture/archctx-provider.ts:542` in aimpact-inc/repo-harness).
- The claim that `complete` does not get slower is measured, not assumed. The implementation
  records the wall time of `archctx complete` on this repository before and after the change.

### 3. Manifest v4

- `schemaVersion` is `archcontext.architecture-docs-projection-manifest/v4`, and v3 joins the
  superseded versions.
- A row holds `type`, `scope`, `path`, `ownership`, `format` and `outputDigest`.
  - `sourceStamps` and `scale` are removed. `scale` had no reader: the document prints the buckets
    and `outputDigest` covers them.
  - The rules on stamp ownership, equal topology stamps and `scale` presence go with them.
- At read time the manifest yields the flow proof digest and the projection digest. It yields no
  source tree digest.
- The byte layout of ADR-0047 §1 is otherwise unchanged. A source edit that changes no output, no
  proof evidence and no header line leaves the manifest byte-identical.

### 4. Contracts that follow from removing the stamps

- `ArchitectureDigestSetV2` drops `sourceTreeDigest`, because the base digests come from the
  committed manifest, which records no source state. The architecture refresh signal and the apply
  recovery binding move to v2.
- `ArchitectureProjectionProofEvidenceV2` drops `sourceStamps`.
- `ProjectionTargetChangeV2` drops `stampChanged`, the `stamp-only` classification and the
  `source-stamp-changed` reason, and `ProjectionResult` moves to v3. The classification order is
  blocked > proof-change > baseline-missing > semantic-change > output-change > unchanged.
- The runtime provenance and `ProjectionSnapshotV1` keep `sourceTreeDigest`. It binds the
  CodeGraph index and the expected snapshot to the measured tree and is never committed.
- `architectureProjectionFootprintOwners` remains the map from a node to the entity-summary
  target that documents it. Isolation and change classification read it instead of stamp keys.
  `projection-footprint-uncovered` is unchanged.
- The capabilities `projection-manifest-contract-v4`, `projection-check-freshness-v2`,
  `projection-freshness-v2` and `projection-change-classification-v2` replace their predecessors.

- `agent-context` rows (an existing type in `TARGET_TYPES`, `ProjectionTargetType` and
  `projection-target.schema.json`) must be `mixed`, `markdown` and entity-scoped with an id.
  Several `agent-context` rows may share a path when their scope ids differ. Every other path
  appears in exactly one row.
- A row's `outputDigest` is the digest its marker records:
  - `digestJson({ targetId, body })` for architecture-doc regions and whole files;
  - `digestJson({ id: scope.id, body })` for agent-context regions.

  Unifying the two would make every existing contract region read as hand-edited during the
  re-baseline.
- `AGENT_CONTEXT_RENDERER_VERSION` becomes `archcontext.agent-context-renderer/v2`, and its marker
  carries no `sourceDigest`.
- Under `repo-harness/v1`, `projection run` results list contract files in `files[]` and their rows
  in `changes[]`. An `agent-context` row documents the capabilities its node belongs to and renders
  no flow proof, so `proofChanged` is `false`.
- The failure vocabulary gains `agent-context-owned-by-projection`.
- `ProjectionRequestV1.targets` keeps `agent-context`, which selects nothing. Contract files render
  on every `repo-harness/v1` run, because their only input is the model. Only
  `architecture-history` selects an input.

### 5. Committed acceptance

A capability whose flow proof moved while its semantic fingerprint held is explained by the
journaled model when the renderer version and that capability's `selectorEvidenceDigest` are
unchanged. Member stamps no longer take part.

This holds because the selector evidence digest covers every non-model input the proof reads.
Verified on main e8ed2834 by reading the code; nothing was run.

- The proof (`compileSemanticCapabilityDiagrams`, `semantic-diagrams.ts:136-290`) reads the model
  and one non-model input: the selector evidence, read only in `validateStep` (`:335-337`).
- Of the evidence fields that `architectureSelectorProofStatus` reads (`:359-367`), every one that
  can change the outcome is hashed per entry by `proofRelevantSelectorEvidence` (`:444-459`):
  `nodeId`, `entrypointId`, `sourceSymbol`, `sinkId`, `matched`, `ambiguous`, `truncated` and
  whether call sites exist. Entries are sorted and duplicates are kept, so the entry count is
  covered too.
- The two lengths left out of the hash only choose between unproven statuses that map to the same
  diagnostic (`:349-351`).
- The digested set is the selectors that the capability's required flows cite (`:472-476`), the
  same set `validateStep` iterates.
- The proof reads no file contents, line counts or call-site positions.
- The renderer code is the only other non-model input, and `rendererVersion` covers it.
- A baseline without a `selectorEvidenceDigest` fails closed.

So a source edit that leaves the digest and the renderer version unchanged cannot have moved the
proof. The stamp clause (`committed-change-acceptance.ts:330`) refused acceptance only after edits
the proof never read. The evidence producer (`codegraph-adapter`) was not reviewed. The slice that
removes the clause checks that `matched`, `ambiguous` and `truncated` come only from CodeGraph
results.

### 6. Render inputs never read projection outputs

Scale signals subtract `projectionOwnedPaths`, as the footprint digests already do. A document or
contract file that the projection writes inside a footprint cannot move a scale bucket, so an apply
reaches its fixed point in one step.

### 7. Runtime topology

Topology rows carry no stamps. A change to a configuration file that a topology node lists no
longer reports anything, because the topology is model-authored and its render does not read those
files. This removes the re-verification signal of ADR-0049 §6. Moving that signal to code anchors
with a confirmed digest (ADR-0054 §7) and to architecture debt is a separate decision.

### 8. The history target

- **Identity.** Type `architecture-history`, targetId `projection_target.architecture.history`,
  scope `{ kind: "repository" }`, path `docs/architecture/history.md`, ownership `generated`,
  format `markdown`. The `repo-harness/v1` layout always includes it. The `default` layout does not
  change.
- **Input.** The input is the architecture history at the projection base commit: the first-parent
  history of `.archcontext/model` and `.archcontext/manifest.yaml` reachable from HEAD, as its last
  20 milestones and the total.
  - The local runtime reads it (`readArchitectureHistory`). The engine owns the window and renders
    it (`renderHistoryMarkdown`).
  - On any full clone the input is a function of the commit: SHAs, committer dates, subjects and
    the model at each milestone. The derivation cache is not an input.
  - A shallow clone is refused with `history-shallow-repository`.
- **Row.** The row carries no stamps. Its `outputDigest` proves that the projection wrote the file,
  as for every generated target.
- **When history is read.** `ProjectionRequestV1.targets` gains `architecture-history`. A render
  reads the history input when the request names that target, or when the committed manifest has
  no history row (adoption, the v4 re-baseline).
  - Otherwise it carries the committed row and bytes forward. The file must still match its row,
    it is not rendered again, and no Git history is read.
  - So `check`, `complete`, `docs drift` and an agent's `projection run` without that target stay
    shallow-safe and never rewrite the file.
- **Writer.** The writer names the target in its apply request, and the apply writes `history.md`
  through its ChangeSet. The writer no longer writes any file itself, so the ADR-0048 invariant
  that the writer never writes generated files holds without exception.
- **`verify-pr`.** `verify-pr` names the target in its `check`.
  - `history.md` is classified like every other manifest row, and its render equivalence comes
    from the check result. Both history special cases are removed; §9 removes the agent-context one.
  - For a writer pull request, the history at its head equals the history at its base, because the
    writer commit touches neither `.archcontext/model` nor `.archcontext/manifest.yaml`.

### 9. Agent-context contract files are manifest rows

- **Identity.** Under `repo-harness/v1` the layout includes one target for each contract file that
  `agentContextProjectionTargetPaths` derives from the model: two per capability, from its required
  `extensions.contractFiles`. `repo-harness/v1` requires `contractFiles` on every capability. Its
  layout parses each capability with `parseRepoHarnessNodeProfile` (`layout.ts:110-121`,
  `:131-132`), which throws when `contractFiles.agents` or `contractFiles.claude` is missing
  (`:85-87`). So the primary-source-directory fallback in `agentContextTargetPaths`
  (`layout.ts:180-187`) never applies under `repo-harness/v1`, and every contract file there has a
  row. The fallback serves only the `default` profile, where `archctx agent-context` stays the
  writer.
  - The row uses the existing type `agent-context`, with targetId
    `projection_target.agent-context.<agents|claude>.<node>`.
  - It has scope `{ kind: "entity", id, entityKind }`, ownership `mixed` and format `markdown`,
    the values the agent-context renderer already gives its targets.
  - No target type is added, and the `default` layout does not change.
- **Region and digest.** A row owns only its node's `BEGIN/END ARCHCONTEXT AGENT CONTEXT` region.
  Every other line in the file is human text, including other nodes' regions and other tools'
  blocks. `outputDigest` is the digest the region's marker records, `digestJson({ id, body })` over
  the region body, so the row and the marker agree. Two capabilities that designate the same file
  have one row each on that path.
- **Marker.** The marker keeps `id`, `rendererVersion` and `outputDigest` and drops `sourceDigest`;
  the agent-context renderer moves to v2. The model-global `sourceDigest` changed on every model
  edit and rewrote every contract file while every region body stayed the same. Architecture-doc
  markers dropped the same attribute in #327.
- **One render, one writer.** The render that writes the manifest renders the contract files.
  - `projection run`, `docs apply` and adoption write them in the same ChangeSet as the manifest,
    through a `render_agent_context` operation. The model-derived write scope and the canonical
    check for root contracts still apply to that operation.
  - A path that a row names has one writer. `archctx agent-context plan|preview|apply` refuses
    with `agent-context-owned-by-projection` when the committed manifest records an
    `agent-context` row.
  - In a repository whose manifest records no such row, the command is unchanged.
- **Drift and freshness.** A region follows the mixed-target rules of ADR-0047, read with the
  agent-context marker parser.
  - It is fresh when the rendered region digest equals the row's `outputDigest`. The region reads
    only its node's model facts, so a source edit never makes it stale.
  - An intact region with another marker is `projection-generated-region-stale`, and apply rewrites
    it.
  - A region whose body no longer matches its marker is
    `projection-generated-region-manually-edited`, and apply rewrites it, as it does module
    documents. The renderer no longer throws `agent-context-marker-output-digest-mismatch`, so one
    edited contract file is drift instead of an error that stops the whole projection.
  - A designated file without the node's region gets it appended
    (`projection-generated-region-missing`), and a missing file is created. The model's
    designation is the consent ADR-0043 already relies on, so no adoption is asked.
  - Duplicate, overlapping or malformed markers still fail closed.
- **Designation changes.** Rows follow the model.
  - A new designation adds a row and creates or appends the region.
  - A removed designation (capability removed or renamed, or `contractFiles` changed) removes the
    row from the layout. If the file still holds that node's region, the region is
    `projection-orphaned` with disposition `human-review`, and apply stops at
    `orphaned-document-review`. The write scope comes from the current model, so the projection
    never writes a path the model no longer designates. Once a human removes the region, the next
    apply drops the row.
  - The layout reads every path that a current or committed `agent-context` row names, so an
    orphaned region outside `docs/architecture/` is found.
- **`verify-pr`.** Classification reads manifest rows only.
  - An `agent-context` row contributes its scope id, and its human text is compared with
    `agentContextTextOutsideRegions`, as today.
  - The model-derived discovery of contract files and the separate agent-context render are
    removed. The `check` result covers contract files.
- **Writer.** The apply writes contract files when the model changes what a capability's region
  prints. They reach the rolling pull request through the existing filter: paths the apply wrote
  that are projection-owned. `PROJECTION_WRITER_TARGETS` (`projection-writer.ts:70`) already lists
  `agent-context` while `projection run` ignores it, and this section removes that inconsistency.
- **Generated-only verdict.** A rolling pull request may now touch root `CLAUDE.md` and `AGENTS.md`.
  `verify-pr` classifies those paths as `agent-context` rows, so a writer pull request that changes
  only their regions still gets `generated-only-render-equivalent`. A consumer's documentation-mode
  CI keyed on that verdict still applies.
- **Acceptance of the implementing slice.** Before its pull request, the slice proves two points by
  test:
  - a ChangeSet that carries both `render_projection` and `render_agent_context` passes the
    root-contract canonical check at apply;
  - an orphaned contract region outside `docs/architecture/` stops the request at
    `orphaned-document-review`, as described above.

### 10. Writer runs with nothing to publish

The code path is unchanged. When the apply leaves no changed path, the run ends `up-to-date` and
records the base as the last processed and last successful SHA, with no commit, so the next run at
the same base is `already-processed`. Under v4, a base that advanced by source edits alone ends
this way. There is no flag and no new reason field. Under `repo-harness/v1` the apply also writes contract files (§9).

### 11. Migration

The migration is one operator-invoked re-baseline through the ADR-0047 §5 mechanism. It fails
closed, and no v3 reader remains.

1. On 0.13.x, reach a clean fixed point (`check` = `noop`), drain pending apply receipts, close any
   open rolling projection pull request, and remove `archctx agent-context apply` from automation.
   aimpact-inc/repo-harness runs it nowhere (not in src, scripts, .github, docs or assets), so for
   that consumer this step is documentation only.
2. Upgrade every installation that projects the repository together. 0.13.x refuses a v4 manifest
   as an unsupported schema.
3. On an up-to-date checkout of the base branch, run
   `archctx docs apply --approved --profile <profile>`.
   - It treats the v3 manifest as absent and writes v4 rows.
   - Under `repo-harness/v1` it renders `history.md` from Git history and rewrites every contract
     region with the v2 marker.
   - A contract region whose body no longer matches its marker is reported manually edited and
     rewritten. Review the contract-file diff before committing.
   - If the existing `history.md` differs from its render, the apply refuses it as
     `projection-ambiguous-ownership`. Remove it with `git rm` and run the apply again.
4. Commit the result. The writer resumes.

The contracts package takes a breaking minor change in 0.14.0.

## Invariants

- The committed manifest holds no digest of raw source. A source edit that changes no rendered
  output, no proof evidence and no header line leaves the manifest and every projected file
  byte-identical: `check` is `noop`, freshness is ok, and the writer ends `up-to-date`.
- `check`, `complete` and `projection freshness` answer freshness with one evaluator over one
  render, so they cannot disagree on the same tree. Freshness that is not ok implies drift that is
  not ok.
- No render input reads a projection-owned path.
- A marker records only its target, its renderer version and its own output digest.
- Under `repo-harness/v1`, every file a projection run can write is named by a current manifest
  row, and a path a row names is written only by the ChangeSet that writes the manifest.
- The projection never writes a path the current model does not designate. An orphaned contract
  region is left for a human.
- `archctx checkpoint --changed-path` never renders and keeps its current behavior.
- `check`, `complete` and `docs drift` never read Git history. Only a run that names
  `architecture-history`, or a run without a committed history row, reads it, and that run fails
  closed on a shallow clone.
- The writer writes no file itself. Every path it publishes is one its apply wrote.

## Non-goals

- `check` and `complete` do not check `history.md` for freshness against HEAD. Only a run that
  names the target compares the file with the current history.
- There is no re-verification signal for topology configuration files. It is a follow-up under
  ADR-0054.
- The `default` layout does not change. It gains neither the history target nor agent-context
  rows, and `archctx agent-context` keeps writing contract files in a repository whose manifest
  records no `agent-context` row.
- The projection does not remove an orphaned contract region.
- Nothing replaces `--changed-path`.

## Consequences

- Stamp-only commits, pull requests and CI runs stop.
- `complete` makes one fewer full pass over the footprints, and `check` costs the same.
- Under `repo-harness/v1`, `check` and `complete` also report contract-file drift. A model edit to
  what a capability's region prints, including its `extensions`, needs a projection apply before
  `complete` passes.
- `projection freshness` becomes a rendering read that may sync CodeGraph. `docs/spec.md` drops
  "Freshness uses its accepted non-rendering stamp path".
- A model edit that changes no document still changes `semanticBaseline.modelDigest` and is
  published as a manifest-only change. It no longer rewrites contract files.
- Under `repo-harness/v1` the manifest lists every file the projection writes: architecture
  documents, `history.md` and contract files. A consumer can classify a writer pull request from
  the manifest alone (repo-harness#2372).
- Removing a capability or its contract designation needs a human to remove its region. Until then
  the writer stops at `human-action-required`.
- Automation that runs `archctx agent-context apply` in a `repo-harness/v1` repository must stop.
  The command refuses once the manifest records `agent-context` rows.
- `verify-pr` reads the full architecture history on every generated-only pull request. It needs a
  full clone, as its merge base already does. A consumer that runs `verify-pr` in a shallow CI
  checkout must deepen it before 0.14.0. The history slice names the consumer's fetch depth
  (repo-harness#2372) in its pull request.
- Every repository re-baselines once, the re-baseline rewrites every contract region's marker once,
  and all installations that project the repository upgrade together.

## Rollout

1. Render-equivalent freshness and manifest v4 without the history target. This covers the
   contracts, schemas, engine, `complete`, `check`, `projection freshness`, change classification,
   committed acceptance, the CLI and the migration runbook.
2. The history target: target type, layout, request target, engine input, writer and `verify-pr`.
3. Agent-context rows: layout, engine render and drift rules, marker v2, the ChangeSet operation,
   the `agent-context` command refusal, `verify-pr` and the writer.
4. Release 0.14.0. Slices 2 and 3 land after slice 1 and before the release, so v4 ships with every
   row from the start.
