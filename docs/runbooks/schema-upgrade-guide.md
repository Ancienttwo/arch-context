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

## Sprint 2: Single-repo to Multi-repo

- Existing `archcontext.node/v1` and `archcontext.relation/v1` documents remain valid.
- Multi-repo references may use `repo.id::node.id`; unscoped single-repo IDs keep their original meaning.
- New landscape state is additive: `archcontext.landscape/v1`, `archcontext.cross-repo-relation/v1`, `archcontext.org-runner-identity/v1`, and `archcontext.entitlement/v1`.
- Local SQLite tables for landscape and cross-repo edges are derived state and can be rebuilt from Git-tracked model files plus CodeGraph indexes.
- Entitlement adds `billingInterval`; it does not add team billing, seat pools, or organization-owned subscription scope.

Verification:

```bash
bun test packages/contracts packages/runtime-daemon packages/local-store-sqlite
```
