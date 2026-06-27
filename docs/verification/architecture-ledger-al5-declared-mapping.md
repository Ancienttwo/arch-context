# AL5 Declared Mapping Verification

Date: 2026-06-26

## Scope

This note verifies the AL5 declared architecture mapping module. It builds on the candidate delta foundation and keeps the same authority boundary: observed Git and CodeGraph facts can support context-only candidate deltas, but they do not mutate the architecture ledger or `.archcontext/` projections.

## P1 Map

Components involved:

- Contracts: `packages/contracts/src/ledger.ts` and `schemas/runtime/architecture-candidate-delta.schema.json`.
- Core delta builder: `packages/core/architecture-delta/src/index.ts`.
- Runtime CodeGraph boundary: `packages/local-runtime/codegraph-adapter/src/index.ts`.
- Verification surfaces: `packages/core/architecture-delta/test/architecture-delta.test.ts`, `packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts`, `packages/contracts/test/contracts.test.ts`.

Authoritative declared architecture state remains the `.archcontext/` projection and ledger graph state. The delta builder receives a read-only declared graph shape compatible with current ledger records; it does not read files, append events, apply ChangeSets or create architecture entities.

Out of scope for this module:

- Baseline attribution for pre-existing issues.
- Policy auto-accept / human approval rules.
- Conversion of candidates into ChangeSets or ledger events.
- Promotion of heuristic candidate changes into declared architecture truth.

## P2 Trace

Concrete path verified:

1. Git metadata provides changed paths and status.
2. CodeGraph provides changed symbols and relations without source bodies or diff bodies.
3. `buildArchitectureCandidateDelta` builds stable subject selectors, raw facts, changed subjects, interpretations and evidence.
4. The builder joins changed selectors against a runtime-provided declared graph:
   - path selectors map through exact or prefix declared paths;
   - symbol selectors can map through declared names;
   - relation selectors map through endpoint entity matches and declared relation endpoints.
5. Unique matches produce `declaredSubjectMappings` with explicit `matchReason`.
6. Missing graph, no target, relation endpoint failure or equal-confidence targets produce `mappingAmbiguities`.
7. Mapped targets produce typed `candidateChanges` for node, relation, constraint, owner, lifecycle and migration-state dimensions.
8. Evidence remains bound with `authorityEffect: context-only`.

Final side effect: a deterministic `ArchitectureCandidateDelta/v1` value. No ledger event, YAML model file, generated projection or ChangeSet is written by this path.

## P3 Decision

The chosen design keeps AL5 as a deterministic normalization stage. It accepts declared architecture context as input instead of coupling the delta builder to YAML or SQLite readers. That preserves the invariant from ADR-0040: CodeGraph facts are observed evidence, while declared architecture state is not overwritten by analysis.

The tradeoff is that mapping is conservative. Equal-confidence matches become ambiguity rather than an invented entity, and candidate changes remain heuristic until later policy and ChangeSet stages validate them. At larger scale, the first bottleneck will be mapping coverage and ambiguity volume, not ledger write throughput.

## Verification

Commands run:

```bash
bun test packages/core/architecture-delta/test/architecture-delta.test.ts packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts packages/contracts/test/contracts.test.ts --timeout 90000
bun run typecheck
ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al5-mapping-verify-state-XXXXXX) bun run verify
```

Observed result:

- Focused contract/core/adapter tests: 147 pass, 0 fail, 546 expect calls.
- TypeScript typecheck: pass.
- Full verify: 747 pass, 0 fail, 4512 expect calls; packaged CLI smoke, privacy/security readbacks, acceptance ledgers, sprint status check and representative eval all passed.
