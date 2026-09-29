# Implementation Notes: bunfig-ownership-acceptance

> **Status**: Active
> **Plan**: plans/plan-20260929-1123-bunfig-ownership-acceptance.md
> **Contract**: tasks/contracts/20260929-1123-bunfig-ownership-acceptance.contract.md
> **Review**: tasks/reviews/20260929-1123-bunfig-ownership-acceptance.review.md
> **Last Updated**: 2026-09-29
> **Lifecycle**: notes

## Design Decisions

- Each of the five `module.architecture-context.<ws>` nodes gains one `source.include` line, `packages/<ws>/bunfig.toml`, placed directly after its `package.json` include.
- Not changed: the root `bunfig.toml` (#240 scopes a literal root file to itself, so it is never counted), excludes, and new nodes.
- The parent session applied the ChangeSet through `scripts/apply-model-proposal.ts`, per the repo rule that subagents never mutate YAML.
- The only code change is that the proposal receipt now surfaces `journalId` (#247 added it to `apply_update` for this flow).

## Live Evidence (digests and ids only)

**ChangeSet `changeset.bunfig-ownership`**
- Operations: five `update_entity_fields`.
- Proposal: `sha256:8bb7b4863be7c22a48a8585fddd1ffe42cd3e13eb72408182735aa3cabcbe20a`.
- Preview worktree: `sha256:d3ae4a52dfea75c10f9c94e4dc652f874af5575c12bb58acb72fdf5eb806c888`.
- Status: `applied`.
- `journalId`: `changeset_c45859dc-8dc5-4d67-b7ed-c529cb130741`.

**accept-committed preview**
- Reason codes: `["ownership-changed"]`.
- Affected nodes: `["capability.architecture.context"]`.
- Direct edits: the five modules. Ancestor: the capability. Carried: none.
- Anchor: `head` at `5e0f4cd`.
- Chain: `sha256:79c534fa0da2… → sha256:7804895020fd…`.
- Plan id: `sha256:3db07e1479a35994dc630811d6343e5817c4e255fe4ce9acb463a34a716677ea`.
- The preview returned no tuple.

**accept-committed approve**
- Event: `architecture_event.changeset_accepted.fd4a88a7b8dadf15fe17a829`.
- Event hash: `sha256:5d08e46efeeee7fcf4557fd4405bc552807475970824ea9ecf68cdae82251a06`.
- `replayed: false`.

**projection run** (profile `repo-harness/v1`, targets agent-context and architecture-docs, with the tuple)
- Status: `applied`.
- Receipt: lookupKey `sha256:90c716bad672491ea64954403c7a12efbf10ab8146286c099f2a4c109ba2e48b`, applyId `sha256:60385f8b3e9655761b557a4442884bb19a7a7ca8947a276d91eaac74141bd953`.
- One refresh signal, `refresh-required` / `accepted-semantic-delta`, bound to the event above.
- `projection recover` returned `already-delivered` with 0 signals.

**End state**
- `docs drift --profile repo-harness/v1`: ok, `majorChange: none`. This also clears the one-time `projection-manifest-stale` from #247's new `semanticBaseline.evidence` field.
- `refactor scan`: `unownedFileCount` went from 5 to 0.
- `archctx validate`: valid.

**Outcome.** The #247 v2 path ran end to end on a real ownership change with no refusals and no workaround needed, so no fix is required before the #238 extraction.

## Operational Note

A `docs drift` run earlier in this worktree left a background daemon holding the worktree store writer lock. `scripts/apply-model-proposal.ts` then failed with `local-store-writer-owned` until `archctx daemon stop` was run. That is the expected single-writer behaviour, not a defect; stop the daemon before running the script.
