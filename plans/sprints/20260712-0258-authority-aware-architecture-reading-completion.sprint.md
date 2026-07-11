# Sprint: Authority-Aware Architecture Reading Completion

> **Status**: Approved
> **Slug**: authority-aware-architecture-reading-completion
> **Created**: 2026-07-12 02:58
> **Updated**: 2026-07-12 04:08
> **Source Plan**: `plans/plan-20260712-0225-authority-aware-architecture-reading-completion.md`
> **Source Spec**: `docs/spec.md`
> **Goal Mode**: incremental

Program-level sprint container. The Source PRD summary and ordered backlog
decompose product intent into task-contract slices; each backlog row is a
long-task waypoint that must be expanded with `$think` before code edits.
`tasks/todos.md` stays the deferred-goal ledger and never carries this backlog.

## PRD

Summarize or link the upper-layer PRD here. Keep the full PRD in `plans/prds/`.

### Problem

- EV0-EV4 and DE0-DE5 made Explorer projections authority-aware, typed,
  transactional, replayable, bounded, and cache-safe, but the user-facing reader is
  still a card/table bootstrap that hides topology, verified history, and the typed
  data-flow/external-integration perspectives already supported by the authority model.
- OMM demonstrates valuable reading interactions, but its filesystem hierarchy,
  regex diff, full preload, unauthenticated watcher, and CDN renderer cannot become
  ArchContext authority or compatibility paths.

### Users

- Developers and coding agents who need to find, understand, and compare architecture
  facts without learning the underlying YAML/ledger model.
- Reviewers who need cursor-bound responsibility, constraints, evidence, decisions,
  dependencies, task impact, and change history from one local read surface.

### Success Criteria

- Every rendered semantic fact comes from one `ExplorerProjectionV2`; geometry remains
  deterministic, disposable, and non-authoritative.
- Users can navigate overview/context/detail topology, inspect complete typed history,
  and open typed `data-flow` and `external-integrations` views.
- Default and public-maximum render budgets, privacy, CSP, accessibility, packaged CLI,
  full verification, Architecture review, and Security review all pass.
- No compatibility reader, parallel V1/V2 semantic path, heuristic classifier,
  shadow parser, external renderer, or authority bypass is introduced.

### Acceptance Scenarios

- Given a bounded context projection, opening Explorer renders deterministic typed
  topology plus an equivalent relation table and Inspector.
- Given group/focus navigation, every unrelated query/token/budget field is preserved;
  zoom/pan never triggers authority reads.
- Given transactional authority changes, `authority-changed` and
  `projection-invalidated` follow their distinct qualification rules and coalesce to
  one bounded refetch.
- Given a focused subject, verified event backlinks appear as deduplicated canonical
  `historyEvents` without raw event/source/diff/prompt bodies.
- Given typed flow relations or `external-system` entities, the two new perspectives
  compile; adversarial names without typed authority do not enter them.

### Non-goals

- Mermaid/parser authority, filesystem perspectives, recursive preload, editing,
  free-form edges, layout persistence, cloud sharing, LLM-derived architecture truth,
  global search, Guided Tour, onboarding mutation, new database tables, or ledger
  promotion.

## Architecture Notes

### Capabilities Touched

- Explorer public V2 contracts/schemas, deterministic view compiler, token-gated
  runtime daemon HTTP/SSE, self-contained explorer-html renderer, CLI/surface tests,
  verification readbacks, packaging, and security/privacy checks.

### Dependency Order

- AR0 topology kernel -> AR1 interaction/freshness -> AR2 Inspector/history atomic
  contract -> AR3 typed views atomic contract -> AR4 integrated product acceptance.
- Adjacent phases remain sequential because they share Explorer contract/compiler/
  daemon/HTML modules and must each close their own verification boundary.

### Risks

- O(N x E) layout work or excessive SVG DOM at the public budget.
- Browser code accidentally synthesizing semantic state or losing token/query fields.
- Conflating the two SSE event payload contracts and creating reload loops.
- Leaking source/event/prompt/diff content or adding executable/external asset URLs.
- Treating names/paths as flow or integration authority.
- Compatibility code masking incomplete atomic contract migrations.

## Backlog

Ordered execution queue; keep rows in dependency order. Mode `contract` runs
the full plan -> contract -> worktree flow; `inline` allows primary-tree
execution for small tasks. Every row needs a concrete acceptance line.

| # | Status | Task | Mode | Acceptance | Plan |
|---|--------|------|------|------------|------|
| 1 | [x] | AR0 deterministic bounded topology kernel and SVG renderer cutover | contract | `bun test packages/local-runtime/explorer-html/test/topology.test.ts packages/surfaces/explorer-ui/test/explorer-ui.test.ts && bun run verify:explorer` passes; reversed input is byte-identical; 80/160 p95 <= 50ms and 1000/5000 p95 <= 500ms; no external asset/dependency | `plans/archive/plan-20260712-0301-ar0-deterministic-topology-kernel.md` |
| 2 | [x] | AR1 URL navigation, accessibility, CSP, and exact dual-SSE freshness | contract | Explorer surface + daemon HTTP/SSE tests pass for exact expand/focus state preservation, keyboard/reduced-motion/no-JS, declared CSP, unconditional debounced `authority-changed`, digest-qualified `projection-invalidated`, expiry, and one-refetch bursts | `plans/archive/plan-20260712-0317-ar1-navigation-live-freshness.md` |
| 3 | [x] | AR2 Inspector 2.0 and required typed historyEvents atomic cutover | contract | Contract/schema/compiler/RPC/CLI/HTML tests pass with required canonically sorted/deduplicated `historyEvents`; privacy audit proves no prohibited bodies; repository contains no optional/legacy history reader | `plans/archive/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md` |
| 4 | [x] | AR3 typed data-flow and external-integrations perspectives | contract | Contract/compiler/HTTP/CLI/HTML/package tests pass for typed positive/empty/stale/budget cases; adversarial names/paths remain excluded; new view digests force manifest-addressed cache misses | `plans/archive/plan-20260712-0349-ar3-typed-domain-perspectives.md` |
| 5 | [ ] | AR4 integrated browser, design, performance, privacy, package, Architecture and Security closeout | contract | `bun run verify` passes; browser evidence covers all plan cases; design/Architecture/Security reviews have zero blocker; rollback/readback succeeds; no active phase markers or compatibility paths remain | (pending) |

## Execution Log

Keep this section last; `.ai/harness/scripts/sprint-backlog.sh complete-task` appends rows here.

| When | Task | Plan | Result |
|------|------|------|--------|
| 2026-07-12 03:16 | AR0 deterministic bounded topology kernel and SVG renderer cutover | `plans/archive/plan-20260712-0301-ar0-deterministic-topology-kernel.md` | done |
| 2026-07-12 03:30 | AR1 URL navigation, accessibility, CSP, and exact dual-SSE freshness | `plans/archive/plan-20260712-0317-ar1-navigation-live-freshness.md` | done |
| 2026-07-12 03:46 | AR2 Inspector 2.0 and required typed historyEvents atomic cutover | `plans/archive/plan-20260712-0332-ar2-inspector-history-atomic-cutover.md` | done |
| 2026-07-12 04:08 | AR3 typed data-flow and external-integrations perspectives | `plans/archive/plan-20260712-0349-ar3-typed-domain-perspectives.md` | done |
