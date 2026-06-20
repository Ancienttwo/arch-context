# FG1 Local Product Verification

- Commit SHAs:
  - `0877df7b13da476700ce136915a2474518dc6622` — FG1-01/02 production composition root
  - `3fea18a76c14877035304435860e60cb555728bc` — FG1-03 product version manifest
  - `2e46bc066216f3840ee48c654e76b533f0b92679` — FG1-04 packaged CLI/daemon/MCP smoke
  - `d2194008d086d74b8f31c2ac28c9f81a8c576ce1` — FG1-05/06 CLI and MCP shared daemon RPC
  - pending — FG1-07 daemon health, RPC version negotiation, and lifecycle readback
- Build/Artifact Digest: not built in this partial FG1 slice
- Environment: local checkout `/Users/chris/Projects/arch-context`
- GitHub App Installation ID: not used in FG1-01/02
- Test Repository ID: local temporary repositories from Bun tests
- Started At: 2026-06-20
- Completed At: 2026-06-20
- Reviewer: Codex execution under user goal

## Scope

This evidence covers FG1-01 through FG1-07.

- `archctxd` now has an explicit production composition root through `createProductionDaemon` / `createStartedProductionDaemon`.
- The production root rejects injected runtime doubles for CodeGraph, provider factory, model store, local store, ChangeSet engine, and clock.
- CLI foreground/background daemon startup uses the production root; normal CLI runtime commands start or reuse daemon RPC when no test dependencies are injected.
- MCP no longer creates an independent in-process runtime when daemon RPC is unavailable.
- `ProductVersionManifest` is a contracts-owned manifest covering CLI, daemon, MCP, local RPC, schema set, SQLite migration range, CodeGraph compatibility, package manager, and Node engine.
- `archctxd` health readback exposes the same product version manifest used by contract tests.
- The root workspace now installs `@archcontext/surfaces`, exposing `node_modules/.bin/archctx`.
- `scripts/packaged-cli-smoke.mjs` verifies one installed `archctx` bin can start the daemon, run CLI state, and serve MCP stdio `tools/list`.
- CLI commands without test dependencies auto-start or reuse the versioned daemon RPC client instead of creating production Store/CodeGraph in-process.
- MCP stdio uses the daemon RPC connection for workflow tools and refuses to create an independent runtime when RPC is unavailable.
- `scripts/packaged-cli-smoke.mjs` proves CLI and MCP share the same daemon by creating a ChangeSet through MCP stdio and applying it through CLI.
- Runtime RPC health accepts current/no version header, rejects mismatched `X-ArchContext-RPC-Version` with HTTP 426, and reports the expected local RPC schema version.
- `archctx daemon status` reads the daemon health manifest back through the installed/started daemon and reports `rpcVersionCompatible=true`.
- `scripts/packaged-cli-smoke.mjs` verifies installed daemon auto-start, idempotent start, status readback, MCP/CLI shared state, and graceful `daemon stop`; process timeouts are widened to tolerate real startup on this machine.

## Commands

```bash
bun install
bun run typecheck
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/cli.test.ts packages/surfaces/mcp-local/test/mcp-local.test.ts
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/cli.test.ts
bun test packages/contracts/test/contracts.test.ts
bun test scripts/sprint-status-check.test.ts
bun test
node scripts/packaged-cli-smoke.mjs
bun run verify
```

## Results

- `bun install`: PASS, installed local TypeScript toolchain.
- `bun run typecheck`: PASS.
- Runtime/CLI/MCP focused tests: PASS, 24 tests across the focused files.
- FG1-07 Runtime/CLI focused tests: PASS, 16 tests.
- Contract tests: PASS, 83 tests.
- `scripts/sprint-status-check.test.ts`: PASS, 8 tests.
- `bun test`: PASS, 266 tests.
- `node scripts/packaged-cli-smoke.mjs`: PASS.
- `bun run verify`: PASS, including typecheck, package-boundary audit, full test suite, packaged CLI smoke, privacy audits, acceptance ledger, sprint-status, and representative eval.

## Negative Tests

- `assertProductionRuntimeDeps` rejects injected `codeFacts`, `codeGraphProviderFactory`, `localStore`, and `clock`.
- Runtime RPC without bearer token remains rejected.
- Runtime RPC with a mismatched `X-ArchContext-RPC-Version` is rejected with HTTP 426 before RPC method dispatch.
- CLI daemon health readback reports `mode=production` and `productionSafe=true`.
- CLI daemon status does not expose the bearer token and reports `rpcVersionCompatible=true` from health readback.
- Product manifest schema rejects unknown top-level fields through the contract matrix.
- Packaged MCP stdio preserves JSON-RPC request id and exposes `archcontext_prepare_task`.
- Packaged CLI `apply` fails unless it can read the MCP-created ChangeSet draft from the same daemon process; the smoke test covers this positive shared-state path.

## Privacy Scan

No GitHub, Cloud, source, diff, patch, symbol, or detailed finding route is introduced in this slice.

## Known Limitations

FG1 is not complete. This slice does not claim stale socket/pipe recovery, daemon-restart persistent session E2E, local no-cloud review E2E, topology matrix, cross-OS IPC readback, version upgrade remediation, or Local Core quickstart completion.

## Linked CI / GitHub Run IDs

None for this local partial slice.

## Decision

PARTIAL PASS for FG1-01 through FG1-07 only. FG1 exit gates remain open.
