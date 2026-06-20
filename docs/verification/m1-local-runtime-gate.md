# M1 Local Runtime Gate

Date: 2026-06-19

## Scope

M1 establishes the local-only runtime foundation: `archctxd`, repository session binding, worktree digest, local store migration contract, CodeGraph adapter boundary, `.archcontext/` model loader, generated projection rebuild, local RPC, and thin CLI/MCP commands.

## Evidence

- Runtime daemon: `packages/local-runtime/runtime-daemon/src/index.ts`.
- Runtime RPC: `ArchctxRuntimeRpcServer` / `RuntimeRpcClient` in `packages/local-runtime/runtime-daemon/src/index.ts`.
- Packaged CLI smoke: `scripts/packaged-cli-smoke.mjs`.
- Repository and Git binding: `packages/core/architecture-domain/src/index.ts`, `packages/local-runtime/git-adapter/src/index.ts`.
- Local store: `packages/local-runtime/local-store-sqlite/src/index.ts`.
- CodeGraph adapter: `packages/local-runtime/codegraph-adapter/src/index.ts`, pinned to `@colbymchenry/codegraph@1.0.1`.
- Model store: `packages/local-runtime/model-store-yaml/src/index.ts`.
- CLI: `packages/surfaces/cli/src/main.ts`.

## Verified Path

Temporary repository path exercised by tests:

```text
archctx init -> .archcontext/manifest.yaml/product/model/policy/generated
archctx validate -> deterministic model digest
archctx sync -> CodeGraph adapter snapshot
archctx context -> TaskContext envelope
archctx status -> repo/head/worktree binding
archctx daemon start -> background archctxd health readback
archctx daemon status -> loopback RPC connection readback
archctx daemon stop -> connection/lock cleanup
```

## Verification

Command:

```bash
bun test packages/local-runtime/runtime-daemon packages/surfaces/cli packages/surfaces/mcp-local
node scripts/packaged-cli-smoke.mjs
```

Observed result:

```text
38 pass
0 fail
[packaged-cli-smoke] OK
```

## Boundary Notes

- The local store migration contract enables WAL, foreign keys, and busy timeout.
- The SQLite schema guard rejects source, diff, symbol payload, and CodeGraph internal DB storage.
- The CodeGraph adapter rejects incompatible versions and denies internal `.codegraph` storage access.
- CLI commands output JSON envelope results and do not bypass runtime services.
- Running daemon RPC is loopback-only, bearer-token gated, versioned, and guarded by a repo-local lock file.
- Runtime RPC connection and lock files are private control files on POSIX systems.
- CLI and MCP discover the repo-local connection file and reuse the same daemon session before falling back to embedded runtime.
- CLI treats stale daemon connection files as unavailable and falls back to embedded runtime for normal commands.
- A foreground daemon subprocess shares runtime state across independent CLI processes and releases the connection/lock files after `archctx daemon stop`.
- Background `archctx daemon start` waits for a health-checked connection before returning, writes a repo-local log, and is idempotent when a daemon is already running.
- The package-manager `node_modules/.bin/archctx` path is smoke-tested for `daemon start`, shared session reuse, idempotent start, and cleanup through `daemon stop`.
