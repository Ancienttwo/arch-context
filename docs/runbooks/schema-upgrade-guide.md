# Schema Upgrade Guide

## Rules

- Schema versions use `archcontext.<entity>/vN`.
- New fields must be optional or live under `extensions` until all adapters understand them.
- Removed fields require a migration note and compatibility test.
- Digest calculation uses canonical JSON, not raw YAML bytes.

## Minimum Check

Run:

```bash
bun test packages/contracts/test/contracts.test.ts
```

## Architecture Ledger AL0

Schema set `2026-06-25.al0-ledger` adds the contract surface for the hybrid
architecture ledger. These schemas are runtime contracts; they do not by
themselves create SQLite tables or switch authority away from `.archcontext/`.

New runtime schemas:

- `schemas/runtime/architecture-event.schema.json`
- `schemas/runtime/architecture-snapshot.schema.json`
- `schemas/runtime/evidence-item.schema.json`
- `schemas/runtime/evidence-binding.schema.json`
- `schemas/runtime/recommendation-run.schema.json`
- `schemas/runtime/recommendation.schema.json`
- `schemas/runtime/agent-job.schema.json`
- `schemas/runtime/investigation-report.schema.json`

Rules:

- Ledger-affecting CLI/MCP behavior must use stable JSON envelopes and daemon
  mutation paths; do not add commands that edit SQLite directly.
- Additive contract data belongs under `extensions` until all adapters
  understand it.
- Free-text practice IDs, evidence IDs, or summaries cannot grant checkpoint or
  complete authority. Authority comes from `EvidenceBinding/v1`.
- Schema fixtures must include valid, invalid, and boundary coverage before an
  AL0 task is marked complete.
- Raw source bodies, raw diffs, prompt/completion bodies, full CodeGraph output,
  secrets, credentials, and private keys are forbidden in ledger schemas and
  fixtures.

Verification:

```bash
bun test packages/contracts/test/contracts.test.ts
bun run typecheck
```

## Sprint 2: Single-repo to Multi-repo

- Existing `archcontext.node/v1` and `archcontext.relation/v1` documents remain valid.
- Multi-repo references may use `repo.id::node.id`; unscoped single-repo IDs keep their original meaning.
- New landscape state is additive: `archcontext.landscape/v1`, `archcontext.cross-repo-relation/v1`, `archcontext.org-runner-identity/v1`, and `archcontext.entitlement/v1`.
- Local SQLite tables for landscape and cross-repo edges are derived state and can be rebuilt from Git-tracked model files plus CodeGraph indexes.
- Entitlement adds `billingInterval`; it does not add team billing, seat pools, or organization-owned subscription scope.

Verification:

```bash
bun test packages/contracts packages/local-runtime/runtime-daemon packages/local-runtime/local-store-sqlite
```
