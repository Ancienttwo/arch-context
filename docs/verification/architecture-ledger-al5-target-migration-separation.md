# AL5 Target And Migration Separation Verification

Date: 2026-06-26

## Scope

This note verifies AL5-09: candidate architecture deltas must separate target-state change from migration-state progress. The module extends the AL5 declared mapping output without changing policy, ChangeSet, ledger append or `.archcontext/` projection behavior.

## P1 Map

Components involved:

- Contract type: `ArchitectureCandidateChangeV1` in `packages/contracts/src/ledger.ts`.
- Runtime schema: `schemas/runtime/architecture-candidate-delta.schema.json`.
- Candidate delta builder: `packages/core/architecture-delta/src/index.ts`.
- Tests: `packages/core/architecture-delta/test/architecture-delta.test.ts` and `packages/contracts/test/contracts.test.ts`.

The authoritative target state remains declared architecture state. The migration state remains a separate progress dimension and is not treated as a node, relation, constraint, owner or lifecycle target-state mutation.

Out of scope:

- Policy decisions for auto-accept or human approval.
- ChangeSet/event conversion.
- Baseline attribution for pre-existing issues.

## P2 Trace

Concrete path verified:

1. Git and CodeGraph changes become changed subjects.
2. Declared graph mapping produces architecture target mappings.
3. Candidate changes are generated for declared dimensions.
4. Each candidate change now carries `stateDimension`.
5. `node`, `relation`, `constraint`, `owner` and `lifecycle` candidates use `target-state`.
6. `migration-state` candidates use `migration-state`.
7. Delta summary separately counts `targetStateChanges` and `migrationStateProgress`.

Final side effect: deterministic `ArchitectureCandidateDelta/v1` output only. No ledger mutation occurs.

## P3 Decision

The invariant already exists in the architecture-domain intervention model as separate `TargetState` and `MigrationState`. AL5 now preserves that distinction in candidate deltas so later policy and ChangeSet stages do not infer migration semantics from target IDs or free-text summaries.

The tradeoff is a small contract expansion. It is justified because this is a cross-module invariant: downstream policy and review code need a stable field, not string matching on `target.kind`.

## Verification

Commands run:

```bash
bun test packages/core/architecture-delta/test/architecture-delta.test.ts packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts packages/contracts/test/contracts.test.ts --timeout 90000
bun run typecheck
ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al5-target-migration-verify-state-XXXXXX) bun run verify
```

Observed result:

- Focused contract/core/adapter tests: 147 pass, 0 fail, 551 expect calls.
- TypeScript typecheck: pass.
- Full verify: `VERIFY_EXIT=0`; 747 pass, 0 fail, 4517 expect calls; packaged CLI smoke, privacy/security readbacks, acceptance ledgers, sprint-status check and representative eval passed.
