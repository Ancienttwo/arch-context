# Plan: Authority-Aware Architecture Reading Completion

> **Status**: Approved
> **Created**: 20260712-0225
> **Slug**: authority-aware-architecture-reading-completion
> **Planning Source**: repo-harness-plan
> **Orchestration Kind**: complex-engineering-plan
> **Source Ref**: OMM main@38ccdb69298adec949177c92c88d6e3ddfb5bab7; ADR-0044; ADR-0045; EV0-EV4; DE0-DE5
> **Artifact Level**: work-package
> **Promotion Reason**: risk_boundary
> **Verification Boundary**: AR0-AR4 each require focused tests and phase evidence; final closeout requires renderer benchmarks, browser/design acceptance, packaged smoke, privacy audit, full bun run verify, architecture/security review, and clean workflow markers
> **Rollback Surface**: Code-only renderer/view rollback plus disposable manifest-addressed cache rebuild; authoritative Git model, ledger events, evidence, snapshots, and user-authored docs are never deleted or SQL-reversed
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Program Contract**: created only after approval; orchestration-only and may not grant implementation paths
> **Phase Contracts**: one AR0-AR4 contract/review/notes set per merge unit
> **Implementation Authorization**: approved by the user on 2026-07-12; each AR phase
> still requires its own bounded contract and verification evidence.

## Agentic Routing
- Selected route: gstack:plan-eng-review
- Routing reason: Captured from repo-harness-plan planning output.
- Source ref: OMM main@38ccdb69298adec949177c92c88d6e3ddfb5bab7; ADR-0044; ADR-0045; EV0-EV4; DE0-DE5
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260712-0225-authority-aware-architecture-reading-completion.md`
- Program contract: represented by the approved Sprint backlog; it remains
  orchestration-only and grants no implementation paths.
- Phase reviews/notes: one file-coupled set per AR0-AR4 merge unit.
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: each phase contract's `allowed_paths`; no program-level implementation grant.
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree; `.claude/.active-plan` is a legacy fallback during transition. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: after program approval, project only the active AR phase plan
  through `repo-harness run plan-to-todo --plan <phase-plan>` and start its isolated
  worktree with `repo-harness run contract-worktree start --plan <phase-plan>`.

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
- Program contract: create only after approval; it coordinates phase order but grants no implementation paths.
- Phase contract/review/notes: create one set for each AR0-AR4 merge unit.
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract <active-phase-contract> --strict`
- Active plan rule: this approved program plan owns the current worktree until the
  Sprint is projected; during implementation, the active AR phase plan replaces it in
  `.ai/harness/active-plan` and `.claude/.active-plan` while the worktree owner remains
  recorded in `.ai/harness/active-worktree`.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: this file is the complete program authority, not one PR. AR0-AR4 are separate merge units and each requires its own bounded contract.
- **Rollback surface**: Code-only renderer/view rollback plus disposable manifest-addressed cache rebuild; authoritative Git model, ledger events, evidence, snapshots, and user-authored docs are never deleted or SQL-reversed
- **Verification boundary**: AR0-AR4 each require focused tests and phase evidence; final closeout requires renderer benchmarks, browser/design acceptance, packaged smoke, privacy audit, full bun run verify, architecture/security review, and clean workflow markers
- **Review/acceptance boundary**: every phase review must pass its contract; AR4 records integrated program acceptance.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: risk_boundary

## Evidence Contract

- **State/progress path**: this plan's task breakdown, `tasks/todos.md`, and the active AR phase's contract/review/notes artifacts.
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260712-0225-authority-aware-architecture-reading-completion.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Code-only renderer/view rollback plus disposable manifest-addressed cache rebuild; authoritative Git model, ledger events, evidence, snapshots, and user-authored docs are never deleted or SQL-reversed

## Captured Planning Output

# Objective

Complete the remaining high-value Oh My Mermaid reading experience without
copying its weak authority, security, or scale model. The finished ArchContext
Explorer must let a user see topology, move between bounded semantic levels,
inspect typed rationale and history, and open question-oriented data-flow and
external-integration views while every rendered fact remains cursor-bound to
`ExplorerProjectionV2`.

This is the full reading-experience program after EV0-EV4 and DE0-DE5. It is not
a single implementation PR. Each AR phase is a separately contracted,
reviewable merge unit with its own allowed paths and acceptance evidence.

# Outcome

The program is complete only when all six properties hold:

1. `overview`, `context`, and `detail` render a real bounded topology rather
   than a card list that hides relation geometry.
2. Visual zoom, pan, fit, group expansion, focus, and breadcrumbs never preload
   an unbounded tree and never change architecture semantics locally.
3. A browser refetch caused by navigation or SSE preserves the token, query,
   budget, and daemon-owned repository/worktree authority.
4. The Inspector exposes the complete existing typed reading surface: summary,
   responsibility, constraints, decisions, selectors, evidence bindings,
   relation backlinks, task backlinks, and event history. Missing inputs are
   explicit empty or unavailable states, never fabricated prose.
5. `data-flow` and `external-integrations` are compiled from the existing typed
   node/relation vocabulary and readiness policy, not filenames, Mermaid text,
   LLM containment, or regex inference.
6. The packaged local product remains loopback-only, token-gated, GET-only,
   read-only, self-contained, no-store, no-egress, budget-bounded, deterministic,
   accessible, and measurable at the public maximum query budget.

# Workflow Inventory

- Active plan before capture: none; `.ai/harness/active-plan`,
  `.ai/harness/active-worktree`, and `.claude/.active-plan` are absent.
- Program plan: this captured `plans/plan-*-authority-aware-architecture-reading-completion.md`.
- Expected phase contracts after explicit implementation approval:
  - `tasks/contracts/<stem>-ar0-topology-kernel.contract.md`
  - `tasks/contracts/<stem>-ar1-navigation-live-refresh.contract.md`
  - `tasks/contracts/<stem>-ar2-inspector-history.contract.md`
  - `tasks/contracts/<stem>-ar3-domain-perspectives.contract.md`
  - `tasks/contracts/<stem>-ar4-product-readback.contract.md`
- Expected review/notes: one matching review and notes artifact per phase; the
  program plan itself does not authorize implementation.
- Deferred-goal ledger: `tasks/todos.md`; do not duplicate the AR checklist there.
- Current checks: `.ai/harness/checks/latest.json` is currently `{}`; new phase
  evidence must be written under `.ai/harness/runs/` and durable readbacks under
  `docs/verification/`.
- Allowed-path authority: each phase contract. No parent contract may grant all
  AR0-AR4 paths to one worker.
- Worktree isolation: after approval, project each phase with
  `repo-harness run plan-to-todo --plan <plan>` and
  `repo-harness run contract-worktree start --plan <phase-plan>`; preserve the
  existing untracked `.ai/harness/delegation/subagent-stop-quality.json`.
- Public next action after approval: create the ordered Sprint and project AR0 through
  its bounded phase plan/contract before editing implementation code.

# P1 · Global Architecture Map

## Real components and ownership

| Component | Current responsibility | Program responsibility | Authority |
|---|---|---|---|
| `packages/contracts/src/ports.ts` + runtime schemas | Explorer V2 query, occurrence, relation, inspector, cursor, manifest, budgets | Atomic public-shape changes for inspector and new views only | Public contract authority |
| `packages/local-runtime/runtime-daemon/src/explorer-projection.ts` | Pure deterministic view compilation | Compile two new typed views and required verified inspector history | Projection semantics authority |
| `packages/local-runtime/runtime-daemon/src/index.ts` | Session, bounded reads, token HTTP, cache, SSE | Preserve query state; make both authority and projection invalidations observable | Runtime orchestration authority |
| `packages/local-runtime/explorer-html/src/index.ts` | Self-contained card/table HTML | Render topology shell, Inspector, controls, accessible states | Replaceable read projection |
| new internal `packages/local-runtime/explorer-html/src/topology.ts` | Does not exist | Pure deterministic layout and SVG rendering over bounded V2 inputs | No domain authority |
| `packages/surfaces/explorer-ui` | Thin export and surface tests | User-facing acceptance over the local renderer | No authority |
| `scripts/explorer-view-compiler-readback.mjs` | Compiler scale/privacy readback | Add renderer/layout size, time, determinism, and no-egress readback | Verification only |
| Git-visible `.archcontext/` | Architecture facts | Unchanged | Product architecture authority |
| SQLite feed/cache/dependency index | Durable invalidation and disposable derived state | Reused unchanged unless a verified gap appears | Operational state only |

Scale signals:

- Current HTTP defaults are 80 nodes / 160 relations; the public contract permits
  up to 1,000 nodes / 5,000 relations.
- Current `renderMap` filters all relations once per subject, making the rendering
  path O(nodes x relations); AR0 replaces this with one O(nodes + relations)
  adjacency-index pass.
- The V1 Explorer implementation at commit `16f1f36` already contains safe,
  self-contained hand-written SVG patterns for status bands and focused 1-hop
  diagrams. AR0 ports and hardens those patterns instead of adopting OMM's CDN
  Dagre/Marked runtime or adding a new layout dependency.
- OMM's recursive viewer preloads every nested class and lays out up to six levels.
  ArchContext will never use preload depth as its scale boundary; the projection
  query and read plan remain the only data boundary.

## Strong dependencies

- `ExplorerProjectionV2` remains the only renderer input.
- Repository/worktree/cursor identity remains daemon-owned.
- Navigation changes query parameters and refetches; browser code never creates a
  canonical subject, relation, group, fact, or evidence binding.
- New view definitions must declare complete input-domain requirements and change
  the view-definition/manifest digest.
- SSE transports digests/cursors only; it is not the durable queue.

## Weak dependencies

- SVG geometry, colors, controls, and visual scale are replaceable.
- Topology layout output is not persisted in ledger, cache dependencies, or Git.
- A renderer rollback cannot alter architecture facts, evidence, snapshots, or
  cached projection bodies.

## Explicitly out of scope boundary

- This program reads existing typed authority. It does not create a second model,
  filesystem hierarchy, Mermaid parser, editor, or cloud document store.
- No database migration is planned. Any proposed migration is a stop condition and
  requires a separate ADR/contract because the current projection already carries
  every topology identity required by AR0-AR2.

# P2 · Concrete Data Flows

## Initial topology read

```text
archctx explore start
  -> daemon creates loopback token session
  -> GET /?view=system-map&level=context&depth=1&maxNodes=80&maxRelations=160
  -> parse ExplorerProjectionQueryV2
  -> compile ProjectionReadPlanV1
  -> bounded Git/SQLite authority read
  -> manifest-addressed cache hit OR compile ExplorerProjectionV2
  -> topology renderer builds adjacency index once
  -> deterministic server-rendered SVG + typed Inspector + controls
  -> browser receives no raw source, diff, prompt, or external asset URL
```

The source of truth is the returned projection cursor and manifest. SVG position,
collapsed labels, visual scale, and selected panel are presentation state only.

## Group expansion and focus

```text
overview derived group click
  -> toggle exact occurrence ID in repeated `expand` query params
  -> GET fresh bounded overview projection
  -> expanded subjects remain parented to the derived group

subject click
  -> set `focus=<canonical subject id>`
  -> set `level=detail` (or preserve an explicit context choice)
  -> daemon plans focused-neighborhood read at requested depth
  -> render incoming | focus | outgoing lanes
  -> breadcrumb and Inspector use the same returned projection
```

Collapse removes only the exact `expand` value. Token, view, depth, budgets, task
session, and unrelated expanded groups remain in the URL. Invalid group/focus IDs
continue to fail closed in the compiler.

## Visual progressive disclosure

```text
fit / wheel / keyboard zoom
  -> update transient SVG transform only
  -> low scale: group + subject names and primary edges
  -> medium scale: status, authority, relation kind
  -> high scale: secondary metadata and edge labels
```

Visual zoom never changes semantic level and never triggers a data request. Semantic
resolution changes only through explicit overview/context/detail navigation.

## Durable invalidation to browser refetch

```text
ChangeSet / daemon event append
  -> transactional typed change feed commit
  -> affected occurrence lookup + cache invalidation
  -> digest-only `authority-changed` SSE
  -> browser debounce/coalesce and unconditional refetch
  -> token-authenticated refetch of current URL
  -> fresh projection digest
  -> `projection-invalidated` SSE for projection-addressed invalidation
```

The browser must listen to both current event names, but their contracts differ:

- `authority-changed` carries no view/projection digest, so every accepted event causes
  one debounced refetch of the exact current URL.
- `projection-invalidated` causes a refetch only when its `viewDefinitionId` matches
  the current view and its projection digest differs from the rendered digest.

Multiple qualifying events in one debounce window cause one reload. EventSource
error/expiry closes the stream and shows a local "live updates disconnected" state;
it does not retry forever or imply freshness.

## Domain perspective compile

```text
view=data-flow
  -> select typed relations: reads | writes | publishes | subscribes
  -> include exact relation endpoints and accepted observed overlays
  -> preserve protocol/synchrony/data fields only when present in authority

view=external-integrations
  -> seed typed entity kind: external-system
  -> include bounded adjacent typed relations/endpoints
  -> no name/path/LLM/regex inference
```

An authoritative graph with zero matching relations is an explicit empty view, not
an unavailable or failed view. A missing required input domain remains fail-closed.

# P3 · Design Decision

## Core decision: topology is a bounded projection consumer

Do not port OMM's filesystem tree, duplicate Mermaid parsers, full recursive preload,
or CDN layout engine. Port the user interaction principles onto the existing V2
contract: question-oriented views, visible relations, focus, backlinks, and
progressive disclosure.

This preserves the key invariant: geometry may be wrong or ugly without making an
architecture fact wrong. A renderer defect is reversible; a shadow authority is not.

## Why the current shape exists

EV0-EV4 deliberately established the authority, cursor, budget, inspector, and SSE
protocol before investing in a canvas. DE0-DE5 then made the underlying delta,
feed, replay, manifest, bounded-read, and cache paths trustworthy. The card renderer
was an appropriate bootstrap consumer, but it now hides the relation geometry that
the completed engine can safely provide.

## Smallest coherent design

- Reuse `ExplorerProjectionV2`; do not introduce a topology wire contract.
- Recover and adapt the previous self-contained SVG code from commit `16f1f36`.
- Add one internal pure topology module inside the existing explorer-html package;
  do not create a new workspace package or third-party runtime dependency.
- Use three explicit layouts rather than a general graph-layout framework:
  - overview: sorted group tiles with bounded expanded children;
  - context: status/authority bands with visible typed edges;
  - detail: focus-centered incoming/focus/outgoing lanes over the bounded neighborhood.
- Pre-index occurrences and relations once. Never scan every edge for every node.
- Keep the relation table as an accessible textual equivalent of the SVG.

## 10x behavior

At the current public maximum, the first risk is DOM/SVG size and O(N x E) renderer
work, not authority reads. AR0 makes renderer computation O(N + E), keeps DOM output
linear in returned projection size, and benchmarks default and maximum budgets.
No hidden subtree or complete graph may be fetched to improve layout.

# Renderer Contract

The internal topology module accepts only:

```ts
interface RenderExplorerTopologyInput {
  projection: ExplorerProjectionV2;
  focusSubjectId?: string | null;
}
```

It returns an immutable render plan plus SVG:

```ts
interface ExplorerTopologyRenderPlan {
  mode: "overview-groups" | "context-bands" | "detail-focus";
  width: number;
  height: number;
  nodes: Array<{
    occurrenceId: string;
    subjectId: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    visualRole: "group" | "subject";
  }>;
  edges: Array<{
    occurrenceId: string;
    sourceOccurrenceId: string;
    targetOccurrenceId: string;
    points: Array<{ x: number; y: number }>;
  }>;
  omitted: { nodes: number; relations: number };
}
```

These are internal TypeScript interfaces, not exported public contracts and not
persisted. Identical projection + focus input must produce byte-identical plan/SVG.

## Geometry rules

- Canonical ordering is by occurrence ID, then relation occurrence ID.
- Coordinates are finite integers inside declared viewBox bounds.
- Long labels are truncated visually but retain full accessible text/title.
- Parallel edges receive stable offsets; self-loops receive a visible loop path.
- Missing edge endpoints are rejected by the internal renderer invariant test rather
  than silently drawn to `(0,0)`.
- Cycles are rendered; they do not enter recursive layout logic.
- Disconnected subjects appear in a labeled overflow band.
- Derived groups never receive canonical subject IDs or mutation controls.

# Browser Interaction Contract

- All semantic state is URL-addressable: `view`, `level`, `focus`, repeated `expand`,
  `depth`, budgets, task session, and token.
- Visual pan/zoom is transient and resettable; it is not written to the URL.
- Expand is a toggle, not append-only.
- Clicking a subject uses its canonical subject ref, never its occurrence ID, for
  focus queries.
- Keyboard: Tab reaches controls/nodes; Enter/Space activates; `+`, `-`, and `0`
  zoom/reset only when focus is not in an input.
- `prefers-reduced-motion` disables animated transforms.
- Relation table and Inspector remain usable without JavaScript.
- The HTML response sets a self-contained CSP:
  `default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline';
  script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  No renderer, navigation, or label may introduce an external asset or executable URL.

# Inspector 2.0 Contract

AR2 first renders every existing typed field before changing the public schema:

- summary and responsibility;
- constraints with severity/summary;
- decisions with event ID/title/rationale;
- source selectors;
- accepted evidence-binding IDs;
- appears-in views, affected task sessions, constrained/evidenced/changed/decided
  backlinks;
- incoming/outgoing relation IDs;
- authority/evidence cursors and manifest/projection digests in a collapsed technical
  details section.

AR2 adds one required field to `ExplorerInspectorV2` in an atomic V2 cutover:

```ts
historyEvents: Array<{
  eventId: string;
  title?: string;
  rationale?: string;
}>;
```

It is sourced only from verified event backlinks already included in the input
manifest. Contract, schema, fixtures, compiler, HTML, CLI/RPC consumers, and tests
migrate together with no optional compatibility reader. Events are deduplicated by
`eventId` and canonically sorted by `eventId`; the existing `decisions` field remains
the decision-only subset rather than a second history source. Intervention bodies,
arbitrary notes, and free-form annotations remain out of scope.

# Domain Perspective Contract

AR3 extends `ExplorerViewIdV2` atomically with:

- `data-flow`: `reads`, `writes`, `publishes`, `subscribes`;
- `external-integrations`: `external-system` entities plus their bounded adjacent
  typed relations and endpoints.

Each view must provide:

- question, title, typed relation/entity predicates;
- full input-domain requirements;
- deterministic view-definition digest;
- empty-state behavior;
- overview grouping rule;
- focused-neighborhood behavior;
- Inspector/backlink behavior;
- positive, negative, stale-cursor, budget, and no-semantic-inference tests.

No view may classify a flow or external system from names, file paths, Mermaid text,
CodeGraph prose, or LLM output.

# Program Phases

## AR0 · Topology kernel and renderer cutover

- [ ] Extract current HTML helpers and add one internal pure topology module.
- [ ] Port the V1 self-contained status-band and focused-neighborhood SVG patterns
      from commit `16f1f36`; do not restore the V1 projection contract.
- [ ] Build O(N + E) occurrence, adjacency, incoming, and outgoing indexes.
- [ ] Implement overview-group, context-band, and detail-focus render plans.
- [ ] Render typed edges, parallel edges, self-loops, disconnected nodes, long labels,
      empty results, truncation notice, and missing-endpoint failure.
- [ ] Retain the textual relations table and typed Inspector as accessible equivalents.
- [ ] Acceptance: reversed input produces identical plan/SVG; default and public-max
      budgets stay inside render/size budgets; no external assets or new dependency.

Allowed-path target for the AR0 child contract, at most 7 files:

- `packages/local-runtime/explorer-html/src/index.ts`
- `packages/local-runtime/explorer-html/src/topology.ts`
- `packages/local-runtime/explorer-html/test/topology.test.ts`
- `packages/surfaces/explorer-ui/test/explorer-ui.test.ts`
- `scripts/explorer-view-compiler-readback.mjs`
- one durable readback JSON and one Markdown report under `docs/verification/`

## AR1 · Navigation, progressive disclosure, and live freshness

- [ ] Add fit/zoom/pan controls and scale-driven label disclosure over the already
      bounded SVG only.
- [ ] Add group expand/collapse toggling that preserves all unrelated query state.
- [ ] Add subject focus/detail navigation and breadcrumb return paths.
- [ ] Refetch unconditionally for debounced `authority-changed`; refetch for
      `projection-invalidated` only on matching view and changed digest.
- [ ] Surface EventSource disconnect/expiry as an explicit non-fresh UI state.
- [ ] Set and test the self-contained CSP; prohibit external assets and executable
      navigation targets.
- [ ] Preserve token, budgets, task session, view, semantic level, depth, and expanded
      groups across navigation and refresh.
- [ ] Add keyboard, reduced-motion, narrow viewport, and JavaScript-disabled behavior.
- [ ] Acceptance: no browser action mutates or synthesizes projection semantics;
      rapid invalidations cause one bounded refetch and never a reload loop.

AR1 remains in explorer-html/surface/runtime tests. No contract or database change is
allowed. If implementation requires either, stop and revise the phase contract.

## AR2 · Inspector 2.0 and typed history parity

- [ ] Render every currently available typed Inspector/backlink/cursor facet.
- [ ] Prove no source body, event body, prompt, completion, or raw diff enters HTML.
- [ ] Atomically add required `historyEvents: []` to the V2 contract, schema,
      compiler, fixtures, callers, and HTML; do not add optional fallback parsing or
      a second history query path.
- [ ] Add empty/unavailable/stale/cross-scope and long-content tests.
- [ ] Acceptance: the user can answer responsibility, why, constraints, evidence,
      dependencies, tasks, and change history from one focused view.

## AR3 · Typed data-flow and external-integration perspectives

- [ ] Extend the public view union/schema/fixtures atomically.
- [ ] Add view definitions and complete input-domain policies.
- [ ] Compile data-flow only from typed flow relations.
- [ ] Compile external integrations only from typed external-system entities and
      bounded adjacent relations.
- [ ] Add deterministic overview groups, context/detail focus, backlinks, empty
      states, and budget accounting for both views.
- [ ] Change view-definition digests so existing cache rows cannot masquerade as the
      new semantics; rely on manifest-addressed cache miss, not cache mutation.
- [ ] Add CLI/HTTP/HTML/schema/packaged-product tests in the same atomic cutover.
- [ ] Acceptance: adversarial names and paths cannot enter either view without typed
      authority; zero matching relations produces an honest empty result.

## AR4 · Product readback, design review, and closeout

- [ ] Extend `verify:explorer` with renderer determinism, HTML size, render p95,
      privacy, and maximum-budget evidence.
- [ ] Add local browser acceptance for group toggle, focus, zoom, both SSE event types,
      token expiry, empty state, truncation, and narrow viewport.
- [ ] Run `/plan-design-review` against real local screenshots before implementation
      is declared complete; visual approval cannot replace machine checks.
- [ ] Run focused tests, typecheck, packaged CLI smoke, privacy audit, full
      `bun run verify`, Architecture review, and Security review.
- [ ] Update ADR-0044 only if the accepted view or renderer boundary changes; do not
      rewrite ADR-0045 data-engine authority.
- [ ] Complete matching notes/review/readback and prove no active contract/worktree
      marker remains after merge.

# Performance Budgets

Measured on the current development host and recorded with fixture counts:

- Default 80-node / 160-relation renderer: p95 <= 50 ms over at least 20 warm runs.
- Public maximum 1,000-node / 5,000-relation renderer: p95 <= 500 ms over at least
  10 warm runs.
- Default HTML body <= 1 MiB; public-maximum HTML body <= 8 MiB.
- Renderer work is O(N + E); tests instrument adjacency construction and prohibit
  per-node full relation scans.
- DOM/SVG element count is linear in returned occurrences + relations, with a
  documented constant-factor ceiling.
- Visual zoom/pan causes zero network requests; semantic navigation causes one request.
- One invalidation burst inside the debounce window causes one refetch.

If representative evidence cannot meet these limits, AR0 stops for measured budget
revision rather than silently hiding nodes or increasing compiler budgets.

# Failure Modes and Required Handling

| Failure | Required behavior | Test |
|---|---|---|
| Empty projection | Honest empty topology with working controls and static Inspector | renderer unit + HTML acceptance |
| Relation endpoint missing | Fail renderer invariant; never draw phantom endpoint | critical unit regression |
| Self-loop / cycle / parallel edges | Visible stable geometry and accessible table rows | topology unit |
| Very long or hostile label | Escaped output, visual truncation, full accessible title | XSS/length unit |
| Group expansion ID stale | Existing compiler invalid-query response; no local guess | HTTP integration |
| Focus subject omitted by cursor/budget | Existing fail-closed query error and recoverable navigation | compiler + HTTP integration |
| Rapid feed burst | One debounced refetch | runtime-script behavior test |
| Token expires | SSE closes; visible disconnected/freshness state; no ambient auth fallback | daemon integration |
| External asset or executable navigation injection | CSP blocks it and renderer emits no such URL | HTML/CSP/XSS integration |
| Projection changes during navigation | Daemon returns one fresh cursor; browser renders that cursor only | HTTP integration |
| Max-budget projection | Linear render, bounded body, no event-loop stall beyond budget | benchmark readback |
| JavaScript disabled | Static SVG, relation table, Inspector remain readable | HTML structure test |
| Cache fully evicted | Recompile from authority; renderer output unchanged | existing DE5 integration + readback |

No failure may silently replace topology with fabricated relations or hide an
authority error behind a card fallback.

# Test Coverage Plan

```text
CODE PATHS                                      USER FLOWS
AR0 topology plan                               Open Explorer
  |- empty                                      |- context topology visible
  |- overview groups                            |- relation table equivalent
  |- context bands                              `- honest truncation/empty states
  |- detail focus
  |- cycle/self-loop/parallel/missing endpoint  Navigate
  |- long/XSS labels                            |- expand + collapse exact group
  `- reversed-input determinism                 |- focus subject + breadcrumb back
                                                `- preserve token/query/budgets
AR1 runtime script
  |- visual zoom/pan/fit                        Live freshness
  |- keyboard/reduced motion                    |- authority-changed -> one refetch
  |- URL state toggles                          |- projection-invalidated -> one refetch
  |- SSE debounce                               `- expiry -> disconnected state
  `- EventSource error

AR2 inspector                                  Domain views
  |- complete typed facets                      |- data-flow typed positive/empty
  |- unavailable/empty history                  |- external typed positive/empty
  `- privacy denylist                          `- adversarial name/path negative
```

Required suites:

- Pure Bun unit tests for topology plan/SVG and runtime URL/event helpers. Execute the
  generated inline script in a small fake `window`/`document`/`EventSource` harness;
  do not add jsdom, happy-dom, or another browser dependency for this phase.
- Explorer surface tests for HTML, accessibility, privacy, and no external assets.
- Runtime daemon HTTP/SSE integration tests for token, query preservation, event
  coalescing, invalid IDs, and expiry.
- Contract/schema/compiler tests for any AR2/AR3 public-shape change.
- Packaged CLI smoke for the real `archctx explore` artifact.
- `verify:explorer` default/max benchmark and privacy readback.
- Browser/design acceptance is required in AR4 but never substitutes for automated
  assertions.

# Verification Commands

Each phase contract selects a focused subset; AR4 runs the complete matrix:

```bash
bun test packages/local-runtime/explorer-html/test/topology.test.ts
bun test packages/surfaces/explorer-ui/test/explorer-ui.test.ts
bun test packages/local-runtime/runtime-daemon/test/explorer-projection.test.ts
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
bun test packages/contracts/test/contracts.test.ts
bun run typecheck
bun run verify:explorer
node scripts/packaged-cli-smoke.mjs
node scripts/privacy-route-audit.mjs
bun run verify
repo-harness run verify-contract --contract <phase-contract> --strict
```

# Migration and Rollback

- AR0/AR1 renderer changes are code-only and reversible by restoring the current
  card renderer. No runtime state migration or cache rewrite is allowed.
- AR2 public contract change is an atomic pre-1.0 V2 cutover; all fixtures/callers
  migrate together and no compatibility reader remains.
- AR3 view additions change view-definition and manifest digests. Old cache rows are
  disposable misses and may be collected normally; they are never rewritten to new
  semantics.
- Rollback removes the new views/renderer code and lets manifest-addressed cache
  rebuild. It never deletes ledger events, evidence, snapshots, Git model files, or
  user-authored documentation.
- A rollback that requires SQLite surgery is evidence that the implementation crossed
  the approved boundary and must not ship.

# Worktree and Sequencing Strategy

Sequential implementation is preferred because AR0-AR3 converge on explorer-html,
runtime-daemon, and the Explorer contracts.

| Phase | Modules | Depends on |
|---|---|---|
| AR0 | explorer-html, explorer-ui tests, readback | EV/DE complete |
| AR1 | explorer-html runtime script, daemon HTTP/SSE tests | AR0 |
| AR2 | contracts, schemas, explorer compiler, explorer-html | AR1 |
| AR3 | contracts, schemas, explorer compiler, daemon/CLI/HTML | AR2 |
| AR4 | scripts, verification docs, reviews | AR0-AR3 |

Lane A: AR0 -> AR1 -> AR2 -> AR3 -> AR4. Do not parallelize adjacent phases that
share the same public contract or renderer. Independent design screenshot review may
run alongside AR3 tests, but it cannot edit implementation files.

# What Already Exists and Is Reused

- `ExplorerProjectionV2` occurrences, derived groups, relations, breadcrumbs,
  Inspector, backlinks, budgets, cursor, manifest, and capabilities.
- `ProjectionReadPlanV1` overview/context/focused-neighborhood bounded reads.
- Token-gated loopback Explorer HTTP and digest-only SSE.
- Transactional typed change feed and occurrence dependency index.
- Manifest-addressed cache with bounded lifecycle and metrics.
- V1 self-contained SVG status-band/focus patterns in Git history at `16f1f36`.
- Current relation table, search filter, typed Inspector, and semantic-level controls.
- Existing relation vocabulary already includes `reads`, `writes`, `publishes`,
  `subscribes`, and entity kind `external-system`.

The plan extends these flows; it does not rebuild the engine or introduce a general
canvas framework.

# NOT in Scope

- Mermaid as data or delta authority, Mermaid import, or a Mermaid semantic parser.
- OMM filesystem perspectives, seven free-form files per element, regex refs/diff,
  `fs.watch` authority, full recursive preload, or CDN Dagre/Marked/fonts.
- Drag/drop editing, free-form edges, layout persistence, collaborative editing, or
  browser-originated ChangeSets.
- Cloud architecture-content sync, public sharing, or multi-writer consensus.
- Global Subject Search, FTS/Jieba/vector retrieval, or natural-language search;
  those remain a separate retrieval program.
- LLM-generated recursive architecture truth or automatic direct model mutation.
- Guided Architecture Tour and proposal-only recursive onboarding; revisit after
  AR3 proves the typed view catalog and AR4 design readback.
- New database tables, SQLite migration, event schema changes, or ledger promotion.
- Lifecycle/storage/state-transition views until a later contract proves their
  typed vocabulary and user value.

# Stop Conditions

Stop the active phase and revise its plan/contract if any implementation requires:

- unbounded graph/tree preload;
- name/path/regex/LLM semantic classification;
- topology geometry in a public authority contract or persistent store;
- a new layout/runtime dependency before proving the existing V1 SVG patterns are
  insufficient;
- raw source, raw diff, prompt/completion, full CodeGraph output, or event bodies in
  HTML/SSE/cache/readback;
- caller-owned repository/worktree/cursor authority;
- a compatibility fallback or parallel V1/V2 semantic path;
- a database migration or direct SQLite/Git model edit;
- a phase contract spanning more than its named merge unit;
- performance budgets met only by silently dropping returned projection items.

# Task Breakdown

- [ ] AR0: Land deterministic bounded topology kernel and renderer cutover.
- [ ] AR1: Land group/focus navigation, visual progressive disclosure, and complete
      live-freshness handling plus the self-contained CSP boundary.
- [ ] AR2: Land complete typed Inspector/history parity with one atomic required
      `historyEvents` contract change.
- [ ] AR3: Land typed `data-flow` and `external-integrations` views.
- [ ] AR4: Complete benchmark, browser/design, privacy, package, full verification,
      review, rollback, and artifact closeout.
- [ ] Prove every phase stayed inside its authority and allowed-path boundary.
- [ ] Finish with no active plan/contract/worktree markers and no modification to the
      preserved untracked delegation artifact.

# Definition of Done

- All AR0-AR4 checklists and phase contracts are complete.
- Every focused suite, `verify:explorer`, packaged smoke, privacy audit, and full
  `bun run verify` pass from the final integrated commit.
- Default/max renderer readback meets the declared time/body/complexity budgets.
- Browser evidence covers desktop/narrow viewport, keyboard, reduced motion, group
  toggle, focus, both SSE events, token expiry, empty and truncated results.
- Architecture and Security reviews have no unresolved ship blocker.
- Design review accepts the reading hierarchy using real local projections.
- Final notes name all tradeoffs, deviations, and remaining deferred work.
- User approval was recorded on 2026-07-12. Implementation authorization is still
  bounded by the active AR phase contract; approval does not authorize compatibility
  paths, authority bypasses, or cross-phase scope expansion.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Implementation Tasks

- [ ] **T1 (P1, human: ~3d / Codex: ~4h)** — Explorer topology — land the
  deterministic bounded topology kernel.
  - Surfaced by: Architecture + performance — the current card renderer hides
    relation geometry; the replacement must remain a pure O(N + E) projection consumer.
  - Files: `packages/local-runtime/explorer-html/src/topology.ts`,
    `packages/local-runtime/explorer-html/src/index.ts`, topology/surface tests, and
    bounded readback artifacts named by the AR0 child contract.
  - Verify: deterministic reversed-input fixtures, cycle/self-loop/parallel/
    disconnected cases, XSS/length cases, and default/max render/body budgets.
- [ ] **T2 (P1, human: ~2d / Codex: ~3h)** — Explorer navigation — land URL-safe
  navigation, accessibility, CSP, and exact SSE behavior.
  - Surfaced by: Data-flow + security — the runtime currently consumes only one event
    name and needs explicit qualification, freshness, and external-asset boundaries.
  - Files: explorer HTML/runtime helpers, surface tests, daemon SSE/HTTP tests, and
    AR1 readback artifacts.
  - Verify: fake browser-runtime harness, HTTP/SSE integration, expiry, debounce,
    query preservation, CSP/no-external-assets, and local browser acceptance.
- [ ] **T3 (P1, human: ~2d / Codex: ~3h)** — Explorer Inspector — atomically add
  typed history parity.
  - Surfaced by: Product contract — decisions alone do not expose the complete verified
    event backlink history required by the reading experience.
  - Files: `packages/contracts/src/ports.ts`, contract/schema/compiler/daemon/HTML
    consumers, fixtures, tests, and AR2 readback artifacts.
  - Verify: contract/schema/compiler/RPC/CLI/HTML parity; privacy denylist; empty,
    stale, cross-scope, duplicate-event, and long-content cases.
- [ ] **T4 (P1, human: ~3d / Codex: ~4h)** — Explorer views — add typed
  `data-flow` and `external-integrations` perspectives.
  - Surfaced by: Scope review — the engine already carries the typed vocabulary but
    the public question-oriented view catalog does not expose it.
  - Files: public view contract/schema, compiler definitions, CLI/HTTP/HTML consumers,
    fixtures, packaged tests, and AR3 readback artifacts.
  - Verify: typed positive/empty/negative cases, adversarial names/paths, stale cursor,
    budget accounting, digest-addressed cache miss, and packaged CLI behavior.
- [ ] **T5 (P1, human: ~2d / Codex: ~3h)** — Explorer verification — close the
  integrated product readback.
  - Surfaced by: Test/ship review — the program needs max-budget, browser, privacy,
    packaged, architecture, and security evidence before completion.
  - Files: verification scripts/artifacts, phase notes/reviews, and ADR-0044 only if an
    accepted boundary changed; ADR-0045 and migration history remain untouched.
  - Verify: `verify:explorer`, packaged smoke, privacy audit, `bun run verify`, all
    browser cases, zero unresolved review blocker, and clean active markers.

## Engineering Review Completion

- Scope: FULL_REVIEW of architecture, concrete flows, contracts, failure modes,
  security, testing, performance, sequencing, and rollback.
- Findings: 6 plan defects found and folded: program/phase authorization ambiguity,
  malformed duplicated task output, SSE event-contract conflation, missing CSP
  boundary, nondeterministic/conditional history wording, and missing inline-script
  runtime coverage.
- Critical gaps: 0 after revision. Unresolved decisions: 0.
- Outside voice: OMM research evidence consumed; the plan-specific outside reviewer
  was stopped after failing to return within the review window, so no claim of
  cross-model plan consensus is made.
- Parallelization: one sequential implementation lane because AR0-AR3 converge on
  Explorer contracts, compiler, daemon, and HTML; read-only design review may overlap.
- Test artifact:
  `/Users/ancienttwo/.gstack/projects/Ancienttwo-arch-context/ancienttwo-main-eng-review-test-plan-20260712-023043.md`.
- Autoplan artifact:
  `/Users/ancienttwo/.gstack/projects/Ancienttwo-arch-context/tasks-eng-review-20260712-023100.jsonl`.

## AR4 Design Review

### What already exists

- One self-contained app surface with scoped color tokens, calm green/neutral status
  hierarchy, a persistent trust bar, five-view navigation, semantic-level controls,
  bounded topology, relations table, and typed Inspector.
- URL-addressed semantic navigation and transient fit/zoom/pan controls.
- Explicit keyboard focus, reduced-motion, no-JS structure, semantic regions,
  screen-reader SVG labels, and an accessible textual relation equivalent.
- No repo-level `DESIGN.md`. This local reader therefore reuses its existing scoped
  CSS vocabulary; a cross-product design system is not required for this program.

### Pass 1 · Information Architecture — 9/10 → 10/10

The first screen now answers, in order: trust/freshness, question/view, bounded
topology, relations, then Inspector. Focused detail now has a real two-level return
path instead of a no-op current-subject breadcrumb.

```text
trust + freshness
  -> five question-oriented views + semantic level + budget
  -> breadcrumb return path
  -> bounded/truncated state
  -> occurrences | primary topology workspace
                   -> relations
                   -> Inspector + technical details
```

If only three things fit: current question, topology, and freshness/budget remain.

### Pass 2 · Interaction State Coverage — 9/10 → 10/10

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Projection | live updates pending | honest zero occurrences/relations | daemon error envelope; no fabricated view | bounded topology + typed facts | amber omitted-count notice |
| Live freshness | pending | n/a | disconnected status | connected status | debounced bounded refetch |
| Typed views | selected control | explicit bounded empty topology | required domain unavailable/disabled | exact typed subgraph | read-set truncation remains visible |
| Inspector | selection prompt | typed `None`/`none` facets | no secondary query/fallback | complete typed facets | only manifest-selected metadata |

The real expiry defect found in AR4 is fixed: an already-connected SSE stream now
closes at token expiry and the page reports disconnected.

### Pass 3 · User Journey and Emotional Arc — 10/10 → 10/10

| Step | User does | User should feel | Supporting design |
|---|---|---|---|
| 1 | Opens local Explorer | Safe | explicit local/read-only/no-egress/token state |
| 2 | Scans a question view | Oriented | pressed view + level, budget, breadcrumb |
| 3 | Expands or focuses | In control | exact URL state, bounded refetch, return path |
| 4 | Reads rationale/history | Confident | typed Inspector, evidence/backlinks, cursors |
| 5 | Leaves it open | Trustworthy | live/disconnected freshness is never silent |

Five seconds: trust and question are unmistakable. Five minutes: topology and
Inspector answer where/why/history. Long-term: cursor/digest/freshness signals prevent
stale local pictures from presenting as authority.

### Pass 4 · AI Slop Risk — 10/10 → 10/10

Classifier: APP UI. The screen is a real workspace, not a dashboard mosaic. It avoids
hero copy, decorative gradients, icon circles, centered marketing sections, purple
palette, ornamental motion, and generic feature cards. Litmus: product identity YES;
one primary topology anchor YES; scan-readable YES; one job per section YES; cards are
structural regions rather than decoration YES; motion is functional YES; hierarchy
survives without shadows YES.

### Pass 5 · Design System Alignment — 8/10 → 9/10

No shared `DESIGN.md` exists. For this isolated self-contained local product, the
accepted system is the existing scoped CSS token set and component vocabulary in
`explorer-html`. AR4 changes reuse that vocabulary and add no new visual component.
The remaining one point is intentionally not converted into speculative repo-wide
design-system work.

### Pass 6 · Responsive and Accessibility — 8/10 → 10/10

The first real 375px readback measured `scrollWidth=696` and clipped navigation.
After the bounded CSS fix, `scrollWidth=clientWidth=375`; view/level controls wrap,
cards/grid items shrink, and only the topology canvas keeps internal horizontal scroll
(`640px` content inside a `299px` viewport). Breadcrumb terminal state uses
`aria-current=page`; the return item is an explicit context action. Existing keyboard,
focus-visible, reduced-motion, landmarks, disabled-state, label, and text-equivalent
contracts remain intact.

### Pass 7 · Unresolved Design Decisions

Three concrete issues were resolved in AR4: page-level narrow overflow, no-op focused
breadcrumb, and existing SSE connections surviving token expiry. Zero decisions are
deferred.

### NOT in scope

- A repo-wide design system or `DESIGN.md`: one local self-contained reader does not
  justify cross-product abstraction during acceptance closeout.
- Decorative branding, onboarding, editor, Guided Tour, or mutation CTA: they dilute
  the read-only authority task and were excluded by the approved product boundary.
- Fabricated empty-state recommendations: absence of typed authority remains an honest
  empty view with navigation controls, not inferred next steps.

### Design Review Implementation Tasks

- [x] **DR-T1 (P1, human: ~2h / Codex: ~20min)** — responsive shell — contain
  horizontal overflow at 375px while preserving topology-local scrolling.
  - Surfaced by: Pass 6 real viewport readback (`696px` document width).
  - Files: `packages/local-runtime/explorer-html/src/index.ts`, surface tests.
  - Verify: visible-browser `scrollWidth === clientWidth === 375` plus focused tests.
- [x] **DR-T2 (P1, human: ~2h / Codex: ~20min)** — breadcrumb — compile and render a
  real `view / subject` return path with terminal `aria-current`.
  - Surfaced by: Pass 1 real focus navigation; the old breadcrumb re-applied itself.
  - Files: Explorer compiler/HTML plus compiler/runtime/surface tests.
  - Verify: root click removes focus, returns to context, and preserves view/budgets.
- [x] **DR-T3 (P1, human: ~2h / Codex: ~20min)** — freshness — expire established
  SSE clients when the bearer token expires.
  - Surfaced by: Pass 2 real 30-second browser session remained connected.
  - Files: runtime daemon plus real SSE expiry test.
  - Verify: existing stream ends, session revokes, post-expiry HTML/SSE stay 401.

### Design Review Completion Summary

| Pass | Before | After |
|---|---:|---:|
| Information architecture | 9 | 10 |
| Interaction states | 9 | 10 |
| Journey | 10 | 10 |
| AI slop | 10 | 10 |
| Design system | 8 | 9 |
| Responsive/accessibility | 8 | 10 |
| Decisions | 3 open | 0 open |

System audit: UI scope confirmed; no `DESIGN.md`; existing Explorer patterns reused.
Mockup generator was unavailable, so real local screenshots replaced synthetic
mockups. Five key screenshots were captured under
`~/.gstack/projects/arch-context/designs/explorer-ar4-20260712/`. TODOS.md updates:
zero; all verified design defects were P1 ship gates and were fixed in AR4.
Overall design score: 9/10 → 9.8/10.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | NOT RUN | Program scope remains explicit |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | NOT RUN | No claim of cross-model consensus |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 6 issues folded, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (FULL) | score 9/10 → 9.8/10, 3 ship blockers fixed |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | NOT REQUIRED | No developer workflow change |

- **VERDICT:** ENG + DESIGN CLEARED — AR4 integrated verification remains before merge.

NO UNRESOLVED DECISIONS
