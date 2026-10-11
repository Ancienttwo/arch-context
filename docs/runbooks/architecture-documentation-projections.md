# Architecture Documentation Projections Runbook

## Ownership

- `.archcontext/projections/targets.json` declares placement rules.
- `docs/architecture/.projection-manifest.json` records the active renderer, source digest and output digests. It records only machine-independent values: content digests of the model, the declared sources and the rendered output, plus renderer, layout and CodeGraph package and version. The CodeGraph evidence digest, index state and status, HEAD and worktree digest are per-run facts returned as `runtimeSnapshot` and never committed, so two machines projecting the same commit write the same manifest.
- The manifest's shape is published in archctx-contracts: the `ArchitectureDocsProjectionManifestV1` type, the `architectureDocsProjectionManifestIssues` check, and `schemas/runtime/projection-manifest.schema.json`. The renderer validates every manifest it writes against that contract and reads the semantic baseline back through it. Each `entity-summary` target of a node that declares `source.include` carries `sourceFootprintDigest` and `scale: { fileCountBucket, lineCountBucket }`. A bucket is the half-open 1–2–5 range `{ lower, upper }` that contains the measured count (`{ lower: 0, upper: 1 }` holds only zero). The module document prints exactly these buckets, never the counts. Consumers detect the published contract and the scale field through the `projection-manifest-contract-v1` capability.
- Text inside `ARCHCONTEXT:generated` markers is generated projection output.
- Text outside generated markers is human-owned and must be preserved.
- Agent-authored rationale or ADR prose is advisory draft material until deterministic validation and explicit approval.

## Normal Flow

1. Run `archctx docs drift`.
2. If drift exists, run `archctx docs plan --id <changeset-id>`.
3. Review the ChangeSet preview paths and generated-region changes.
4. Apply with `archctx docs apply --approved --id <changeset-id> --expected-worktree-digest <digest>`.
5. Run `archctx docs drift` again.
6. Run `archctx complete` only after projection drift is clean.

`complete_task` validates active documentation projections when `docs/architecture/.projection-manifest.json` exists. A successful completion must have projection drift count zero.

### Missing code facts

When `.archcontext/manifest.yaml` declares `codeFacts.required: true` and the repository has no CodeGraph index (`.codegraph/`), the projection is not rendered at all. `complete_task` (CLI `archctx complete`), the `docs` commands and `projection run`, `readback` and `recover` all fail with `AC_CODE_FACTS_UNAVAILABLE`: retryable, `error.reasonCode: "index-missing"`, `error.action: "codegraph-init"`. This is an environment state, not projection drift or a major change. Map `error.action` to a command, never the message:

| `error.action` | Do this |
| --- | --- |
| `codegraph-init` | Run `codegraph init` in the repository root, then retry the same call. |

A repository that cannot build an index declares `codeFacts.required: false`; projections then render without code facts.

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
- a capability's flow proof changed while its semantic fingerprint did not, and either the declared source tree, the proof-relevant selector evidence (call-site lines excluded) or the renderer version moved since the baseline was rendered (`semanticBaseline.evidence`), or the manifest predates that record (re-baseline first);
- a different acceptance event already exists for the same snapshot.

In each case, fix the cause and preview again. A hand edit is fixed by reverting it, or by replaying it as a ChangeSet.

Trust boundary: the HEAD anchor trusts local git history. Anyone who can commit locally, including via `--amend` or on a detached HEAD, can anchor a manifest; the accepted event records which commit or journal anchored it. The event is an informational record, not an enforcement gate: `projection run` treats `acceptedChange` as opaque. Enforcement waits on the deferred consumer-side resolver in `tasks/todos.md`.

### Accepting the observed major change in one request

An agent that owns the decision, with the pull request review as the human gate, can skip the `ledger accept-committed` round trip. Set `acceptObservedMajorChange: true` on a `mode: "apply"` or `mode: "adopt"` request. The field is refused (`AC_SCHEMA_INVALID`) in `check` and `plan` mode, with any value other than `true`, and together with `acceptedChange`.

With the flag, `projection run` classifies the major change at `expected` and applies it in the same run against the same expected snapshot. The daemon re-checks that snapshot under its writer lock before the ChangeSet writes, so a change after classification to the inputs the worktree digest covers fails the apply instead of committing an unreviewed change. `docs/architecture/` is not covered by that digest. The run therefore renders the accepted change against the documents and projection manifest it read at classification, not a later copy, so the applied change is the one the receipt records. The apply receipt records the observed change as `applyReceipt.acceptedChange`, with a `changeSetId` (`changeset.observed-major-change-<hash>`) and `eventId` (`projection_event.observed_major_change.<hash>`) that the provider derives from the snapshot and the change. No ledger event is appended.

When the run observes no major change, the flag does nothing and the request is a plain apply. When a capability proof (P1 or P2) is unprovable, the change cannot be accepted and the flag is declined: the result is `human-action-required` with `majorChangeAcceptance: "declined-unprovable-proof"`, and `humanActions[]` carries `reasonCode: "unprovable-required-flow"` with the ids of the capabilities whose proof is unprovable, in place of `unresolved-major-change`. Do not retry the flag; fix the named flows or relations first. `majorChangeAcceptance` is absent whenever the request did not send the flag. It also appears only on a `human-action-required` result, so other stops take precedence over it: in `mode: "apply"`, a projection that needs adoption returns `adoption-required` (with its `adoption-required` action, without `majorChangeAcceptance`) even when the flag was declined; in `mode: "adopt"`, a projection that needs no adoption and has no drift returns `noop`, also without the field. Without the flag, a major change still stops at `human-action-required`. Consumers detect the field through the `projection-observed-major-change-acceptance-v1` capability.

To read back such an apply, send `projection readback` the original request with `acceptObservedMajorChange` replaced by the committed `applyReceipt.acceptedChange`. A caller that lost the result never saw that `acceptedChange`; it gets the complete readback request from `AC_PROJECTION_APPLY_COMMITTED` (below).

### Repeating an accepted apply

A caller that lost the response of an accepted `apply` or `adopt` (process kill, timeout, closed pipe) sends the same request again. If its `requestId` and request digest match a committed receipt, `projection run` returns the committed `ProjectionResultV2` with `replayed: true` and applies nothing. The replay key is the `requestId` plus the digest of the request exactly as the caller sent it, including `acceptObservedMajorChange`. It never includes provider-generated ids. `replayed` is excluded from `receiptDigest`, so the replay carries the committed receipt digest. If the first run committed but never delivered its refresh signals, the replay reports `applied-reconcile-required` with no signals; deliver them with `projection recover` and the `applyReceipt` `lookupKey` and `applyId`.

A different request under a committed `requestId`, or a new request for an accepted change that is already applied, fails with `AC_PROJECTION_APPLY_COMMITTED` (not retryable, action `readback-committed-projection-apply`). `error.reasonCode` is one of:

- `projection-apply-request-differs`: the `requestId` already committed a different request. Send the new request under a new `requestId`.
- `projection-accepted-change-committed`: the accepted change was already applied under the `requestId` in `error.details`.
- `projection-apply-request-digest-unrecorded`: the receipt was committed before request digests were recorded, so no request can be proven equal to it. The `requestId` is never reused, not even for the same request. Send the request under a new `requestId`.

`error.details` carries the committed apply's `requestId`, `lookupKey` and `applyId`, its original `requestDigest` when one was recorded, and `readbackRequest`: the committed apply's own readback request (`mode: "apply"`, the recorded `targets`, `changedPaths` and `expected` snapshot, and the committed `acceptedChange`). To read the committed result, send `error.details.readbackRequest` unchanged to `projection readback` (`archctx projection readback --request-json '<readbackRequest>'`, or MCP `archcontext_projection` with `action: "readback"`). This works also for an apply made with `acceptObservedMajorChange`. Readback rebuilds the current projection and proves it against the approval, so it succeeds only while HEAD and the projection worktree digest still equal the approved snapshot (`readbackRequest.expected`) and the projection is still the committed fixed point. After a new commit or another projection-relevant edit it fails with `AC_PRECONDITION_FAILED`; the receipt itself is unchanged. To deliver pending refresh signals, call `projection recover` with `requestId`, `lookupKey` and `applyId` from `error.details`. A receipt from before recovery bindings existed has no `readbackRequest` and cannot be read back or recovered. Do not match the error message. Consumers detect this behavior through the `projection-apply-replay-v1` capability.

#### Choosing a requestId

A `requestId` names one apply. Once an accepted apply commits under it, only that exact request (same request digest) replays; every other request under it fails with `AC_PROJECTION_APPLY_COMMITTED`. So:

- Use a new `requestId` for every distinct apply: a different `mode`, `targets`, `changedPaths`, `expected` snapshot, `acceptedChange`, `acceptObservedMajorChange` or `adoptionPlanId`.
- Keep the same `requestId` when you retry the same request, so a lost response replays instead of applying again.
- Do not use fixed ids such as `<tool>.apply.accepted`; the first committed apply holds that id for good.

Recommended derivation: hash every request field except `requestId` and use the hash in the id. Take the request object without `requestId`: `{schemaVersion, profile, mode, targets, changedPaths, expected: {repositoryId, workspaceId, headSha, worktreeDigest}}` plus whichever of `acceptedChange`, `acceptObservedMajorChange` and `adoptionPlanId` the request carries; omit absent fields, never send them as `null`. Hash it with `digestJson` from the contracts package (`@archcontext/contracts`, published as `archctx-contracts`). `digestJson` returns `sha256:` plus the hex SHA-256 of the UTF-8 bytes of `JSON.stringify` applied after sorting the keys of every object, recursively, by JavaScript's default string sort (UTF-16 code unit order); array order is kept. Use `projection_request.` plus the first 16 hex characters after `sha256:`. `targets` and `changedPaths` are already sorted and unique, because the request requires it. The id must match `^[a-zA-Z0-9_.:-]+$`.

Before upgrading from archctx 0.6.3, recover every in-flight projection apply receipt with `projection recover`. A 0.6.3 receipt carries `generatedFrom.codeGraphBinaryDigest`, which later versions no longer accept, so after the upgrade it can be neither recovered nor read back.

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
