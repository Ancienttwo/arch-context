# Plan: AR1 Navigation Accessibility CSP and Live Freshness

> **Status**: Archived
> **Created**: 20260712-0317
> **Slug**: ar1-navigation-live-freshness
> **Planning Source**: repo-harness-sprint
> **Orchestration Kind**: sprint-contract-row
> **Source Ref**: sprint:plans/sprints/20260712-0258-authority-aware-architecture-reading-completion.sprint.md#AR1
> **Artifact Level**: work-package
> **Promotion Reason**: worktree_boundary
> **Verification Boundary**: Fake runtime, Explorer surface, daemon HTTP/SSE/token, projection regression, typecheck, verify:explorer, and AR1 readback
> **Rollback Surface**: Code-only runtime script, topology viewport wrapper, and HTTP CSP header rollback; no state or public contract migration
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260712-0317-ar1-navigation-live-freshness.contract.md`
> **Task Review**: `tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md`
> **Implementation Notes**: `tasks/notes/20260712-0317-ar1-navigation-live-freshness.notes.md`

## Agentic Routing
- Selected route: think
- Routing reason: Captured from repo-harness-sprint planning output.
- Source ref: sprint:plans/sprints/20260712-0258-authority-aware-architecture-reading-completion.sprint.md#AR1
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260712-0317-ar1-navigation-live-freshness.md`
- Sprint contract: `tasks/contracts/20260712-0317-ar1-navigation-live-freshness.contract.md`
- Sprint review: `tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md`
- Implementation notes: `tasks/notes/20260712-0317-ar1-navigation-live-freshness.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260712-0317-ar1-navigation-live-freshness.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree; `.claude/.active-plan` is a legacy fallback during transition. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260712-0317-ar1-navigation-live-freshness.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260712-0317-ar1-navigation-live-freshness.md`.

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
- Contract file: `tasks/contracts/20260712-0317-ar1-navigation-live-freshness.contract.md`
- Review file: `tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md`
- Implementation notes file: `tasks/notes/20260712-0317-ar1-navigation-live-freshness.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260712-0317-ar1-navigation-live-freshness.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan`, the owning worktree is written to `.ai/harness/active-worktree`, and the plan is mirrored to `.claude/.active-plan` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260712-0317-ar1-navigation-live-freshness.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Code-only runtime script, topology viewport wrapper, and HTTP CSP header rollback; no state or public contract migration
- **Verification boundary**: Fake runtime, Explorer surface, daemon HTTP/SSE/token, projection regression, typecheck, verify:explorer, and AR1 readback
- **Review/acceptance boundary**: `tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: worktree_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260712-0317-ar1-navigation-live-freshness.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260712-0317-ar1-navigation-live-freshness.contract.md`, `tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md`, and `tasks/notes/20260712-0317-ar1-navigation-live-freshness.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260712-0317-ar1-navigation-live-freshness.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Code-only runtime script, topology viewport wrapper, and HTTP CSP header rollback; no state or public contract migration

## Captured Planning Output

# Objective

Make the AR0 topology navigable and live without changing Explorer semantics: exact
URL-addressed view/level/focus/expand state, transient accessible pan/zoom/fit, a
self-contained CSP, and distinct handling for the existing `authority-changed` and
`projection-invalidated` SSE contracts.

# Success Criteria

- View/level/focus/breadcrumb/group actions preserve token, budgets, task session,
  depth, and unrelated repeated `expand` values.
- Expand is an exact toggle: add a missing ID once or remove all instances of the
  selected ID; never append duplicates.
- Pan/zoom/fit changes only the SVG viewport transform and performs no request.
- Keyboard reaches/activates controls and topology subjects; `+`, `-`, `0` operate
  only outside editable controls; reduced motion disables animation.
- `authority-changed` always schedules one debounced exact-current-URL reload because
  it carries no view/projection digest.
- `projection-invalidated` schedules reload only for the current view-definition
  digest and a projection digest different from the rendered digest.
- Event parse failure, EventSource error, or token expiry closes the stream and exposes
  an explicit `live updates disconnected` state; no infinite retry/freshness claim.
- Explorer HTML responses set the exact self-contained CSP and no renderer/navigation
  emits external assets or executable URLs.
- Static SVG, relation table, and Inspector remain readable without JavaScript.
- No public contract, database, view/compiler semantic, compatibility runtime, ambient
  auth, retry fallback, or second navigation path is introduced.

# P1 · Architecture Map

- `packages/local-runtime/explorer-html/src/index.ts`: controls, URL state helpers,
  inline runtime, static disconnected state hook, CSS/accessibility.
- `packages/local-runtime/explorer-html/src/topology.ts`: one transformable viewport
  group; no semantic/layout change.
- `packages/local-runtime/explorer-html/test/runtime-script.test.ts`: fake
  window/document/EventSource runtime behavior without a browser dependency.
- `packages/surfaces/explorer-ui/test/explorer-ui.test.ts`: static HTML, accessibility,
  CSP/no-external-assets structure.
- `packages/local-runtime/runtime-daemon/src/index.ts`: HTML response CSP only; token,
  query, compiler, and SSE producer contracts remain unchanged.
- `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts`: real HTTP/SSE
  headers, event names/payload qualification, token expiry/error behavior.
- AR1 readback JSON/Markdown under `docs/verification/`.

# P2 · Concrete Flows

```text
click group
  -> URL clone
  -> remove exact existing expand values or append once
  -> preserve every unrelated parameter
  -> navigate once

visual zoom/pan/fit
  -> update transient viewport transform
  -> zero URL mutation and zero fetch

authority-changed
  -> debounce timer
  -> one window.location.reload()

projection-invalidated
  -> parse payload
  -> require current viewDefinitionDigest
  -> require different nonempty projectionDigest
  -> shared debounce timer
  -> one reload

EventSource error / malformed payload
  -> close source
  -> mark live status disconnected
  -> no fabricated freshness or retry loop
```

# P3 · Decision

Keep one inline runtime because Explorer is a local self-contained artifact. Extract
small pure URL/event/transform helpers in the same module and execute the generated
script in a minimal fake DOM/EventSource harness. Do not add jsdom/happy-dom, a client
framework, a service worker, or another auth/retry path.

The CSP is emitted by the daemon response, not a meta tag:

`default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src
'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'`

# File Changes and Allowed Paths

- `packages/local-runtime/explorer-html/src/index.ts`
- `packages/local-runtime/explorer-html/src/topology.ts`
- `packages/local-runtime/explorer-html/test/runtime-script.test.ts`
- `packages/surfaces/explorer-ui/test/explorer-ui.test.ts`
- `packages/local-runtime/runtime-daemon/src/index.ts`
- `packages/local-runtime/runtime-daemon/test/local-runtime.test.ts`
- `docs/verification/explorer-ar1-navigation-freshness-readback.json`
- `docs/verification/explorer-ar1-navigation-freshness-readback.md`

No contract/schema/compiler/package/lockfile/SQLite/ledger path is authorized.

# Test Plan

- URL: exact expand add/remove/deduplicate; view/level/focus/breadcrumb preservation.
- Runtime: both SSE types, matching/mismatching/identical/malformed payloads, burst
  debounce, error close, disconnected state.
- Visual: zoom/pan/fit transform only; keyboard and editable-control exclusion.
- Static: topology/table/Inspector/no-JS structure, reduced-motion and narrow CSS.
- HTTP: token-gated HTML CSP exact match; no external URL/asset; expired/invalid token
  remains fail closed with no ambient auth.
- Regression: Explorer projection/compiler and packaged HTML routes remain green.

# Verification Commands

```bash
bun test packages/local-runtime/explorer-html/test/runtime-script.test.ts
bun test packages/surfaces/explorer-ui/test/explorer-ui.test.ts
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
bun test packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
bun run typecheck
bun run verify:explorer
repo-harness run verify-contract --contract <ar1-contract> --strict
```

# Failure and Rollback

- Any need for a contract, query/compiler, database, or SSE producer semantic change
  stops AR1.
- Any compatibility runtime, retry fallback, ambient authentication, external asset,
  or executable URL fails the phase.
- Rollback reverts runtime script/topology wrapper/CSP header only; no state migration.

# Task Breakdown

- [x] Implement exact URL-state mutation helpers and group toggle semantics.
- [x] Add focus/breadcrumb navigation while preserving all unrelated query state.
- [x] Add transient fit/zoom/pan and keyboard/reduced-motion behavior.
- [x] Implement distinct debounced handling for both current SSE event contracts.
- [x] Add explicit disconnected state and close-on-error behavior.
- [x] Set and test the exact daemon CSP and no-external-assets boundary.
- [x] Add fake-runtime, surface, HTTP/SSE, token, and regression coverage.
- [x] Record AR1 readback and pass the complete phase verification boundary.

# Definition of Done

AR1 is independently usable and mergeable: topology navigation is URL-stable,
visual interaction is transient, live freshness is exact and fail-closed, CSP is
enforced, and there remains one semantic/runtime path with no compatibility code.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->
