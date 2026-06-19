# M6 Hardening Launch Gate

Date: 2026-06-19

## Scope

This gate closes the deterministic MVP hardening surface. It does not claim a third-party external audit or general availability release.

## Evidence

- Cross-platform state paths and Node support matrix are exposed by `@archcontext/hardening`.
- Large-repo context-query estimate is deterministic and tested.
- Dirty/stale worktree writes are rejected before ChangeSet apply.
- Multi-worktree safety is covered by repository fingerprint and worktree digest tests.
- Crash recovery, upgrade rollback, troubleshooting, schema upgrade, and public demo guides exist.
- Dependency audit, secret scan, secure defaults, install/uninstall markers, diagnostics, and privacy audit CLI paths are tested.
- Path traversal, stale review binding, OAuth audience/scope, webhook signature, and attestation replay tests pass.
- ChatGPT data sharing disclosure exists in the MCP Apps UI resource.
- Independent Threat Review reports zero Critical/High findings in the deterministic MVP surface.

## Verification

- `bun test`: 87 pass.
- `bun run verify`: pass.

## Boundary

M6 is complete for this repository sprint. A real third-party external security audit remains a later release governance item, not a sprint blocker.
