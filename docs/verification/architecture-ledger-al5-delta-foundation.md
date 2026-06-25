# AL5 Architecture Delta Foundation

Date: 2026-06-25 UTC
Branch: `codex/architecture-ledger-al5-delta-foundation`

## Scope

This slice starts AL5 by turning a Git base/head change cursor into a typed
candidate architecture delta. It does not auto-accept architecture facts, create
ChangeSets, write ledger events, invoke subagents, or update projections.

## P1 Map

Authoritative implementation surfaces:

- `packages/contracts/src/ledger.ts`: `ArchitectureSubjectSelector/v1`,
  `ArchitectureCandidateDelta/v1`, digest helpers, and EvidenceBinding targets
  for `subject` and `candidate-delta`.
- `schemas/runtime/architecture-subject-selector.schema.json` and
  `schemas/runtime/architecture-candidate-delta.schema.json`: JSON contract
  surfaces and valid fixtures.
- `packages/core/architecture-delta/src/index.ts`: deterministic normalization
  from Git change metadata plus normalized CodeGraph context into subject
  selectors, raw facts, heuristic interpretations, evidence items, evidence
  bindings and a candidate delta digest.
- `packages/local-runtime/codegraph-adapter/src/index.ts`:
  `CodeGraphAdapter.analyzeChangedSubjects` performs the AL5 entry path:
  CodeGraph sync for changed paths, no-source context build, then candidate
  delta construction.

Out of scope:

- Mapping code subjects to declared architecture entities.
- Baseline issue separation.
- Policy decisions for auto-accept/checkpoint/proof/human approval.
- ChangeSet conversion, accepted ledger events, and projection writes.

## P2 Trace

Concrete trace:

1. Input source of truth is `GitChangeMetadata`: `baseSha`, `headSha`,
   changed paths, statuses and metadata digest.
2. `CodeGraphAdapter.analyzeChangedSubjects` normalizes the changed path set and
   calls `sync({ changedPaths })`.
3. The adapter builds a no-source CodeGraph task context scoped to the changed
   paths. The context may contain normalized symbols and import edges, but not
   source bodies or diff bodies.
4. `buildArchitectureCandidateDelta` converts paths, symbols and relations into
   stable `ArchitectureSubjectSelector/v1` records.
5. Git status is normalized into `added`, `removed`, `moved`, `renamed` or
   `materially_changed`. Git rename metadata is correlated before any
   delete-plus-add interpretation is emitted.
6. Raw code facts remain in `rawFacts`; architecture interpretation remains in
   `interpretations` and is explicitly marked `heuristic: true`.
7. Every interpretation carries one or more `evidenceIds`. Evidence is bound to
   the changed `subject` and to the enclosing `candidate-delta` with
   `authorityEffect: context-only`.
8. The final side effect is a deterministic in-memory candidate delta and
   `deltaDigest`. There is no ledger append or projection mutation in this
   slice.

## P3 Decision

The smallest coherent change was to add the AL5 foundation as a pure
normalization layer:

- Contracts live in `@archcontext/contracts` so later CLI, MCP, daemon and
  ChangeSet surfaces can consume the same selector/delta shape.
- Delta construction lives in `@archcontext/core/architecture-delta` so it is
  provider-neutral and does not depend on the local runtime.
- CodeGraph integration stays in `@archcontext/local-runtime/codegraph-adapter`
  because it owns CodeGraph sync/query behavior and path sanitization.

The preserved invariant is that observed code facts can support evidence, but
cannot silently become declared architecture truth. At 10x scale, the next
pressure point is mapping coverage: this slice knows what code changed, but not
yet which declared architecture entity each changed subject belongs to.

## Verification

Commands run:

```bash
bun test packages/core/architecture-delta/test/architecture-delta.test.ts
bun test packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts --timeout 90000
bun test packages/contracts/test/contracts.test.ts
bun run typecheck
```

Observed results:

- `architecture-delta.test.ts`: 2 pass, 0 fail, 19 expects.
- `codegraph-adapter.test.ts`: 5 pass, 0 fail, 29 expects.
- `contracts.test.ts`: 139 pass, 0 fail, 478 expects.
- `bun run typecheck`: pass.

Gate coverage:

- AL5-EG1: same input produces the same candidate delta digest in the
  deterministic delta fixture.
- AL5-EG2: every heuristic interpretation has typed evidence IDs and evidence
  bindings; raw code facts and interpretations are separate arrays.
- AL5-EG3: Git rename/move metadata is correlated into `renamed` or `moved`
  changed subjects without emitting false delete-plus-add churn.
