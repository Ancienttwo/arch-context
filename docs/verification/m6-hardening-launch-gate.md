# M6 MVP Hardening Gate

Date: 2026-06-19

## Scope

This gate closes the deterministic MVP hardening and proxy-evidence surface. It does not close the production Launch Gate, and it does not claim a third-party external audit, real cross-platform CI matrix, large-repo benchmark, timed install rehearsal, representative eval report, or general availability release.

## Evidence

- Cross-platform state paths and Node support matrix are exposed by `@archcontext/hardening`; `.github/workflows/verify.yml` configures ubuntu/macos/windows x Node 24/25, with hosted execution readback still pending.
- Large-repo context-query estimate is deterministic and tested; real benchmark execution is still pending.
- Dirty/stale worktree writes are rejected before ChangeSet apply.
- Multi-worktree safety is covered by repository fingerprint and worktree digest tests.
- Crash recovery, upgrade rollback, troubleshooting, schema upgrade, and public demo guides exist.
- Dependency audit, secret scan, secure defaults, install/uninstall markers, diagnostics, and privacy audit CLI paths are tested.
- Path traversal, stale review binding, OAuth audience/scope, webhook signature, and attestation replay tests pass.
- ChatGPT data sharing disclosure exists in the MCP Apps UI resource.
- Independent Threat Review reports zero Critical/High findings in the deterministic MVP surface; external security scan/review is still pending.

## Verification

- `bun test`: 87 pass.
- `bun run verify`: pass.

## Boundary

M6 is complete for the MVP scaffold and deterministic local safety checks. Production launch remains blocked on hosted CI matrix readback, real large-repo benchmark, representative eval report, external security scan or review, and a timed install-to-first-task rehearsal.
