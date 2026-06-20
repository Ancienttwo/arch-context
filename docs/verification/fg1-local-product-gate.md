# FG1 Local Product Verification

- Commit SHAs:
  - `0877df7b13da476700ce136915a2474518dc6622` — FG1-01/02 production composition root
  - `3fea18a76c14877035304435860e60cb555728bc` — FG1-03 product version manifest
  - `2e46bc066216f3840ee48c654e76b533f0b92679` — FG1-04 packaged CLI/daemon/MCP smoke
  - `d2194008d086d74b8f31c2ac28c9f81a8c576ce1` — FG1-05/06 CLI and MCP shared daemon RPC
  - `2fb84124dd077f2022d254b0fccc8fcbae8666f7` — FG1-07 daemon health, RPC version negotiation, and lifecycle readback
  - `f085b34846a57df83e896660ff826c10ef86e540` — FG1-08 stale daemon control-file recovery and crash reconnect
  - `8a5e75c7f7a77c6543cadd5c81c6d57610c7b2b4` — FG1-09 MCP host install/status/remove config output
  - `42cdf9c846013d8898ee1875b9d1ca40640db8b0` — FG1-10 doctor version, daemon, SQLite, CodeGraph, Git, and permission checks
  - `1a98f1277d85ee5f6c292748166798845e5956fc` — FG1-11 ordinary single-repo fixture and first-experience E2E
- Build/Artifact Digest: not built in this partial FG1 slice
- Environment: local checkout `/Users/chris/Projects/arch-context`
- GitHub App Installation ID: not used in FG1-01/02
- Test Repository ID: local temporary repositories from Bun tests
- Started At: 2026-06-20
- Completed At: 2026-06-20
- Reviewer: Codex execution under user goal

## Scope

This evidence covers FG1-01 through FG1-11.

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
- Runtime control-file recovery removes insecure/invalid/dead connection files and stale lock files before daemon restart while leaving live PID locks as the single-writer guard.
- CLI daemon discovery now invokes the same recovery path for ordinary commands, `daemon status`, and `daemon start`.
- CLI E2E kills a real background daemon, observes stale connection/lock files left behind, restarts a new daemon, and verifies `recoveredStaleControlFiles` plus a new PID.
- `archctx mcp install/status/remove` now emits Codex, Claude, and generic Agent Host MCP stdio configuration without writing host-owned global files.
- `archctx config` and `archctx mcp install/status/remove` share the same host config generator for the `archctx mcp` stdio entrypoint.
- `archctx doctor` now aggregates product version manifest, daemon health if present, SQLite path/migration range, CodeGraph requirement, Git root/head, filesystem permissions, and existing hardening diagnostics.
- Doctor is read-only in this slice: it does not start daemon, mutate SQLite, or write host configuration.
- A static ordinary single-repo fixture lives under `packages/surfaces/cli/test/fixtures/single-repo-basic`.
- `local-product-e2e.test.ts` copies the fixture to a temp repo, commits it, runs real `codegraph init`, then drives installed `archctx` through `doctor`, `mcp status`, `init`, `sync`, `prepare`, `status`, `checkpoint`, `complete`, and `daemon stop`.

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
- FG1-08 Runtime/CLI focused tests: PASS, 17 tests.
- FG1-09 CLI focused tests: PASS, 9 tests.
- FG1-10 CLI focused tests: PASS, 9 tests.
- FG1-11 local product E2E: PASS, 1 process-level fixture test.
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
- Insecure connection files are ignored and then removed by stale recovery.
- Dead daemon PID connection files and stale lock files are removed before reconnect; the restarted daemon uses a different PID.
- Invalid MCP host names are rejected instead of producing ambiguous config.
- Doctor reports daemon stopped rather than auto-starting it, preserving read-only diagnostics behavior.
- The fixture's internal test file is named `basic.fixture.js` so the root `bun test` suite does not accidentally count fixture-owned tests as product tests.
- Product manifest schema rejects unknown top-level fields through the contract matrix.
- Packaged MCP stdio preserves JSON-RPC request id and exposes `archcontext_prepare_task`.
- Packaged CLI `apply` fails unless it can read the MCP-created ChangeSet draft from the same daemon process; the smoke test covers this positive shared-state path.

## Privacy Scan

No GitHub, Cloud, source, diff, patch, symbol, or detailed finding route is introduced in this slice.

## Known Limitations

FG1 is not complete. This slice does not claim daemon-restart persistent session E2E, formal `e2e:local-no-cloud` script coverage, topology matrix, cross-OS IPC matrix readback, host-owned config file mutation/readback, doctor auto-remediation, version upgrade remediation, or Local Core quickstart publication.

## Linked CI / GitHub Run IDs

None for this local partial slice.

## Decision

PARTIAL PASS for FG1-01 through FG1-11 only. FG1 exit gates remain open.
