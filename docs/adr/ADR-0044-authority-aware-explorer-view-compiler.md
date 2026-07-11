---
schemaVersion: archcontext.adr/v1
id: adr.0044.authority-aware-explorer-view-compiler
title: Authority-Aware Explorer View Compiler
status: accepted
decidedAt: 2026-07-11
appliesTo:
  - package.contracts
  - package.architecture-ledger
  - package.runtime-daemon
  - package.explorer-html
  - package.surfaces-cli
supersedes: []
---

# Context

The Browser Architecture Explorer is already a local, read-only, token-gated,
zero-egress surface. Its current `ExplorerProjection/v1` is intentionally small,
but it flattens model-file summaries and CodeGraph symbols into one node list,
uses CodeGraph edges as the only graph relations, has no perspective or
view-specific containment, and renders only a bounded prefix plus a focused
one-hop neighborhood.

That shape is useful for inspecting runtime output, but it is not yet an
architecture-reading protocol. It cannot express that the same architecture
entity appears in several views, distinguish a canonical subject from a derived
group, pin an expansion to one graph cursor, or prove that declared and observed
facts were reconciled through accepted evidence bindings.

Recursive architecture viewers demonstrate useful product behavior: a user can
start with a question-oriented perspective, expand a group, follow backlinks,
inspect rationale and constraints, and see meaningful change. ArchContext must
provide that navigation without turning a filesystem tree, Mermaid document,
LLM output, or browser canvas into a new architecture authority.

# Decision

Adopt an **authority-aware Explorer view compiler**. The compiler is a pure,
deterministic projection boundary:

```text
daemon-selected authority-mode architecture read model
+ observed CodeFacts and accepted evidence bindings
+ versioned view definition
+ bounded, cursor-preconditioned query
→ ExplorerProjection/v2
```

## Canonical subjects and projection occurrences

Canonical subjects remain architecture entities, relations, constraints, and
observed code symbols with their existing stable identifiers. An Explorer node
is a **projection occurrence**, not a new subject. One canonical subject may
appear more than once within one view or across several views.

Every occurrence has its own `occurrenceId`, optional `parentOccurrenceId`, and
role. A derived group has no invented architecture identity; it carries an
explicit derivation rule, input digest, and compiler version. Projection
occurrence IDs and derived group IDs must never be accepted by ledger mutation
or evidence-binding APIs as canonical subject IDs.

## Authority and reconciliation

The compiler preserves independent provenance axes:

- declared architecture entity/relation/constraint IDs;
- observed CodeGraph symbol/edge selectors;
- accepted `EvidenceBinding/v1` IDs;
- deterministic derivation metadata for view-only groups.

Declared and observed facts are not merged merely because names or paths look
similar. A reconciled occurrence requires an accepted typed binding at the same
repository/worktree cursor. Missing, ambiguous, stale, or malformed authority
fails closed or remains explicitly unbound; the compiler does not synthesize a
match.

## Query and cursor ownership

Repository, storage repository, workspace, storage workspace, branch, and the
actual cursor are selected by the daemon session. A caller may provide an
`expectedCursor` only as a compare-and-swap precondition. A caller cannot assert
repository/worktree authority through query fields.

The response cursor contains repository/worktree identity, HEAD SHA, worktree
digest, architecture graph digest, observed-facts digest when present, view
definition digest, and compiler version. Stale preconditions are rejected; a
request never silently combines facts from different cursors.

## Bounded projection and semantic zoom

Every query has hard node and relation budgets plus a maximum traversal depth.
The response reports whether it was truncated and the omitted child/relation
counts needed for an explicit expansion. Initial expansion is expressed through
`focus`, `expandedOccurrenceIds`, and `depth`; continuation tokens are deferred
until a real stable-pagination requirement exists.

Semantic zoom changes semantic resolution, not only SVG scale:

- overview: repository/domain/capability groups, boundary relations, counts;
- context: selected subject, direct children and bounded neighborhood;
- detail: selectors, constraints, bindings, interventions, and history.

The browser requests additional bounded projections when the semantic level
changes. It does not preload a complete recursive tree and hide it with CSS.

## Built-in view sequence

Views are versioned compiler inputs, not independent Markdown or Mermaid truth.
They land only when their authoritative inputs exist:

1. `system-map`: accepted architecture graph with observed/binding overlays.
2. `task-impact`: daemon-owned task session, task context, affected subjects,
   constraints, and interventions.
3. `drift-pressure`: real drift, pressure, and accepted evidence-binding inputs;
   placeholder `low/0` pressure is insufficient.
4. lifecycle/data-flow/storage/external-integration views only after typed
   relation vocabulary and evidence coverage can support them without semantic
   inference.

## Inspector, backlinks, and delta

The Inspector projects typed facets: summary/responsibility, ADR rationale,
constraints and policies, uncertainty/drift/pressure, proposed interventions,
bounded annotations, selectors, bindings, and cursor. It does not recreate seven
free-form documentation files.

Backlinks are derived from canonical identity: incoming/outgoing relations,
appears-in views, constrained-by, evidenced-by, changed-by ChangeSet, affected-by
task, and decided-by ADR.

Delta remains three distinct contracts:

- architecture fact delta;
- evidence/reconciliation delta;
- projection delta caused only by view/focus/budget changes.

A fact or evidence delta comparison requires compatible view-definition and
compiler versions plus explicit base/head cursors. Projection-only changes are
never reported as architecture changes.

## Incremental invalidation and live refresh

A rebuildable local dependency index may map occurrences to canonical subjects,
relations, bindings, selectors, and input digests. It is an operational cache,
not Git truth or a shadow model.

Daemon events may notify the browser of previous/next digests and affected
canonical IDs. Events contain no raw source, raw diff, prompt/completion, or full
CodeGraph body. The browser refetches a bounded projection through the existing
short-lived token.

## Compatibility and migration

`ExplorerProjection/v1` is already part of the public contracts package. V1 may
coexist with V2 only under an explicit, time-bounded migration contract that
lists consumers, adapter ownership, telemetry/readback, and the removal release.
There is no indefinite dual semantic path. If current consumer inventory proves
an atomic cutover is safe, V1 is replaced and removed in the same release unit.

## Security and privacy

The existing Explorer posture remains invariant: explicit `127.0.0.1`, opt-in,
short-lived revocable token, GET-only, read-only, no-store, no egress, no external
assets, no source bodies, no raw diffs, and no full CodeGraph output. Projection
budget exhaustion, stale cursors, unknown views, ambiguous bindings, and invalid
derived groups return explicit errors rather than partial fabricated success.

# Consequences

- Explorer becomes a question-oriented architecture read model while the
  architecture control loop, not the canvas, remains the product.
- The same canonical subject can be represented correctly in several views
  without adding conflicting parent relationships to architecture truth.
- The first implementation must establish the full protocol foundation but may
  ship only `system-map`; later views cannot ship before their real authority
  inputs exist.
- At 10x scale, work is bounded by the query budget and selected neighborhood,
  not by the full repository graph or browser DOM size.
- The compiler adds a reusable deterministic boundary. It does not add a second
  database, mutation protocol, model parser, Mermaid authority, or general
  editing canvas.
