# FG1 Local Product Verification

- Commit SHA: `0877df7b13da476700ce136915a2474518dc6622`
- Build/Artifact Digest: not built in this partial FG1 slice
- Environment: local checkout `/Users/chris/Projects/arch-context`
- GitHub App Installation ID: not used in FG1-01/02
- Test Repository ID: local temporary repositories from Bun tests
- Started At: 2026-06-20
- Completed At: 2026-06-20
- Reviewer: Codex execution under user goal

## Scope

This evidence covers only FG1-01 and FG1-02.

- `archctxd` now has an explicit production composition root through `createProductionDaemon` / `createStartedProductionDaemon`.
- The production root rejects injected runtime doubles for CodeGraph, provider factory, model store, local store, ChangeSet engine, and clock.
- CLI foreground/background daemon startup uses the production root; normal CLI runtime commands start or reuse daemon RPC when no test dependencies are injected.
- MCP no longer creates an independent in-process runtime when daemon RPC is unavailable.

## Commands

```bash
bun install
bun run typecheck
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts packages/surfaces/cli/test/cli.test.ts packages/surfaces/mcp-local/test/mcp-local.test.ts
bun test scripts/sprint-status-check.test.ts
bun test
node scripts/packaged-cli-smoke.mjs
bun run verify
```

## Results

- `bun install`: PASS, installed local TypeScript toolchain.
- `bun run typecheck`: PASS.
- Runtime/CLI/MCP focused tests: PASS, 24 tests.
- `scripts/sprint-status-check.test.ts`: PASS, 8 tests.
- `bun test`: PASS, 263 tests.
- `node scripts/packaged-cli-smoke.mjs`: PASS.
- `bun run verify`: PASS, including typecheck, package-boundary audit, full test suite, packaged CLI smoke, privacy audits, acceptance ledger, sprint-status, and representative eval.

## Negative Tests

- `assertProductionRuntimeDeps` rejects injected `codeFacts`, `codeGraphProviderFactory`, `localStore`, and `clock`.
- Runtime RPC without bearer token remains rejected.
- CLI daemon health readback reports `mode=production` and `productionSafe=true`.

## Privacy Scan

No GitHub, Cloud, source, diff, patch, symbol, or detailed finding route is introduced in this slice.

## Known Limitations

FG1 is not complete. This slice does not claim install tarball E2E, CLI/MCP shared persistent session E2E, local no-cloud review E2E, topology matrix, cross-OS IPC readback, or Local Core quickstart completion.

## Linked CI / GitHub Run IDs

None for this local partial slice.

## Decision

PARTIAL PASS for FG1-01 and FG1-02 only. FG1 exit gates remain open.
