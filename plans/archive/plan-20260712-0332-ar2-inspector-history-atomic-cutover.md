# Plan: AR2 Inspector 2.0 and Required Typed History

> **Status**: Archived
> **Created**: 20260712-0332
> **Slug**: ar2-inspector-history-atomic-cutover
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-contract-row
> **Source Ref**: sprint:plans/sprints/20260712-0258-authority-aware-architecture-reading-completion.sprint.md#AR2
> **Artifact Level**: work-package
> **Promotion Reason**: shared_contract_boundary
> **Verification Boundary**: Contract/schema/compiler/daemon/store/HTML/CLI/RPC/privacy/typecheck/verify:explorer plus required-shape negative search and AR2 readback
> **Rollback Surface**: Atomic V2 type/schema/compiler/fixture/reader revert; manifest-addressed cache rows are disposable and never rewritten
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260712-0332-ar2-inspector-history-atomic-cutover.contract.md`
> **Task Review**: `tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md`
> **Implementation Notes**: `tasks/notes/20260712-0332-ar2-inspector-history-atomic-cutover.notes.md`

## Agentic Routing
- Selected route: think
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260712-0258-authority-aware-architecture-reading-completion.sprint.md#AR2
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md`
- Sprint contract: `tasks/contracts/20260712-0332-ar2-inspector-history-atomic-cutover.contract.md`
- Sprint review: `tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md`
- Implementation notes: `tasks/notes/20260712-0332-ar2-inspector-history-atomic-cutover.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260712-0332-ar2-inspector-history-atomic-cutover.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree; `.claude/.active-plan` is a legacy fallback during transition. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md`.

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
- Contract file: `tasks/contracts/20260712-0332-ar2-inspector-history-atomic-cutover.contract.md`
- Review file: `tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md`
- Implementation notes file: `tasks/notes/20260712-0332-ar2-inspector-history-atomic-cutover.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260712-0332-ar2-inspector-history-atomic-cutover.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan`, the owning worktree is written to `.ai/harness/active-worktree`, and the plan is mirrored to `.claude/.active-plan` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Atomic V2 type/schema/compiler/fixture/reader revert; manifest-addressed cache rows are disposable and never rewritten
- **Verification boundary**: Contract/schema/compiler/daemon/store/HTML/CLI/RPC/privacy/typecheck/verify:explorer plus required-shape negative search and AR2 readback
- **Review/acceptance boundary**: `tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: shared_contract_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260712-0332-ar2-inspector-history-atomic-cutover.contract.md`, `tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md`, and `tasks/notes/20260712-0332-ar2-inspector-history-atomic-cutover.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260712-0332-ar2-inspector-history-atomic-cutover.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Atomic V2 type/schema/compiler/fixture/reader revert; manifest-addressed cache rows are disposable and never rewritten

## Captured Planning Output

# Objective

Atomically make complete verified event history a required part of
`ExplorerInspectorV2`, render every existing typed Inspector/backlink/cursor facet,
and invalidate old manifest-addressed projections so no cached pre-history V2 shape
can masquerade as the new contract.

# Success Criteria

- `historyEvents: Array<{ eventId; title?; rationale? }>` is required in TypeScript,
  JSON Schema, fixtures, compiler output, HTML, stored projection fixtures, RPC/CLI
  pass-through tests, and every typed caller in one merge unit.
- History comes only from verified `eventBacklinks` already selected into the input
  manifest; no event store query or second history path is added.
- Events are deduplicated by `eventId` and sorted canonically. Identical duplicates
  merge subject IDs; conflicting title/rationale for one event ID fail closed.
- `decisions` remains the decision-only subset with title/rationale; `historyEvents`
  contains every event backlink including event-ID-only entries.
- Inspector renders summary, responsibility, constraints, decisions, full history,
  source selectors, evidence binding IDs, every backlink array, relation IDs, and a
  collapsed technical section with cursors/manifest/projection digests.
- A new inspector-contract discriminator participates in every view-definition digest,
  producing manifest-addressed cache misses for old shapes without rewriting cache.
- Privacy tests prove no raw event/source/diff/prompt/completion/CodeGraph body enters
  projection, HTML, cache fixture, readback, or CLI/RPC output.
- No optional property, optional reader, legacy shape acceptance, compatibility
  adapter, fallback query, database migration, or event-body persistence is added.

# P1 · Architecture Map

- Public contract: `packages/contracts/src/ports.ts`.
- Runtime JSON Schema: `schemas/runtime/explorer-projection-v2.schema.json`.
- Canonical valid fixture and schema tests: `packages/contracts/fixtures/valid/
  explorer-projection-v2.json`, `packages/contracts/test/contracts.test.ts`.
- Compiler authority: `packages/local-runtime/runtime-daemon/src/
  explorer-projection.ts` and its focused tests.
- End-to-end daemon/cache pass-through: runtime daemon and local-store tests.
- Reader: `packages/local-runtime/explorer-html/src/index.ts` and Explorer surface test.
- Topology test fixture migrates only to satisfy the required public type.
- Readback: AR2 JSON/Markdown under `docs/verification/`.

This phase touches more than eight files because a required public contract change is
only safe as one atomic migration. Splitting it would create the forbidden dual shape.

# P2 · Concrete Flow

```text
bounded ledger metadata read
  -> ArchitectureEventBacklinkV1[] in input manifest
  -> canonicalize by eventId
       identical duplicate -> merge unique sorted subjectIds
       conflicting title/rationale -> fail closed
  -> group canonical events by subject
  -> inspector.historyEvents (all)
  -> inspector.decisions (title/rationale subset)
  -> backlinks.changedBy/decidedBy
  -> projection digest + cache write
  -> HTTP/RPC/CLI/HTML pass-through
```

There is no event-body load and no Inspector-owned storage/query.

# P3 · Decision

Keep schema version `archcontext.explorer-projection/v2` and perform an atomic pre-1.0
required-field cutover. Add an internal inspector-contract discriminator to the
view-definition digest instead of a compatibility V2.1 reader or a broad compiler
version migration. Old cache entries become unreachable manifest misses and remain
disposable.

# File Changes and Allowed Paths

- `packages/contracts/src/ports.ts`
- `schemas/runtime/explorer-projection-v2.schema.json`
- `packages/contracts/fixtures/valid/explorer-projection-v2.json`
- `packages/contracts/test/contracts.test.ts`
- `packages/local-runtime/runtime-daemon/src/explorer-projection.ts`
- `packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts`
- `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts`
- `packages/local-runtime/explorer-html/src/index.ts`
- `packages/local-runtime/explorer-html/test/topology.test.ts`
- `packages/surfaces/explorer-ui/test/explorer-ui.test.ts`
- `packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts`
- `docs/verification/explorer-ar2-inspector-history-readback.json`
- `docs/verification/explorer-ar2-inspector-history-readback.md`

No migration, database implementation, event schema/body, package/lockfile, or model
authority path is authorized.

# Test Plan

- Contract: missing `historyEvents` fails schema; valid empty/nonempty history passes;
  unknown/private history fields fail.
- Compiler: event-ID-only history, decision subset, duplicate merge, conflict failure,
  reversed input determinism, observed-only empty history, changed view digest.
- HTML: all typed Inspector fields/backlink arrays/cursor digests are visible and
  escaped; privacy denylist absent.
- Runtime/local store: projection with history survives cache/RPC/HTTP round-trip and
  lifecycle event backlinks appear after authority update.
- CLI/RPC/package: existing pass-through tests remain green with the required shape.
- Negative search: no `historyEvents?`, optional schema property, fallback history
  query, V1/V2 reader branch, or event-body field.

# Verification Commands

```bash
bun test packages/contracts/test/contracts.test.ts
bun test packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts
bun test packages/local-runtime/explorer-html/test/topology.test.ts
bun test packages/surfaces/explorer-ui/test/explorer-ui.test.ts
bun test packages/surfaces/cli/test/cli.test.ts
bun run typecheck
bun run verify:explorer
node scripts/privacy-route-audit.mjs
repo-harness run verify-contract --contract <ar2-contract> --strict
```

# Failure and Rollback

- Any incomplete caller migration, optional reader, or accepted old shape fails AR2.
- Any need for new DB/event-body storage or an unbounded query stops the phase.
- Rollback reverts the entire atomic contract/compiler/fixture/reader change; old cache
  rows were never mutated and become reachable only with the reverted view digest.

# Task Breakdown

- [x] Add required `historyEvents` to the public type, schema, and valid fixture.
- [x] Canonicalize/deduplicate event backlinks and fail closed on conflicts.
- [x] Compile complete history plus the decision-only subset for every subject.
- [x] Bind the Inspector contract discriminator into view-definition digests.
- [x] Render all Inspector, backlink, cursor, and digest facets in one focused surface.
- [x] Atomically migrate all typed fixtures/callers and cache/RPC/CLI pass-through tests.
- [x] Add schema/compiler/HTML/privacy/negative tests for missing, duplicate, conflict,
      empty, stale, cross-scope, and hostile content.
- [x] Record AR2 readback and pass the complete phase verification boundary.

# Definition of Done

Every `ExplorerProjectionV2` subject carries required canonical verified history,
every consumer uses the same shape, old cached shapes miss by digest, privacy remains
closed, and there is no optional/legacy/compatibility history path.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->
