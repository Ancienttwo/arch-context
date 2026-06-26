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
