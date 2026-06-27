# Architecture Ledger AL5 Observability Readback

Date: 2026-06-26
Scope: AL5-16

## P1 Map

The observability boundary is `ArchitectureCandidateDelta/v1.summary`. The producer is `packages/core/architecture-delta/src/index.ts`; the contract surface is `packages/contracts/src/ledger.ts` and `schemas/runtime/architecture-candidate-delta.schema.json`.

The implementation does not add runtime writes, ledger events, YAML projection writes or raw CodeGraph/source persistence. It records bounded aggregate metadata on the candidate delta.

## P2 Traced Path

Observed path:

1. Git and CodeGraph changed subjects enter `buildArchitectureCandidateDelta(...)`.
2. Declared graph mapping records successful `declaredSubjectMappings` or `mappingAmbiguities`.
3. Evidence items are created with bounded `strength` metadata.
4. `summarizeDelta(...)` emits:
   - `mappingCoverage`
   - `unresolvedSubjects`
   - `evidenceStrengthDistribution`
5. Downstream policy, ChangeSet proposal and review stages continue to consume the same `ArchitectureCandidateDelta/v1` contract.

## P3 Decision

The observability fields live in `summary` instead of top-level extensions because AL5-16 is a required candidate-delta readback surface, not optional debug metadata.

The fields are counts and stable IDs only:

- mapping coverage counts changed subjects, mapped subjects, unresolved subjects, ambiguous subjects and coverage percentage
- unresolved subjects records reason counts and subject selector IDs
- evidence strength distribution counts heuristic, declared, observed and verified evidence items

This keeps observability deterministic and safe for PR summaries or CLI output without persisting raw source, raw diffs or prompt bodies.

## Verification

- `bun test packages/core/architecture-delta/test/architecture-delta.test.ts packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts packages/contracts/test/contracts.test.ts packages/core/policy-engine/test/policy-engine.test.ts packages/core/changeset-engine/test/changeset-engine.test.ts --timeout 90000`
- `bun run typecheck`
- `bun test`
- `node scripts/sprint-status-check.mjs`
- `git diff --check`

The updated tests assert:

- fully mapped deltas report 100% mapping coverage
- missing declared graph reports unresolved subjects by reason
- equal declared targets report ambiguous subject counts
- representative fixtures report full coverage and evidence strength distribution
- the schema fixture requires the new observability fields
