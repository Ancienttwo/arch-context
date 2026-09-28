# Architecture Documentation Projections Runbook

## Ownership

- `.archcontext/projections/targets.json` declares placement rules.
- `docs/architecture/.projection-manifest.json` records the active renderer, source digest and output digests.
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

## Accepting Committed Model Changes

When `archctx docs drift` reports `majorChange.mode: human-action-required` after model edits, accept those edits through the committed ChangeSets that made them. Do not re-baseline with a manual `docs apply --approved`.

1. Make every edit to `.archcontext/model/{nodes,relations,flows}/*.yaml` through ChangeSets (`archctx apply --approved …`). Each apply returns a `journalId`, and the journal records a digest-only model transition `{before, after}`. A hand edit records nothing, so it breaks the chain.
2. Preview:
   ```bash
   archctx ledger accept-committed --journal <journalId>=<changeSetId> [--journal …]
   ```
   List the journals in commit order. One journal can also be passed as `--journal-id <id> --changeset-id <id>`. Leave out journals that wrote no semantic model file, such as waivers or docs.
3. Review the plan before approving:
   - reason codes and affected node ids;
   - `directlyEditedNodeIds`, `affectedAncestorNodeIds` and `carriedNodeIds`;
   - the journal chain from the projection manifest baseline to the current model.
4. Approve with the ids the preview returned:
   ```bash
   archctx ledger accept-committed --journal … --approved --acceptance-plan-id <acceptancePlanId> --expected-worktree-digest <expectedWorktreeDigest>
   ```
   The daemon recomputes the plan under the writer lock. Any change since the preview, including a re-baseline of `docs/architecture`, changes the plan id and refuses the approval. The approval appends a record-only `architecture.changeset.accepted` event. The event carries payload `archcontext.accepted-committed-change/v2`, has `operations: []`, and does not change ledger graph authority.
5. Pass the returned `acceptedChange` tuple unchanged as `ProjectionRequestV1.acceptedChange` to `archctx projection run`. A successful run records the apply receipt and delivers one refresh signal. `archctx projection recover` with the same receipt then reports `already-delivered`.
6. Run `archctx docs drift` again and confirm it is clean.

Acceptance is refused when any of these is true:
- the journal chain does not start at the manifest baseline or does not end at the current model;
- a listed journal is pending, aborted, from another root, or out of order;
- a node file is not stored as `nodes/<id>.yaml`;
- a path has a symlinked segment;
- a capability proof is unprovable;
- the projection has rejected (adoption or ownership) entries;
- a flow proof changed without a journaled edit to that capability's flow;
- an event already exists for the same snapshot.

In each case, fix the cause and preview again. A hand edit is fixed by reverting it, or by replaying it as a ChangeSet.

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
