# Sprint Program: Authority-Aware Explorer View Compiler

> **Status**: Complete — EV0–EV4 implemented and verified
> **Slug**: `archctx-explorer-view-compiler`
> **Created**: 2026-07-11
> **Updated**: 2026-07-11
> **Decision**: `docs/adr/ADR-0044-authority-aware-explorer-view-compiler.md`
> **Source**: oh-my-mermaid comparative research plus local `main@aacccf16` readback
> **Goal**: turn Explorer into a cursor-pinned, authority-aware, budget-bounded architecture view compiler without creating a new architecture truth or a general-purpose editing canvas.

---

## 0. Product decision

The complete product direction is an architecture **view compilation protocol**:

```text
question-oriented perspective
+ canonical architecture subjects
+ view-specific occurrences and groups
+ authority-aware evidence overlays
+ bounded semantic zoom
+ typed inspector, backlinks, and delta
+ incremental invalidation
→ navigable architecture reading experience
```

This program preserves the product boundary in `docs/spec.md`: ArchContext is an
architecture control loop. Diagrams and Explorer views are read projections,
not the product authority. The program does not introduce canvas editing,
free-form relation creation, filesystem-derived architecture truth, or a second
semantic parser.

## 1. Verified starting state

### P1 · Global architecture map

| Component | Current responsibility | Program role |
|---|---|---|
| `.archcontext/` + authority-mode ledger read | Declared/accepted architecture truth and operational graph | Canonical subject source |
| CodeGraph adapter | Observed symbols, edges, selectors, evidence | Observed overlay only |
| Evidence bindings | Typed authority bridge between evidence and subjects | Required reconciliation proof |
| `runtime-daemon` | Session identity, authority-mode reads, Explorer HTTP/token lifecycle | Own cursor and compile inputs |
| `ExplorerProjection/v1` | Flat nodes/relations plus verification/pressure/interventions | Migration source; not extended indefinitely |
| `explorer-html` | Self-contained read-only HTML/SVG | Incremental V2 consumer |
| CLI/RPC | Thin triggers and JSON readback | Query transport only |

Scale signals at program start:

- `runtime-daemon/src/index.ts`: 6,046 lines; the pure compiler must be extracted
  from I/O/session orchestration instead of adding more projection policy inline.
- `explorer-html/src/index.ts`: 772 lines; reuse it for initial V2 interaction,
  but do not preload or render an unbounded recursive graph.
- V1 renderer caps the visible prefix at 80 nodes and 160 relations; this is a UI
  cap, not a query/cursor/budget protocol.

### P2 · Current concrete trace

```text
archctx explore
→ daemon opens repository/worktree session
→ validate/load model files
→ CodeGraph buildTaskContext("architecture explorer", maxSymbols=80)
→ model-file nodes + symbol nodes + CodeGraph-edge relations
→ ExplorerProjection/v1
→ HTML prefix graph and focused 1-hop view
```

Current pressure point: the builder does not use accepted architecture entities
and relations as the graph skeleton, cannot represent view-specific occurrences,
does not accept a task session, and fills current pressure values with `low/0`.

### P3 · Design rationale

OMM validates that perspective trees, drill-down, semantic zoom, inspector fields,
backlinks, and live refresh improve architecture reading. Its implementation is a
UX reference, not an authority or scale reference. ArchContext will reuse the
interaction model through typed views, deterministic grouping, daemon-owned
cursors, accepted evidence bindings, hard budgets, and lazy expansion.

## 2. Non-negotiable invariants

- [x] Repository/worktree identity and actual cursor come from the daemon session.
- [x] Caller cursor fields are preconditions only; stale input fails explicitly.
- [x] Canonical subject IDs and projection occurrence IDs are distinct types.
- [x] One subject may appear in multiple occurrences/views without acquiring
      multiple architecture parents.
- [x] Derived groups carry rule ID, input digest, and compiler version; they are
      never ledger subjects.
- [x] Declared and observed facts are not merged without an accepted typed binding.
- [x] Heuristic directory/name/LLM containment is forbidden.
- [x] Every response obeys hard node/relation/depth budgets.
- [x] Missing authority never produces placeholder semantic facts.
- [x] Projection contains no raw source, raw diff, prompt/completion, or full
      CodeGraph output.
- [x] Loopback, token, GET-only, read-only, no-store, no-egress, and self-contained
      asset guarantees remain intact.
- [x] V1 coexistence, if needed, is bounded by a migration contract and removal release.

## 3. Full target protocol

### 3.1 Query

Conceptual contract; exact public names freeze in EV0:

```ts
interface ExplorerProjectionQueryV2 {
  schemaVersion: "archcontext.explorer-projection-query/v2";
  viewId: string;
  expectedCursor?: {
    headSha: string;
    worktreeDigest: string;
    graphDigest: string;
    observedFactsDigest?: string;
  };
  focus?: { occurrenceId?: string; subjectId?: string };
  expandedOccurrenceIds?: string[];
  depth: 0 | 1 | 2;
  budget: { maxNodes: number; maxRelations: number };
}
```

The daemon resolves actual repository/storage/workspace/branch identity and
returns it in the response cursor. Query input cannot override that authority.

### 3.2 Projection occurrence

```ts
interface ExplorerOccurrenceV2 {
  occurrenceId: string;
  parentOccurrenceId?: string;
  role: "subject" | "derived-group";
  subjectRefs: Array<{
    kind: "architecture-entity" | "architecture-relation" |
      "architecture-constraint" | "code-symbol";
    id: string;
  }>;
  derivation?: {
    ruleId: string;
    inputDigest: string;
    compilerVersion: string;
  };
  childrenCount: number;
  expandable: boolean;
  verificationStatus: "MATCHED" | "DRIFT" | "UNKNOWN" | "VERIFIED";
  pressure: { level: "low" | "medium" | "high"; score: number; signals: string[] };
  provenance: {
    declaredEntityIds: string[];
    observedSymbolIds: string[];
    evidenceBindingIds: string[];
  };
}
```

Aggregate/group is not a `subjectRef`. Unbound observed subjects remain separate
observed occurrences. VERIFIED requires accepted bindings at the response cursor.

### 3.3 Response cursor and truncation

Every V2 response includes:

- repository and storage repository IDs;
- workspace and storage workspace IDs;
- branch, HEAD SHA, and worktree digest;
- architecture graph and observed-facts digests;
- view-definition digest and compiler version;
- deterministic projection digest;
- node/relation budgets, truncation flags, and omitted counts.

Continuation tokens are not part of EV0. Expansion uses explicit focus,
expanded-occurrence IDs, depth, and a fresh cursor precondition.

## 4. View catalog and readiness gates

| View | Question | Authoritative inputs | Readiness gate | Program phase |
|---|---|---|---|---|
| `system-map` | What accepted architecture entities exist and how do they relate? | authority-mode graph, observed selectors, accepted bindings | accepted graph read wired; deterministic budgets | EV0 |
| `task-impact` | What will this task cross or constrain? | daemon-owned task session, CodeGraph task context, constraints, interventions | task-session query contract and stale-task guard | EV2 |
| `drift-pressure` | Where do declared/observed facts disagree and pressure accumulate? | real drift, pressure, uncertainty, binding coverage | no placeholder `low/0`; verified pressure inputs | EV2 |
| lifecycle/data-flow/storage/integrations | How does a domain-specific flow behave? | typed relation vocabulary and coverage | vocabulary/coverage ADR; no semantic inference | Deferred after EV4 |

## 5. Semantic zoom and interaction target

### Overview

- repository/domain/capability derived groups;
- key accepted boundaries and relation counts;
- children, drift, high-pressure, and unbound-observed counts;
- no full subtree preload.

### Context

- selected occurrence and breadcrumb;
- direct children and bounded incoming/outgoing neighborhood;
- verification, binding coverage, and pressure summary;
- explicit hidden/omitted counts.

### Detail

- canonical subject references and selectors;
- constraints/policies and ADR rationale;
- accepted bindings and verification cursor;
- interventions, ChangeSets, and history links.

The existing hand-written, self-contained SVG remains the initial renderer. No
drag/drop editing, free-form edge creation, real-time collaboration, or external
layout/font/Markdown dependency enters this program.

## 6. Inspector and backlinks

| Reader question | Typed facet |
|---|---|
| What is it responsible for? | entity summary/responsibility |
| Why does this shape exist? | ADR/decision references |
| What must remain true? | constraints/policies |
| What is uncertain or unhealthy? | drift/pressure/uncertainty |
| What should change? | proposed intervention/kill list |
| Where is the proof? | selectors and accepted evidence bindings |
| Where else does it appear? | view occurrence index |
| What depends on it? | incoming/outgoing typed relations |
| What changed it? | ChangeSet/event history |

Free-form annotations remain bounded and non-authoritative.

## 7. Delta model

The program keeps three deltas separate:

1. architecture fact delta — entities, relations, constraints, owner/lifecycle;
2. evidence delta — observed subjects, bindings, coverage, verification transitions;
3. projection delta — only view/focus/budget/semantic-level differences.

Fact/evidence comparisons require explicit base/head cursors and compatible view
definition/compiler versions. Projection-only changes never appear as architecture
change. Mermaid parsing is never used for semantic delta.

## 8. Incremental invalidation and live refresh

The future dependency index maps:

```text
occurrence
→ canonical subject/relation/constraint IDs
→ evidence binding IDs
→ SourceSelectors
→ graph/code-facts/view-definition digests
```

It is a rebuildable SQLite cache with no authority. Daemon invalidation events
carry digests and optionally affected canonical IDs; the browser securely
refetches. Events never carry source, diff, prompt, completion, or full evidence.

## 9. V1 migration contract

Before V2 becomes the default:

- inventory CLI, RPC, HTML, schema, fixture, contract-package, and external consumers;
- decide atomic replacement or bounded V1 adapter;
- if adapter is required, name owner, telemetry/readback, removal version, and
  delete condition before it lands;
- reject a permanent dual semantic implementation;
- keep existing V1 security tests green throughout migration.

## 10. Program phases

| Phase | Outcome | Depends on | Status |
|---|---|---|---|
| EV0 | V2 contracts + pure `system-map` compiler + daemon authority-mode read | ADR-0044 | ☑ |
| EV1 | Existing HTML consumes bounded V2 with view/focus/expand/breadcrumb | EV0 | ☑ |
| EV2 | Typed inspector, backlinks, real `task-impact` and `drift-pressure` | EV0, real task/pressure/binding inputs | ☑ |
| EV3 | Architecture/evidence/projection delta contracts and overlays | EV0, EV2 | ☑ |
| EV4 | Dependency index, SSE invalidation, scale/security hardening, V1 removal | EV1–EV3 | ☑ |

## 11. Task breakdown

### EV0 · Contract and deterministic compiler

- [x] **EV0-01 · P0 · contracts** — Freeze query, cursor, occurrence,
  relationship, truncation, provenance, and projection digest contracts.
- [x] **EV0-02 · P0 · contracts** — Add positive, negative, boundary, stale,
  budget, derived-group, and authority-separation schema fixtures.
- [x] **EV0-03 · P0 · runtime-daemon** — Extract a pure system-map compiler from
  daemon I/O/session logic.
- [x] **EV0-04 · P0 · runtime-daemon** — Read accepted graph through current
  authority mode; fail closed instead of converting model files into graph nodes.
- [x] **EV0-05 · P0 · runtime-daemon** — Overlay observed symbols and accepted
  binding IDs without overwriting declared subjects.
- [x] **EV0-06 · P0 · compiler** — Enforce deterministic sorting, IDs, digest,
  depth, node budget, relation budget, and omitted counts.
- [x] **EV0-07 · P0 · security** — Reject caller-owned scope, stale cursor,
  unknown view, invalid occurrence IDs, and raw-body fields.
- [x] **EV0-08 · P1 · migration** — Inventory V1 consumers and record atomic
  cutover versus bounded-adapter decision.
- [x] **EV0-EG1** — Same inputs/query produce the same canonical output and digest.
- [x] **EV0-EG2** — 10,000-entity synthetic input never returns more than budget.
- [x] **EV0-EG3** — No unbound declared/observed merge occurs.
- [x] **EV0-EG4** — Current loopback/token/GET-only/no-egress tests remain green.

### EV1 · Bounded Explorer interaction

- [x] Add V2 view switcher with `system-map` as the first available view.
- [x] Add breadcrumb, focus, expand/collapse, hidden-count, and truncation UI.
- [x] Refetch bounded projections on semantic-level change; no complete-tree preload.
- [x] Preserve keyboard, accessibility, token expiry/revocation, and zero external assets.
- [x] Add browser/API acceptance for stale cursor and budget boundaries.

### EV2 · Authority-aware insight views

- [x] Add typed Inspector facets and canonical-subject backlinks.
- [x] Add appears-in-view, affected-by-task, constrained-by, evidenced-by,
  changed-by-ChangeSet, and decided-by-ADR indexes.
- [x] Add daemon-owned task-session input and `task-impact` only after stale-task tests pass.
- [x] Connect real pressure/drift/binding inputs and add `drift-pressure`; prohibit
  placeholder `low/0` values from presenting as evaluated pressure.
- [x] Add explicit unbound observed and declared-but-unobserved states.

### EV3 · Semantic deltas

- [x] Define architecture fact, evidence, and projection delta contracts.
- [x] Require compatible view/compiler versions and explicit base/head cursors.
- [x] Add typed transition overlays, including `MATCHED → DRIFT`.
- [x] Prove projection-only changes never produce architecture delta.
- [x] Add representative replay/snapshot integration coverage.

### EV4 · Incremental operation and migration closeout

- [x] Add rebuildable occurrence dependency index in existing runtime SQLite.
- [x] Invalidate only affected subtrees from graph/code-facts/binding changes.
- [x] Add digest-only SSE invalidation and token-authenticated refetch.
- [x] Benchmark 10k/100k input graphs with bounded output and measured p95.
- [x] Run privacy, no-egress, malformed-repository, stale-cursor, and denial-budget tests.
- [x] Complete V1 consumer migration and delete the bounded adapter by its named release.
- [x] Update runbooks, packaged CLI smoke, release manifest, and external acceptance evidence.

## 12. Verification matrix

| Risk | Required proof |
|---|---|
| New authority accidentally created | declared/observed unbound tests; mutation APIs reject occurrence IDs |
| Cursor contamination | branch/worktree/stale expected-cursor tests |
| Unbounded graph work | 10k/100k input plus hard output budgets and omitted counts |
| Derived group mistaken for subject | schema rejection and ledger-binding negative test |
| Fake pressure/drift | real-input readiness gate; no placeholder view |
| Privacy regression | schema/body deny tests, route audit, packaged HTML no external URLs |
| Compatibility path becomes permanent | consumer inventory, owner, removal release, deletion gate |
| Compiler nondeterminism | reversed/randomized input order produces identical digest |

## 13. Stop conditions

- Stop a phase if it requires heuristic semantic containment or shadow parsing.
- Stop if authority-mode input cannot be obtained without bypassing daemon/store contracts.
- Stop if V1 compatibility is requested without a named consumer and removal path.
- Stop if a view lacks real authoritative inputs; keep it unavailable instead of
  generating placeholder success.
- Stop if the browser would need raw source/full CodeGraph output or external assets.

## 14. Execution log

- 2026-07-11: Full program and ADR accepted after oh-my-mermaid comparative review.
- 2026-07-11: EV0 selected as the first bounded implementation slice; later
  phases remain durable program scope and are not discarded by EV0 delivery.
- 2026-07-11: EV0 completed. Full `bun run verify` passed, including 1,020 tests,
  packaged CLI smoke, privacy/security audits, acceptance ledgers, and eval gates.
- 2026-07-11: EV1–EV4 completed. Explorer HTML, task/drift views, typed deltas,
  SQLite dependency index, digest-only SSE, V1 removal, 10k/100k scale evidence,
  packaged smoke, privacy/security gates, and full `bun run verify` passed.
