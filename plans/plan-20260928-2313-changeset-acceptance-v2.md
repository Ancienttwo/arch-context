# Plan: #238 prerequisite: journal model-transition evidence and v2 committed-change acceptance

> **Status**: Executing
> **Created**: 20260928-2313
> **Slug**: changeset-acceptance-v2
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: User approved full #238 on 2026-09-28; dual-track design synthesized
> **Verification Boundary**: Pinned Bun typecheck, boundary audit, targeted suites, full bun test, dual-track security review, gatekeeper, hosted CI
> **Rollback Surface**: git revert; additive journal metadata; record-only v2 events
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260928-2313-changeset-acceptance-v2.contract.md`
> **Task Review**: `tasks/reviews/20260928-2313-changeset-acceptance-v2.review.md`
> **Implementation Notes**: `tasks/notes/20260928-2313-changeset-acceptance-v2.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from repo-harness-plan planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260928-2313-changeset-acceptance-v2.md`
- Sprint contract: `tasks/contracts/20260928-2313-changeset-acceptance-v2.contract.md`
- Sprint review: `tasks/reviews/20260928-2313-changeset-acceptance-v2.review.md`
- Implementation notes: `tasks/notes/20260928-2313-changeset-acceptance-v2.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260928-2313-changeset-acceptance-v2.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260928-2313-changeset-acceptance-v2.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260928-2313-changeset-acceptance-v2.md`.

## Approach
### Strategy
Use the captured planning output below as the execution source of truth.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| See captured planning output | Follow | Implement only the approved scope named below |

### Code Snippets
See captured planning output.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Captured plan lacks enough detail | Medium | Execution may need clarification | Stop before implementation if the captured output contradicts repo rules or lacks concrete file targets |

## Task Contracts
- Contract file: `tasks/contracts/20260928-2313-changeset-acceptance-v2.contract.md`
- Review file: `tasks/reviews/20260928-2313-changeset-acceptance-v2.review.md`
- Implementation notes file: `tasks/notes/20260928-2313-changeset-acceptance-v2.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260928-2313-changeset-acceptance-v2.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260928-2313-changeset-acceptance-v2.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: git revert; additive journal metadata; record-only v2 events
- **Verification boundary**: Pinned Bun typecheck, boundary audit, targeted suites, full bun test, dual-track security review, gatekeeper, hosted CI
- **Review/acceptance boundary**: `tasks/reviews/20260928-2313-changeset-acceptance-v2.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: User approved full #238 on 2026-09-28; dual-track design synthesized

## Evidence Contract

- **State/progress path**: `plans/plan-20260928-2313-changeset-acceptance-v2.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260928-2313-changeset-acceptance-v2.contract.md`, `tasks/reviews/20260928-2313-changeset-acceptance-v2.review.md`, and `tasks/notes/20260928-2313-changeset-acceptance-v2.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260928-2313-changeset-acceptance-v2.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: git revert; additive journal metadata; record-only v2 events

## Captured Planning Output

## Authority and goal

User approved doing #238 in full on 2026-09-28 ("238可以做"). #238 requires the `tasks/todos.md` row "Semantic acceptance for committed YAML ChangeSets beyond node renames" to land before the move-only extraction. This plan covers only that prerequisite, as one PR with two commits (A: journal model-transition evidence; B: v2 acceptance). The bunfig.toml live proof and the #238 move-only extraction get their own plans afterwards.

Design source: dual-track design on 2026-09-28 (Opus deep-reasoner + Codex), synthesized by the orchestrator. Both tracks agreed that widening the rename predicate is unsafe and that acceptance must be proven by a chain from an anchored baseline, through explicitly listed journals, to the current model.

## P1 architecture map

- `packages/local-runtime/runtime-daemon/src/index.ts`:
  - `applyAuthorizedUpdate` (~1069) runs ChangeSet apply under `withWriter`;
  - `acceptCommittedChange` (~1185) appends the record-only `architecture.changeset.accepted` event.
- `packages/core/changeset-engine/src/index.ts:265` owns file mutation, validation, the `afterModelValidatedBeforeCommit` hook and journal commit.
- `packages/local-runtime/local-store-sqlite/src/index.ts`:
  - journal persistence (`recordChangeSetFile` ~2155);
  - `readCommittedChangeSet` (~2258);
  - journal metadata (~7706).
- `packages/core/projection-engine/src/major-change.ts` classifies the baseline→current semantic delta (13 reason codes, `packages/contracts/src/projection.ts:38`).
- The manifest `semanticBaseline.digests.modelDigest` equals `digestJson(loadNativeModelFromArchContext(root))` and anchors the chain.
- Consumers:
  - `docs`/`projection run` accept an opaque `AcceptedArchitectureChangeReferenceV1` tuple (`projection-service.ts`, `cli/src/main.ts:1139`).
- Out of scope:
  - consumer-side event resolution (the cross-repository v1 protocol treats `acceptedChange` as opaque; see `plans/plan-20260925-1345-remaining-audit-issues.md:443`);
  - MCP exposure;
  - ledger graph authority promotion;
  - the #238 extraction itself.

## P2 concrete trace

`archctx apply` → RPC `apply_update` → `applyAuthorizedUpdate` → ChangeSet engine writes files, validates the model, runs the pre-commit hook, and commits the journal (files + preimage hashes only).

`archctx ledger accept-committed --journal-id --changeset-id --approved --expected-worktree-digest` → `acceptCommittedChange`, which:
- reads one committed journal;
- builds a docs projection;
- requires `majorChange.reasonCodes == node-added,node-removed` with exactly 2 affected nodes, each with a journaled node file;
- appends a v1 event with `operations: []`.

Pressure points:
1. Journals carry no model-digest evidence, so completeness can't be proven.
2. For ownership-only, summary or relation changes the affected set is the capability rather than the edited node, so the v1 per-node file rule is structurally wrong.
3. `expectedWorktreeDigest` excludes `docs/architecture`, so the baseline can move under an approval.

## P3 decision

**Commit A: evidence.**
- For drafts whose operation paths touch `.archcontext/model/{nodes,relations,flows}/*.y(a)ml`, record a digest-only `archcontext.changeset-model-transition/v1` `{before, after}` NativeModel digest on the pending journal. This happens in the pre-commit hook in every write mode.
- Before recording, re-hash the semantic files: files the draft didn't write must be unchanged, and written files must match the op bodies.
- A failed check or loader error records nothing and never fails or alters the apply.
- The `apply_update` envelope returns `journalId`.

**Commit B: acceptance v2.**
- The operator passes an explicit ordered list of 1–32 `{journalId, changeSetId}` pairs.
- The daemon requires all of the following:
  - the chain holds: `b1 == manifest baseline modelDigest`, `a_i == b_{i+1}`, `a_n == current NativeModel digest`;
  - every journal is committed, in the same root, and wrote at least one semantic file;
  - `committedAt` never decreases;
  - `mode == human-action-required`;
  - no rejected projection entries and no unprovable p1/p2 proof;
  - accepted reason and affected sets exactly equal the observed ones;
  - a proof-only change with no journaled flow or semantic edit is rejected.
- Preview/approve: a call without `approved` returns the plan and `acceptancePlanId = digestJson(plan)`. The approve call recomputes under the writer lock and must match the id.
- The payload is `archcontext.accepted-committed-change/v2` with the same eventType and `operations: []`, base == resulting ledger graph digest. It records:
  - the journal chain with before/after digests;
  - `fileSetDigest`;
  - baseline/current digests;
  - the direct / ancestor / carried node sets;
  - `acceptancePlanId`;
  - `authority: "yaml"`.
- The event id is derived from `{v2, journalIds, baseline, current}`.
- `AcceptedArchitectureChangeReferenceV1` is unchanged. The payload type becomes a v1|v2 union, and recorded v1 events are untouched.
- The old four-field RPC shape returns `AC_SCHEMA_INVALID`.
- The CLI keeps `--journal-id/--changeset-id` as a one-journal shorthand, and adds repeatable `--journal <journalId>=<changeSetId>` and a preview mode.

Rejected alternatives:
- Allow-listed shapes with capability-level attribution: accepts hand edits.
- Git-preimage baseline reconstruction: shadow model derivation.
- A mandatory consumer-side SQLite resolver: breaks valid cross-repository acceptances. Record an opt-in local verification as a deferred todo instead.

Invariant: acceptance stays record-only, daemon-owned and fail-closed; no raw bodies are persisted.

At 10x, preview/approve docs builds held under the writer lock fail first.

## Allowed paths

- `packages/local-runtime/runtime-daemon/src/**`
- `packages/local-runtime/runtime-daemon/test/**`
- `packages/local-runtime/local-store-sqlite/src/**`
- `packages/local-runtime/local-store-sqlite/test/**`
- `packages/core/architecture-ledger/src/**`
- `packages/core/architecture-ledger/test/**`
- `packages/core/changeset-engine/src/**`
- `packages/core/changeset-engine/test/**`
- `packages/surfaces/cli/src/**`
- `packages/surfaces/cli/test/**`
- `tests/**`
- `docs/runbooks/architecture-documentation-projections.md`
- `tasks/todos.md`
- `tasks/notes/**`
- `plans/**`

## Verification boundary

- Bun 1.4.0: `bun run typecheck`, `bun run check:package-boundaries`.
- Targeted: runtime-daemon, local-store-sqlite, architecture-ledger, changeset-engine, cli, and the `tests/` acceptance suites.
- Full `bun test --timeout 60000`.
- Dual-track security review (Opus + Codex) of the final diff.
- Gatekeeper acceptance, then hosted CI.

## Rollback surface

`git revert` of the PR. The transition record is additive journal metadata that older code ignores. v2 events are record-only (`operations: []`) and grant no graph authority. No SQLite schema migration beyond additive metadata; if one is needed it must be additive and documented in the notes.

## Task Breakdown

- [x] Commit A: record the model-digest transition on pending semantic journals in every write mode; return `journalId` from `apply_update`; store + daemon tests (recorded, not recorded for non-semantic drafts, not recorded on a concurrent write, apply still succeeds).
- [x] Commit B: v2 multi-journal preview/approve acceptance with chain, exact-set, proof and baseline gates; v1|v2 payload union; RPC/CLI shape; pure helpers in their own module; positive and negative domain tests plus a CLI end-to-end preview→approve→`projection run` receipt test.
- [x] Update the runbook, close the todos row, and add a deferred row for opt-in consumer-side event verification.
- [ ] Full verification, dual-track security review, gatekeeper, PR.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Commit A: record the model-digest transition on pending semantic journals in every write mode; return `journalId` from `apply_update`; store + daemon tests (recorded, not recorded for non-semantic drafts, not recorded on a concurrent write, apply still succeeds).
- [x] Commit B: v2 multi-journal preview/approve acceptance with chain, exact-set, proof and baseline gates; v1|v2 payload union; RPC/CLI shape; pure helpers in their own module; positive and negative domain tests plus a CLI end-to-end preview→approve→`projection run` receipt test.
- [x] Update the runbook, close the todos row, and add a deferred row for opt-in consumer-side event verification.
- [ ] Full verification, dual-track security review, gatekeeper, PR.
