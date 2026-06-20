# Sprint 4 Retrieval Eval

Date: 2026-06-20

## Scope

This is a repo-local deterministic eval for Sprint 4 EM. It compares the shipped in-memory lexical baseline against a local deterministic embedding prototype over the same representative context-recall set. It does not enable embedding in the runtime path, and it does not claim that the current baseline executes SQLite FTS5.

## Decision

Embedding remains off.

Reason: the candidate did not clearly beat the lexical baseline under the ADR-0033 decision gate:

- `minContextRecallLift`: 0.08
- `minConstraintRecallLift`: 0.05
- `maxIrrelevantRatio`: 0.25
- `maxToolCallIncrease`: 0

## Verification

- `bun test packages/retrieval`
- `bun run typecheck`

## Boundary

- Default retrieval mode remains `lexical`.
- Embedding config remains `enabled: false`.
- Embedding provider is local deterministic test code only.
- Vector/embedding egress is forbidden.
- Conditional EM-07/EM-08 implementation is skipped by decision gate; no hybrid retrieval path is enabled.
