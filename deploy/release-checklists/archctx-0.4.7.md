# archctx 0.4.7 release checklist

Scope: lower the shared runtime floor to Node 22.22 while preserving the existing Node-only CLI, daemon RPC, SQLite authority, and projection-result/v2 contracts.

- [x] Product manifest, JSON Schema, package engine, hardening diagnostics, dependency audit, fixtures, and stable product specification require exactly `>=22.22 <26`.
- [x] Node versions below 22.22 and Node 26 fail the hardening support check; Node 22.22 through 25 pass.
- [x] Governance CI runs on Node `22.22.x`; the cross-platform matrix covers Node `22.22.x`, `24.x`, and `25.x` on Ubuntu, macOS, and Windows.
- [x] Exact Node 22.22 package-local CLI, daemon, MCP, CodeGraph, and `node:sqlite` smoke passes from the generated `archctx@0.4.7` tarball.
- [x] `bun run typecheck`, 209 focused contract/release tests, npm dry-run, and AL10 release packaging pass.
- [x] Full verify regression comparison records `1224 pass / 10 fail`; all 10 failures are the independently known SQLite-lock baseline and there are no new failures.
- [x] repo-harness independently accepts the candidate tarball and exact Node 22.22 provider integration.
- [x] Publish `archctx-contracts@0.4.7` and `archctx@0.4.7`, then record registry and clean-room readback.

## Required hosted evidence

- The release gate requires all nine platform artifacts for Ubuntu, macOS, and Windows across Node `22.22.x`, `24.x`, and `25.x`.
- Existing six-target Node 24/25 evidence remains historical and must not be relabeled as Node 22.22 evidence.
