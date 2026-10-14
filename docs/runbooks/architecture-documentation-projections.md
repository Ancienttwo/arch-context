# Architecture Documentation Projections Runbook

## Ownership

- `.archcontext/projections/targets.json` declares placement rules.
- `docs/architecture/.projection-manifest.json` records the renderer, profile, layout and CodeGraph package and version in a header, the one Git-visible model anchor `semanticBaseline.modelDigest`, the semantic baseline of each capability, and one row per projection target. It records only machine-independent content digests. The model-global source digest, the provenance block, the global projection, receipt and source tree digests and the target and file counts are not committed: a reader computes the projection digest (renderer, profile and every row's `outputDigest`) and the declared source tree digest (every row's `sourceStamps`) from the rows when it needs them. The CodeGraph evidence digest, index state and status, HEAD and worktree digest are per-run facts returned as `runtimeSnapshot` and never committed, so two machines projecting the same commit write the same manifest (ADR-0047).
- The manifest's shape is published in archctx-contracts: the `ArchitectureDocsProjectionManifestV3` type, the `architectureDocsProjectionManifestIssues` check, and `schemas/runtime/projection-manifest.schema.json`. The `schemaVersion` is `archcontext.architecture-docs-projection-manifest/v3`, and consumers detect it through the `projection-manifest-contract-v3` capability. The renderer validates every manifest it writes against that contract and reads a committed manifest back only through it: a manifest that fails the contract is refused with `projection-manifest-invalid` (restore it from Git), and a v1 or v2 manifest with `projection-manifest-upgrade-required` (see "Upgrading from archctx 0.7.x").
- The byte layout keeps independent changes on separate lines, so two branches that change different capabilities merge without a conflict. The header lines change only on a protocol upgrade. Each capability entry (`capabilityId`, `memberNodeIds`, `semanticFingerprint`, `flowProofFingerprint`, `proofStatus`, `facets`, `selectorEvidenceDigest`) is its own block, sorted by id. `targets` is keyed by targetId: the key is on one line and the row is one JSON line under it, with keys in the order `type`, `scope`, `path`, `ownership`, `format`, `outputDigest`, then `sourceStamps` and `scale` where they apply. Two branches that change the model still conflict on the `modelDigest` line, on purpose: the merged model needs its own projection.
- Each declared source footprint (`source.include`) is stamped on the row of its nearest ancestor-or-self node that has an `entity-summary` target under the active profile. The `default` profile gives every node a module document, so every node stamps its own footprint. `repo-harness/v1` gives only capabilities a module document, so a component or module footprint is stamped on its capability's row. `sourceStamps` maps each stamped node id to its footprint content digest. A row whose own node declares a footprint also carries `scale: { fileCountBucket, lineCountBucket }`. A bucket is the half-open 1–2–5 range `{ lower, upper }` that contains the measured count (`{ lower: 0, upper: 1 }` holds only zero). The module document prints exactly these buckets, never the counts. A declared footprint with no such node fails the projection with `projection-footprint-uncovered` and the node ids; give the node or an ancestor a module document, or remove its `source.include`.
- Text inside `ARCHCONTEXT:generated` markers is generated projection output. Only Markdown documents (`mixed` targets) carry markers. A marker records `target`, `rendererVersion` and the `outputDigest` of its region body, and no source digest, so a model change that leaves a region's output unchanged leaves its document unchanged. Drift first checks that the region body still matches the marker's `outputDigest` (`projection-generated-region-manually-edited` when it does not), then compares the marker with the one this render writes (`projection-generated-region-stale`).
- Whole-file outputs (`generated` targets: `diagrams/architecture.mmd`, `architecture.structurizr.json`, `architecture.likec4`) carry no marker, so each file is valid in its own format. The manifest row's `outputDigest` (`digestJson({ targetId, body })`) proves ownership. Bytes equal to the current render are fresh. Bytes equal to the committed row are `projection-generated-file-stale`. Any other bytes under a committed row are `projection-generated-file-manually-edited`, and apply writes the rendered file back. Without a committed row, a file that differs from the render is `projection-ambiguous-ownership` and is never overwritten. An orphaned whole-file output is a committed row whose target the current layout no longer renders at that path.
- Generated bodies print no wall-clock or run time. The architecture index has no `Generated:` line.
- Text outside generated markers is human-owned and must be preserved.
- Agent-authored rationale or ADR prose is advisory draft material until deterministic validation and explicit approval.

## Normal Flow

archctx requires a Git worktree. Outside one, projection commands fail with `AC_REPO_NOT_FOUND` (`reasonCode: "git-worktree-required"`).

1. Run `archctx docs drift`.
2. If drift exists, run `archctx docs plan --id <changeset-id>`.
3. Review the ChangeSet preview paths and generated-region changes.
4. Apply with `archctx docs apply --approved --id <changeset-id> --expected-worktree-digest <digest>`.
5. Run `archctx docs drift` again.
6. Run `archctx complete` only after projection drift is clean.

The `docs` commands use the profile of the committed manifest when you do not give `--profile`. A repository without a manifest uses `default`. Give `--profile` only to select a different layout, and give the same value to `plan` and `apply`. `apply` renders the projection again and does not read the profile of the planned ChangeSet.

### Module document language

A new module document gets a skeleton outside the generated region: the title and empty `## 3`, `## 4` and `## Optimization Backlog` headings. Set `docs.language` in `.archcontext/manifest.yaml` to select the language of the title and the `## 3` and `## 4` headings:

```yaml
docs:
  language: zh-Hans # zh-Hant, zh-Hans or en
```

Without `docs.language`, the renderer writes the headings of earlier releases (`## 3. P3:設計決策與不變量`). Any other value fails the projection with `architecture-docs-language-invalid`. The setting applies only to a module document that does not exist yet. The projection never rewrites the skeleton of an existing document, so a change of the setting does not change existing headings. To change them, edit them by hand: they are outside the generated region. The generated region (the intro, `## 1` and `## 2`) stays in Traditional Chinese.

`complete_task` validates active documentation projections when `docs/architecture/.projection-manifest.json` exists. A successful completion must have projection drift count zero.

### Checking citations in human-owned text

Drift and `freshness.staleNodes` cover only generated regions. To check the citations in human-owned text, run `archctx docs anchors --json`. It reads the module document of each node (text outside the generated markers) and the node `summary` and `responsibilities`. It returns `archcontext.docs-anchors/v1` (`schemas/runtime/docs-anchors.schema.json`) with findings per node. Consumers detect the command through the `docs-anchors-v1` capability.

- The command is read-only. It runs in-process, starts no daemon and writes no runtime state. It uses the profile of the committed manifest unless you give `--profile`.
- It is a signal, not a gate. The envelope stays `ok` when it has findings. It does not change drift, freshness or `complete`.
- Only inline code spans are citations. Fenced code blocks, HTML comments and generated regions are not read. A backslash-escaped backtick does not open a code span.
- `missing-path`: a cited `path` is not in the Git-visible tree. A bare path is reported only when its first segment is a top-level entry, and a gitignored path is never reported.
- `unknown-selector`: a selector `<id>#symbol`, such as `entrypoint.cli.main#runCli`, whose id is not a selector id of the model but starts with the same first segment as one. The selector ids are the node ids, the `source.entrypoints[].id` and `symbols[].sinks[].id` values, and the flow ids. A selector with a known id is valid and its symbol is not checked. A token that names a file in the tree, or a path suffix of one, is a path. `owner/repo#number` is not a citation: a symbol citation of a path without a file extension and with a first segment that is not a top-level entry is ignored.
- `line-out-of-range`: `path:line`, `path:start-end` or `path#L12` points past the end of the file. The finding gives `lineCount`.
- `missing-symbol`: the file of `path#symbol` does not declare the symbol, or no current source file contains the name of a call-shaped `name()`. The index is not used for this check, because it can be stale after a rename or a delete. A plain identifier such as `name` is never reported missing.
- `line-moved`: `path:line` binds a symbol when an identifier span directly follows or precedes it, for example `` `runtime.ts:277` (`assertFoo`) ``. When the line is outside every declaration of that symbol, the finding gives the symbol's current start lines in `currentLines`. A bare `path:line` can only be `line-out-of-range`.
- A path in an explicit form that is not found at the root, such as `route-registry.ts:52`, resolves by path suffix, first inside the node's source footprint. When more than one file matches, the citation is `unchecked` with `path-ambiguous`.
- Symbols are parsed from the current file contents through CodeGraph, so a stale index does not move a line. The command opens the CodeGraph index read-only and never opens it writable. SQLite can create the index WAL files for a read-only open. When no index exists, `codeGraph.reasonCode` is `index-missing`. When the read-only open fails, it is `index-open-failed`. In both cases path and line checks still run, `codeGraph.availability` is `unavailable`, and every symbol check is `unchecked` with `codegraph-unavailable`. A symbol in a file that CodeGraph cannot parse is `unchecked` with `language-unsupported`, and its line is still checked.

Fix the stale text by hand in a pull request. The command does not rewrite documents.

### Missing code facts

When `.archcontext/manifest.yaml` declares `codeFacts.required: true` and the repository has no CodeGraph index (`.codegraph/`), the projection is not rendered at all. `complete_task` (CLI `archctx complete`), the `docs` commands and `projection run`, `readback` and `recover` all fail with `AC_CODE_FACTS_UNAVAILABLE`: retryable, `error.reasonCode: "index-missing"`, `error.action: "codegraph-init"`. This is an environment state, not projection drift or a major change. Map `error.action` to a command, never the message:

| `error.action` | Do this |
| --- | --- |
| `codegraph-init` | Run `codegraph init` in the repository root, then retry the same call. |

A repository that cannot build an index declares `codeFacts.required: false`; projections then render without code facts.

Consumers detect the typed error through the `code-facts-unavailable-error-v1` capability. A build without it renders a projection with a missing index and reports a flow-proof major change for every capability instead.

### Checking flow selectors before a projection

Run `archctx flows check --json` before an apply when you add or change an entrypoint selector or a flow. It takes seconds; an apply can take more than a minute. It runs the same P2 flow proof as a projection and renders nothing. It runs in-process, starts no daemon, opens no local store and writes no runtime state. Like `projection run` in `check` mode, it runs `codegraph sync` first.

The result (`archcontext.flow-selector-check/v1`, `schemas/runtime/flow-selector-check.schema.json`) lists every declared selector with a `status` and the flow steps that use it. Only `proven` binds a flow step.

| `status` | Meaning | Do this |
| --- | --- | --- |
| `proven` | One exact `calls` edge from the source symbol to the sink symbol. | Nothing. |
| `no-direct-call` | The source does not call the sink. For example, the call goes through an injected dependency. | Select the function that makes the call. |
| `only-references` | The source passes the sink as a value; it does not call it. | Select the function that calls the value. |
| `false-builtin-call` | The only call carries a runtime built-in name (for example `resolve` or `existsSync`), and the source file does not import the sink file. CodeGraph matched a Node built-in to a repository function. | Select a real call. |
| `ambiguous-symbol` | The source or the sink name has more than one declaration in its file. | Rename one declaration, or select another symbol. |
| `evidence-missing` | No evidence. Usually the CodeGraph index is missing. | Run `codegraph init`. |
| `evidence-truncated` | The evidence is incomplete. | Report it; this producer does not truncate today. |

`ok` is `false` when a capability that declares a flow has an unprovable P2 proof. `capabilities[]` shows the same P2 status and diagnostics that a projection records. A selector that no flow uses can be unproven and `ok` can still be `true`; `summary.usedUnproven` counts only the selectors that a flow uses. Consumers detect the command through the `flow-selector-check-v1` capability.

A built-in-named call is accepted only when the source file imports the sink file through a relative specifier. A call through a package alias or a re-exporting barrel is not proven this way. A call inside the sink file needs no import.

## Upgrading from archctx 0.7.x

The next release after 0.7.x changes the committed projection manifest to `archcontext.architecture-docs-projection-manifest/v3` (ADR-0047). A v1 or v2 manifest is read only for its `schemaVersion`. Nothing else in it is read or translated, so its profile, semantic baseline and stamps carry nothing into the new release. Every command that reads the committed manifest (`archctx docs drift`, `docs plan`, `projection run`, `complete`, `ledger accept-committed`) refuses it with `AC_PRECONDITION_FAILED` and `reasonCode: "projection-manifest-upgrade-required"`. Only `archctx docs apply --approved` re-baselines it.

The re-baseline renders the current model as the new semantic baseline. It does not classify the model against the old baseline, because that baseline is not read. Reach a clean fixed point on 0.7.x first, so that the re-baseline accepts nothing that was not already reviewed.

Release note:

- Before upgrading, reach `projection run` `check` = `noop` on 0.7.x, with `archctx docs drift` clean, and drain every pending apply receipt with `projection recover`. A receipt written by 0.7.x names renderer `archcontext.docs-renderer/v5`, so after the upgrade it fails closed on recovery and replay (`current renderer, layout, or CodeGraph provenance differs from the approved result`), and its refresh signals can no longer be delivered.
- archctx-contracts takes a breaking minor change. `ArchitectureDocsProjectionManifestV2`, `ArchitectureProjectionSemanticBaselineV1`, `ArchitectureProofEvidenceDigestsV1`, `architectureProjectionSemanticBaselineIssues`, `architectureDigestSetIssues` and `architectureSemanticStateIssues` are removed, and `ArchitectureDocsProjectionManifestV3` replaces them. The freshness reasons `projection-snapshot-provenance-missing` and `projection-source-stamp-invalid` are removed. The capability `projection-manifest-contract-v2` is replaced by `projection-manifest-contract-v3`. New reason codes are `projection-manifest-upgrade-required`, `projection-manifest-invalid` and `projection-footprint-uncovered`.
- Upgrade `archctx` and `archctx-contracts` together, on every installation that projects the repository, at the same time. A 0.7.x installation cannot read a v3 manifest.

Do these steps once per repository:

1. On 0.7.x, accept any committed model change ("Accepting Committed Model Changes"), apply, and confirm that `projection run` in `check` mode returns `noop` and `archctx docs drift` is clean.
2. Recover every in-flight projection apply receipt with `projection recover` (see "Choosing a requestId").
3. Upgrade `archctx` and `archctx-contracts` on every installation that projects the repository.
4. Run `archctx docs drift`. It fails with `projection-manifest-upgrade-required`.
5. Remove the whole-file outputs that 0.7.x wrote with a renderer v5 marker: `git rm docs/architecture/diagrams/architecture.mmd docs/architecture/diagrams/architecture.likec4 docs/architecture/diagrams/architecture.structurizr.json` (the paths your layout uses). If you skip this step, `docs apply` refuses with `AC_PRECONDITION_FAILED` and `reasonCode: "projection-ambiguous-ownership"`, writes nothing, and names the files in `error.details.paths`, with `error.details.action: "remove-whole-file-outputs-and-reapply"` and the exact `git rm` and re-run commands in `error.details.commands`. Ownership of a whole-file output is proven only by a v3 manifest row, and the v2 rows are not read, so the re-baseline never overwrites these files in place. The next step writes them again.
6. Re-baseline once: `archctx docs apply --approved --profile <default|repo-harness/v1>`. Give the profile the 0.7.x manifest recorded; the v2 manifest is not read for it. If the run fails with `projection-footprint-uncovered`, give the named node or an ancestor a module document, or remove its `source.include`, and run the step again.
7. Run `archctx docs drift` again and confirm that it is clean, and confirm that `projection run` in `check` mode returns `noop`.
8. Commit the removed and rewritten outputs and the manifest in one commit.

A repository still on 0.6.3 upgrades to 0.7.x first and follows that release's "Upgrading from archctx 0.6.3", then follows these steps.

Freshness compares every stamp in the manifest rows with the footprint digest measured now. Every declared footprint has a stamp, on the row of its nearest ancestor-or-self node with a module document, so a changed file inside any declared footprint names that node in `staleNodes`. `reasonCodes` then also contains `projection-source-tree-digest-mismatch`, because the declared source tree digest is computed from all the stamps.

## Accepting Committed Model Changes

When `archctx docs drift` reports `majorChange.mode: human-action-required` after model edits, accept those edits through the committed ChangeSets that made them. Do not re-baseline with a manual `docs apply --approved`.

1. Make every edit to `.archcontext/model/{nodes,relations,flows}/*.yaml` through ChangeSets (`archctx apply --approved …`). Each apply returns a `journalId`, and the journal records a digest-only model transition `{before, after}`. A hand edit records nothing, so it breaks the chain.
2. Preview:
   ```bash
   archctx ledger accept-committed --journal <journalId>=<changeSetId> [--journal …]
   ```
   List the journals in commit order. One journal can also be passed as `--journal-id <id> --changeset-id <id>`. Leave out journals that wrote no semantic model file, such as waivers or docs.
   The preview returns only `plan`, `acceptancePlanId` and `expectedWorktreeDigest`. It never returns an `acceptedChange` tuple, so nothing from a preview can drive a projection run.
3. Review the plan before approving:
   - reason codes and affected node ids;
   - `directlyEditedNodeIds`, `affectedAncestorNodeIds` and `carriedNodeIds`;
   - the journal chain from the projection manifest baseline to the current model;
   - `baselineAnchor` and `baselineAnchorRef`: the manifest is trusted only when its bytes equal the blob committed at HEAD (`head`, with the commit sha), or exactly what the latest journaled write of that path in this root produced AND that journal carries the daemon's projection-owner marker (`journal`, with the journal id). Only drafts planned by the daemon's projection commands (docs, projection and agent-context, such as `archctx docs apply|adopt` and `archctx projection run`) carry the marker, wherever they are later applied. A manifest journaled by any other approved ChangeSet, including a caller-authored `render_projection`, or by a build from before the marker existed, anchors nothing: commit the manifest, or re-baseline with `archctx docs apply --approved`. Replace refs are ignored; the HEAD sha is resolved once and is also the scope HEAD of the event.
4. Approve with the ids the preview returned:
   ```bash
   archctx ledger accept-committed --journal … --approved --acceptance-plan-id <acceptancePlanId> --expected-worktree-digest <expectedWorktreeDigest>
   ```
   The daemon recomputes the plan under the writer lock. Any change since the preview refuses the approval, because it changes the plan id. This includes a new HEAD commit and a re-baseline of `docs/architecture`. Only a successful approval returns the `acceptedChange` tuple. The approval appends a record-only `architecture.changeset.accepted` event. The event carries payload `archcontext.accepted-committed-change/v2`, has `operations: []`, and does not change ledger graph authority.
   There is one event per baseline model, current model and ledger scope (repository, worktree, HEAD and worktree digest). Re-running an approval with the same `acceptancePlanId` returns the recorded tuple (`replayed: true`), for example after a crash past the append. A different journal list for the same models at the same snapshot is refused.
5. Pass the returned `acceptedChange` tuple unchanged as `ProjectionRequestV1.acceptedChange` to `archctx projection run`. A successful run records the apply receipt and delivers one refresh signal. `archctx projection recover` with the same receipt then reports `already-delivered`.
6. Run `archctx docs drift` again and confirm it is clean.

Acceptance is refused when any of these is true:
- the journal chain does not start at the manifest baseline or does not end at the current model;
- a listed journal is pending, aborted, from another root, or out of order;
- the manifest matches neither HEAD nor the latest projection-owned journaled write (commit it, or re-baseline with `archctx docs apply --approved`);
- the manifest or a semantic model file is not valid UTF-8;
- a node file is not stored as `nodes/<id>.yaml` or `nodes/<id>.yml`;
- a semantic model file or a path segment is a symlink or other non-regular file;
- a capability proof is unprovable;
- the projection has rejected (adoption or ownership) entries;
- a capability's flow proof changed while its semantic fingerprint did not, and for that capability the renderer version, its `selectorEvidenceDigest` (the proof-relevant evidence of the selectors its required flows cite, call-site lines excluded) or the stamp of one of its baseline `memberNodeIds` moved since the baseline was rendered. The check runs per capability, so a source change in one capability does not refuse an unrelated proof change in another;
- the manifest is a v1 or v2 manifest (`projection-manifest-upgrade-required`; see "Upgrading from archctx 0.7.x") or fails the v3 contract (`projection-manifest-invalid`);
- a different acceptance event already exists for the same snapshot.

In each case, fix the cause and preview again. A hand edit is fixed by reverting it, or by replaying it as a ChangeSet.

Trust boundary: the HEAD anchor trusts local git history. Anyone who can commit locally, including via `--amend` or on a detached HEAD, can anchor a manifest; the accepted event records which commit or journal anchored it. The event is an informational record, not an enforcement gate: `projection run` treats `acceptedChange` as opaque. Enforcement waits on the deferred consumer-side resolver in `tasks/todos.md`.

### Accepting the observed major change in one request

An agent that owns the decision, with the pull request review as the human gate, can skip the `ledger accept-committed` round trip. Set `acceptObservedMajorChange: true` on a `mode: "apply"` or `mode: "adopt"` request. The field is refused (`AC_SCHEMA_INVALID`) in `check` and `plan` mode, with any value other than `true`, and together with `acceptedChange`.

With the flag, `projection run` classifies the major change at `expected` and applies it in the same run against the same expected snapshot. The daemon re-checks that snapshot under its writer lock before the ChangeSet writes, so a change after classification to the inputs the worktree digest covers fails the apply instead of committing an unreviewed change. `docs/architecture/` is not covered by that digest. The run therefore renders the accepted change against the documents and projection manifest it read at classification, not a later copy, so the applied change is the one the receipt records. The apply receipt records the observed change as `applyReceipt.acceptedChange`, with a `changeSetId` (`changeset.observed-major-change-<hash>`) and `eventId` (`projection_event.observed_major_change.<hash>`) that the provider derives from the snapshot and the change. No ledger event is appended.

When the run observes no major change, the flag does nothing and the request is a plain apply. When a capability proof (P1 or P2) is unprovable, the change cannot be accepted and the flag is declined: the result is `human-action-required` with `majorChangeAcceptance: "declined-unprovable-proof"`, and `humanActions[]` carries `reasonCode: "unprovable-required-flow"` with the ids of the capabilities whose proof is unprovable, in place of `unresolved-major-change`. Do not retry the flag; fix the named flows or relations first. When every capability that blocks the run is blocked by its proof alone, the run applies the other targets anyway and returns `applied-partial` instead, without `majorChangeAcceptance` (see "Partial results"); otherwise the decline blocks the whole apply. `majorChangeAcceptance` is absent whenever the request did not send the flag. It also appears only on a `human-action-required` result, so other stops take precedence over it: in `mode: "apply"`, a projection that needs adoption returns `adoption-required` (with its `adoption-required` action, without `majorChangeAcceptance`) even when the flag was declined; in `mode: "adopt"`, a projection that needs no adoption and has no drift returns `noop`, also without the field. Without the flag, a major change still stops at `human-action-required`. Consumers detect the field through the `projection-observed-major-change-acceptance-v1` capability.

To read back such an apply, send `projection readback` the original request with `acceptObservedMajorChange` replaced by the committed `applyReceipt.acceptedChange`. A caller that lost the result never saw that `acceptedChange`; it gets the complete readback request from `AC_PROJECTION_APPLY_COMMITTED` (below).

### Partial results: capabilities blocked by their proof

`projection run` in `check`, `plan` and `apply` mode, without an `acceptedChange`, isolates capabilities that are blocked by their flow proof alone (#327, ADR-0047 §6, Phase 1). A capability is blocked when its P1 or P2 proof is unprovable, or when its flow proof moved since the committed baseline and no change accepted it. The run isolates them only when every blocked capability kept its semantic fingerprint (no model change in it) and every other capability classifies as `none`. It then applies all other targets as a drift repair and carries the blocked targets forward. A target is blocked when its node, or a node it stamps, is a member of a blocked capability; a target that depends on a blocked and on a clean capability is blocked.

- `check` and `plan` return `status: "planned-partial"`; `apply` returns `status: "applied-partial"`.
- The result carries `coverage: { complete: false, blockedCapabilityIds, blockedTargets, appliedTargetIds }`. Each blocked target is `{ targetId, path, capabilityIds, reasonCodes }`: the blocked capabilities it depends on, and why they block it (`unprovable-required-flow`, `verified-flow-proof-changed`). `appliedTargetIds` are all other targets. A result that covers every target omits `coverage`; `complete` is never `true`.
- `files[]` never names a blocked target. The blocked documents are not written, and the manifest keeps the blocked targets' rows and the blocked capabilities' baseline entries byte for byte, on a CRLF checkout too. The other rows, entries and documents are rendered from the current model and sources.
- A partial result has no `humanActions`, no `refreshSignals` and no `applyReceipt`. A partial apply is a drift repair: it commits a ChangeSet without a receipt, so a repeat of the same request is not a replay, and the write shows up only in `priorCommittedApplies`.
- A partial result is never acceptance. With nothing else left to write, the next run returns `human-action-required` for the blocked capabilities. `archctx docs drift`, `archctx complete` and `archctx ledger accept-committed` keep reporting or refusing them, and freshness keeps naming their stale nodes, because their stamps were carried forward.
- To finish, fix the named flows or relations. A capability whose fixed proof equals its committed baseline needs nothing more: the carried baseline makes the run a clean fixed point. A proof that moved and still holds is accepted like any major change (`acceptObservedMajorChange`, or `ledger accept-committed`).

The whole run stays blocked, exactly as without isolation, when a blocked capability also changed semantically, when a capability was added or removed, when the request names an `acceptedChange`, in `adopt` mode, when there is an adoption or ownership rejection or an orphan that needs review, when a blocked document is missing or its machine region was edited, when there is no committed v3 manifest or its header names another renderer, profile, layout or CodeGraph version, and when nothing outside the blocked capabilities needs writing. Global failures still block everything: an invalid or superseded manifest, an invalid model, missing code facts and an expected-snapshot mismatch fail the run before it classifies. Partial writes of accepted semantic changes with row-scoped receipts are not part of this release. The `docs` commands never isolate. Consumers detect partial results through the `projection-capability-isolation-v1` capability.

### Repeating an accepted apply

A caller that lost the response of an accepted `apply` or `adopt` (process kill, timeout, closed pipe) sends the same request again. If its `requestId` and request digest match a committed receipt, `projection run` returns the committed `ProjectionResultV2` with `replayed: true` and applies nothing. The replay key is the `requestId` plus the digest of the request exactly as the caller sent it, including `acceptObservedMajorChange`. It never includes provider-generated ids. `replayed` is excluded from `receiptDigest`, so the replay carries the committed receipt digest. If the first run committed but never delivered its refresh signals, the replay reports `applied-reconcile-required` with no signals; deliver them with `projection recover` and the `applyReceipt` `lookupKey` and `applyId`.

A replay first runs the proof `projection readback` runs on the projection-owned outputs, and says whether it wrote with `written`, which is present exactly when `replayed` is and is also excluded from `receiptDigest`:

- `written: false`: the replay wrote nothing. Either the proof passed (the outputs are the committed fixed point), or HEAD or the projection worktree digest moved since the approved `expected` snapshot, in which case nothing is proven and the committed result is returned as recorded.
- `written: true`: the snapshot still equals the approved one but the outputs differ from the approved result, for example after `git checkout -- docs/architecture`. The replay rendered the approved change again and wrote its fixed point through a ChangeSet (`changeset.docs-projection-restore-<applyId prefix>`, journaled under the receipt's `requestId`) under the original receipt. The receipt, its delivery checkpoint and its refresh signals are unchanged. The replay reports `written: true` only after `projection readback` proves the receipt again against the restored outputs; if that proof fails, the replay returns the readback failure instead.
- If the outputs differ at the approved snapshot and the new render does not reproduce the receipt's resulting digests and owned-output digest byte for byte (a human edit inside `docs/architecture/`, another renderer or layout), the replay fails with `AC_PRECONDITION_FAILED` ("cannot be restored") and writes nothing. Revert the edit and replay again.

Do not read a replay as a fresh apply: `written` says whether this response changed files. Consumers detect `written` and the restore through the `projection-apply-replay-restore-v1` capability.

A different request under a committed `requestId`, or a new request for an accepted change that is already applied, fails with `AC_PROJECTION_APPLY_COMMITTED` (not retryable, action `readback-committed-projection-apply`). `error.reasonCode` is one of:

- `projection-apply-request-differs`: the `requestId` already committed a different request. Send the new request under a new `requestId`.
- `projection-accepted-change-committed`: the accepted change was already applied under the `requestId` in `error.details`. Before it refuses, `projection run` proves the committed outputs like a replay does: `error.details.written` is `true` when they differed at the approved snapshot and were written again under the original receipt (and readback proved the receipt again), and `false` otherwise. The same refusal from the daemon's writer-time guard, when another apply committed the accepted change first, always carries `written: false`, because it refuses before writing. Either way the request applied nothing new, and `error.details.readbackRequest` is the next step. A worker that reverted the generated pages and retries under a new `requestId` therefore gets them back and can read the committed receipt.
- `projection-apply-request-digest-unrecorded`: the receipt was committed before request digests were recorded, so no request can be proven equal to it. The `requestId` is never reused, not even for the same request. Send the request under a new `requestId`.

`error.details` carries the committed apply's `requestId`, `lookupKey` and `applyId`, its original `requestDigest` when one was recorded, and `readbackRequest`: the committed apply's own readback request (`mode: "apply"`, the recorded `targets`, `changedPaths` and `expected` snapshot, and the committed `acceptedChange`). To read the committed result, send `error.details.readbackRequest` unchanged to `projection readback` (`archctx projection readback --request-json '<readbackRequest>'`, or MCP `archcontext_projection` with `action: "readback"`). This works also for an apply made with `acceptObservedMajorChange`. Readback rebuilds the current projection and proves it against the approval, so it succeeds only while HEAD and the projection worktree digest still equal the approved snapshot (`readbackRequest.expected`) and the projection is still the committed fixed point. After a new commit or another projection-relevant edit it fails with `AC_PRECONDITION_FAILED`; the receipt itself is unchanged. To deliver pending refresh signals, call `projection recover` with `requestId`, `lookupKey` and `applyId` from `error.details`. A receipt from before recovery bindings existed has no `readbackRequest` and cannot be read back or recovered. Do not match the error message. Consumers detect this behavior through the `projection-apply-replay-v1` capability.

#### Choosing a requestId

A `requestId` names one apply. Once an accepted apply commits under it, only that exact request (same request digest) replays; every other request under it fails with `AC_PROJECTION_APPLY_COMMITTED`. So:

- Use a new `requestId` for every distinct apply: a different `mode`, `targets`, `changedPaths`, `expected` snapshot, `acceptedChange`, `acceptObservedMajorChange` or `adoptionPlanId`.
- Keep the same `requestId` when you retry the same request, so a lost response replays instead of applying again.
- Do not use fixed ids such as `<tool>.apply.accepted`; the first committed apply holds that id for good.

Recommended derivation: hash every request field except `requestId` and use the hash in the id. Take the request object without `requestId`: `{schemaVersion, profile, mode, targets, changedPaths, expected: {repositoryId, workspaceId, headSha, worktreeDigest}}` plus whichever of `acceptedChange`, `acceptObservedMajorChange` and `adoptionPlanId` the request carries; omit absent fields, never send them as `null`. Hash it with `digestJson` from the contracts package (`@archcontext/contracts`, published as `archctx-contracts`). `digestJson` returns `sha256:` plus the hex SHA-256 of the UTF-8 bytes of `JSON.stringify` applied after sorting the keys of every object, recursively, by JavaScript's default string sort (UTF-16 code unit order); array order is kept. Use `projection_request.` plus the first 16 hex characters after `sha256:`. `targets` and `changedPaths` are already sorted and unique, because the request requires it. The id must match `^[a-zA-Z0-9_.:-]+$`.

Receipts committed by an older build cannot be replayed or recovered after an upgrade; see [Upgrading from archctx 0.6.3](#upgrading-from-archctx-063).

### Getting the expected snapshot

Every `ProjectionRequestV1` carries `expected: {repositoryId, workspaceId, headSha, worktreeDigest}`, and every mode compares it field by field with the snapshot archctx observes before it renders or writes. A mismatch fails with `AC_PRECONDITION_FAILED` (`projection request expected snapshot mismatch: <field>`).

Get `expected` from archctx. Do not compute it yourself:

```bash
archctx projection snapshot --json
```

The result is `data.expected`, the exact object to send as `ProjectionRequestV1.expected`. It is computed by the same function that checks a request, so it cannot drift from what the daemon compares. The command is read-only and runs in-process: it starts no daemon, opens no local store, opens no task session, runs no CodeGraph sync and renders nothing. Outside a Git worktree it fails with `AC_REPO_NOT_FOUND` (`reasonCode: "git-worktree-required"`). Consumers detect it through the `projection-snapshot-v1` capability.

Consumers must not re-implement any field, in particular `worktreeDigest`. Its file universe and exclusions are archctx internals and may change between versions. A consumer copy is a second authority that fails as soon as they differ. The `inputSnapshot` of a `projection run` result echoes the request's `expected`; it is not an independent observation.

`worktreeDigest` covers the Git-visible files only: tracked files plus untracked files that are not ignored (`git ls-files --cached --others --exclude-standard`), minus projection-owned outputs (`docs/architecture/`, `.ai/harness/` and the agent-context targets) and a fixed set of runtime paths. Files under a gitignored path never move it, wherever they are: a nested `node_modules`, build output such as `dist/`, `.DS_Store`, or desktop worktrees under `.claude/worktrees/`. A tracked file deleted locally drops out of the listing, so the deletion still changes the digest. The ChangeSet worktree-digest precondition (`repository` and `architecture-documentation-projection` profiles) uses the same file universe.

### Asking which documents are stale

`archctx projection freshness --json` answers "which stamped documents describe source that changed since they were verified?" without a full `check`:

```bash
archctx projection freshness --json
archctx projection freshness --changed-path src/app.ts --changed-path src/lib/util.ts --json
```

It compares each node's stamp in the `sourceStamps` of the `entity-summary` target rows in `docs/architecture/.projection-manifest.json` with the footprint digest of the Git-visible files now, through the evaluator `projection run` in `check` mode uses. On the same tree `data.freshness.staleNodes` equals the `check` result's `freshness.staleNodes` for a `repo-harness/v1` manifest, the only profile `check` renders. The committed manifest's `profile` selects the stamped nodes. The command is read-only and runs in-process: it needs no CodeGraph index, runs no CodeGraph sync, renders nothing, starts no daemon, opens no local store and writes nothing. Outside a Git worktree it fails with `AC_REPO_NOT_FOUND` (`reasonCode: "git-worktree-required"`). It refuses the committed manifest as `check` does, with `AC_PRECONDITION_FAILED`: a superseded v1 or v2 manifest with `projection-manifest-upgrade-required`, a v3 manifest that fails its contract with `projection-manifest-invalid`, and a declared footprint no `entity-summary` target documents with `projection-footprint-uncovered`. Consumers detect it through the `projection-freshness-v1` capability.

`data` carries `profile` (`null` without a readable manifest), `changedPaths` (sorted and unique; empty for the whole tree), `evaluatedNodeIds` (the stamped nodes probed) and `freshness` (the `ProjectionFreshnessV1` shape `check` returns).

`--changed-path` is repeatable. Only the stamped nodes whose `source.include` selects one of the paths, and whose `source.exclude` does not, are resolved, hashed and probed. With a readable manifest, a path that selects no stamped node probes nothing and returns `ok: true`. In this scope the declared source tree digest is not compared, so `projection-source-tree-digest-mismatch` is not reported; run without `--changed-path` for the whole-tree answer. A node's stamp digest also depends on its own `source.include`/`source.exclude` and on the projection-owned paths, both defined by the model, so a `--changed-path` under `.archcontext/` widens the run: it evaluates the whole tree exactly as the unscoped command does (every stamped node and the tree digest comparison included) and `data` adds `scope: "tree"` and `scopeReason: "model-path-changed"`. Those two fields are absent when the run stayed on the changed paths' nodes. A path must be repository-relative POSIX as Git lists it: an absolute path, a backslash or a `..` segment fails with `AC_SCHEMA_INVALID` (`changed-path-outside-worktree`), and `./a`, `a//b` or a trailing `/` with `AC_SCHEMA_INVALID` (`changed-path-not-normalized`).

A stale stamp means a source byte under the footprint changed. It does not say whether the rendered document would change; `projection run` in `check` mode renders and answers that in `changes[]` (next section). `projection freshness` does not classify.

### Telling stamp-only drift from real changes

Every `projection run` result in `check` and `plan` mode carries `changes[]`, whatever its `status` (#327). `apply` and `adopt` results and apply receipts never carry it. There is one entry per target path, sorted by path. The entries cover the targets the current layout renders, the targets the committed manifest records, and orphaned documents: an added target, a removed one and an orphan delete each have an entry. The projection manifest is not a target. Its write is the one `files[]` entry that no change names.

Each entry is `{ targetId, path, affectedCapabilityIds, stampChanged, outputChanged, semanticChanged, proofChanged, plannedAction, classification, reasonCodes }`. The comparisons are against the committed v3 manifest:

- `stampChanged`: the target row's `sourceStamps` differ from the committed row (`source-stamp-changed`).
- `outputChanged`: the rendered output differs from the committed row's `outputDigest` (`rendered-output-changed`), the target is added (`target-added`) or removed (`target-removed`), or the write changes the file although its rendered output is the committed one, for example a marker from another renderer, a missing file or an edited region (`file-bytes-changed`). `outputChanged` follows the path's `files[]` entry even when a rejection blocks the write: an edited or unowned document rejected for adoption or ownership repair keeps `file-bytes-changed`.
- `semanticChanged`: the `semanticFingerprint` of a capability the target documents moved, or that capability was added or removed (`semantic-fingerprint-changed`). A module document (`entity-summary`) documents the capabilities its node and its stamped nodes belong to. Every other target (index, decisions, changelog, diagrams, relation summaries) describes the whole model, so a semantic change in any capability counts for it, and so does any change of the model digest (`model-digest-changed`: the committed `semanticBaseline.modelDigest` differs from the current model's), which covers nodes no capability owns, such as a module's or a system's risk.
- Global documents (index, decisions index, changelog, diagrams, relation summaries) depend on the whole model, so any model change marks them `semantic-change`, also when their rendered bytes do not change, and they may over-report. They are never `stamp-only`, and source-only edits never touch them. Module documents never compare the model digest.
- `proofChanged`: the `flowProofFingerprint` (`flow-proof-changed`) or the `selectorEvidenceDigest` (`selector-evidence-changed`) of a capability a module document documents moved. Targets that are not module documents render no flow proof, so for them it is always `false`.
- `null` means unknown, never `false`. Without a committed v3 manifest (missing, unreadable or of an unrecognized schema) every comparison is `null` and the code is `baseline-missing`. A committed manifest without a row for a current target, when no semantic change explains the missing row, or an orphan no row records, makes `stampChanged` (or every comparison) `null` with `target-row-missing`.
- `affectedCapabilityIds` are the documented capabilities whose change affects the target: a semantic or proof change, a moved stamp of one of their nodes, or a block. The list is empty when the target is unchanged.

`classification` follows one precedence rule, from the strongest reason down:

| classification | when | `plannedAction` |
| --- | --- | --- |
| `blocked` | a human must act before the target is written: a Phase 1 carried-forward target (`unprovable-required-flow`, `verified-flow-proof-changed`, the same reasons and paths as `coverage.blockedTargets`), an orphan that needs review (`orphan-review-required`), or a path rejected for adoption or ownership repair (`adoption-required`, `ambiguous-ownership`) | always `none` |
| `proof-change` | a documented capability's flow proof or selector evidence moved (`proofChanged` is `true`), also when another comparison is unknown: a known proof change is never hidden by a missing baseline, and a target without a committed row keeps `target-row-missing` among its reasons | any; a proof change can write no document |
| `baseline-missing` | a comparison is unknown (`baseline-missing`, `target-row-missing`) and no proof change is known | any |
| `semantic-change` | a documented capability's semantic fingerprint moved, or, for a global document, the model digest moved; also when no rendered byte changes | any |
| `output-change` | the rendered output or the file bytes change | `create`, `update` or `delete`; `none` when the file already holds the rendered bytes or a removed target's file is gone |
| `stamp-only` | only `sourceStamps` moved: output bytes unchanged, semantic and proof comparisons known and unchanged, not blocked | always `none` |
| `unchanged` | nothing moved; `reasonCodes` is empty | always `none` |

`plannedAction` is the result's own write decision for that path: the `files[]` action that `apply` commits, never a second comparison. When `status` is `planned` or `planned-partial`, the targets whose `plannedAction` is not `none` are exactly the documents an apply of the same render writes or deletes. Under `adoption-required` or `human-action-required` apply writes nothing, and `plannedAction` reports only what the render would write. One exception: `files[]` also lists a path rejected for adoption or ownership repair, which only an approved adoption writes. Its change is `blocked` with `plannedAction: "none"`. Classification never changes `status`, `files[]`, what `apply` writes, receipts, refresh signals, `freshness`, `coverage` or any gate. `coverage` stays the authority on what a partial run carries forward, and the contracts refuse a result whose carried-forward target is not `blocked` in `changes[]`.

To ignore stamp-only drift during a task, run `check` and treat `unchanged` and `stamp-only` entries as no work. When every entry is one of the two, the documents are current and `files[]` holds at most the manifest; the stamps are rewritten whenever the next apply runs. Act on the others: re-read the documents of `semantic-change` and `proof-change` targets (their human-owned text may describe the old behavior) and resolve any human action the `status` names; `output-change` means `apply` rewrites the document; `baseline-missing` means a comparison could not be made, so re-baseline with `apply` before relying on the classification; `blocked` means a human must fix the named flow, orphan or ownership first. Consumers detect `changes[]` through the `projection-change-classification-v1` capability.

### Previewing a projection before apply

`archctx projection run` in `mode: "plan"` is the only preview path. It plans no daemon ChangeSet and writes nothing; it renders and returns. Every `files[]` entry of a plan result carries `preview`:

- `create`: `format: "body"`, the rendered document.
- `update` and `delete`: `format: "unified-diff"`, a unified diff with three context lines from the bytes on disk to the rendered bytes (`+++ /dev/null` for a delete).
- `content` is cut at a line boundary to at most 65,536 UTF-8 bytes per file, and the previews of one result share a 1,048,576-byte budget in path order, so a late file can show empty content. `byteLength` is the UTF-8 length of the complete content, and `truncated` is true exactly when `content` is shorter.
- An entry whose path the projection rejected for adoption or ownership repair has no `preview`, because no apply writes that rendered body.

`check`, `apply` and `adopt` results never carry `preview`, and a committed apply receipt is refused if it does, so document bodies never reach the ledger. The hidden `archctx docs preview` command is removed: it planned a daemon ChangeSet as a side effect and returned an unschematized draft. Use `projection run` `plan` to preview, or `archctx docs plan --id <changeset-id>` to stage a reviewable ChangeSet. Consumers detect previews through the `projection-preview-v1` capability.

### Per-capability change details

Every refresh signal a run produces carries `capabilities[]`, sorted by `capabilityId`: `{ capabilityId, reasonCodes, changedFacets, proofStatusBefore, proofStatusAfter }`. It breaks the signal's change down per capability: the reason codes and semantic facets (`constraints`, `entrypoints`, `interfaces`, `lifecycle`, `names`, `ownership`, `placement`, `relations`, `responsibilities`, `riskBoundaries`) that moved, and the P1/P2 proof status on each side. `proofStatusBefore` is null without a baseline entry (an added capability or a first projection), and `proofStatusAfter` is null for a removed capability; a one-sided capability lists no facets. A capability listed only because its proof is unprovable, while another capability carries the observed change, has no reason codes. For an accepted change the breakdown is the observed one, which can name more reasons than `acceptedChange.reasonCodes`. The breakdown is part of the signal identity. Signals committed before it existed lack the field. After upgrading, a pending refresh signal is re-emitted once with a new `signalId` and `idempotencyKey`, because its identity now includes `capabilities[]`; consumers that deduplicate on `idempotencyKey` see it as one new signal. `archctx docs drift|plan` report the same breakdown as `majorChange.capabilities`. Consumers detect it through the `architecture-change-capabilities-v1` capability.

## Bad Projection Recovery

If generated content is wrong but human text is intact:

1. Do not hand-edit inside generated markers.
2. Fix the source architecture model, ADR source, or renderer.
3. Run `archctx docs plan`.
4. Apply through ChangeSet.
5. Verify `archctx docs drift` is clean.

If human text was accidentally moved inside generated markers:

1. Restore the human text outside the marker block.
2. Run `archctx docs drift`.
3. Re-apply projection output through `archctx docs apply --approved`.

If an obsolete generated projection exists:

`archctx projection run` sorts an orphaned document (its target is no longer in the model, for example after a node is removed) by what it holds. `check`, `plan` and `apply` report the same action for it:

- An intact generated region with nothing else around it, or with exactly the skeleton the renderer wrote for that target (the title line and the empty §3, §4 and Optimization Backlog headings, as the committed manifest records the target): the result lists it in `files[]` as a `delete`, and `apply` deletes it in the same ChangeSet as the other projection writes.
- Any other text, such as a human line in a skeleton section, an edited title, or an edited generated region: the result status is `human-action-required`, and `humanActions[]` carries `reasonCode: "orphaned-document-review"` with the document `path`. The document is never a `files[]` entry. `apply` stops before writing anything, including with an `acceptedChange`. Review the document, move any text worth keeping, delete it, and run `apply` again with the same request fields.

Consumers detect this behavior through the `projection-orphan-review-v1` capability.

For the human-oriented `docs` commands:

1. Run `archctx docs clean`.
2. Treat `manual-review-required-before-tombstone` as a review task, not an automatic delete.
3. Add any redirect/tombstone manually if links may exist.
4. Remove the obsolete generated file only after review.

## Agent Draft Review

Subagents may draft rationale or ADR prose only after deterministic delta selection. The draft must remain separate from accepted projection output:

- `acceptedProjection` must be `false`.
- `authority` must be `advisory-only`.
- `write-docs` and `apply-changeset` remain forbidden agent actions.
- The draft must trace to `jobId`, `inputDigest`, `outputDigest`, `promptTemplateDigest` and selected deterministic delta digests.

To accept agent-written prose, copy the reviewed prose into a human-owned region or a new ADR through a normal developer edit, then run the deterministic projection flow again.
