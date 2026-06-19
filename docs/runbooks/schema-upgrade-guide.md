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
