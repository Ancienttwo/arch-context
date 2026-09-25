# RPC client entrypoint and state-path authority — issue #164

Pinned baseline: `56c1128babc4f10baf803e6964cd8e364f593e76` (PR #207).

## P1 — ownership

MCP imported its RPC connection-file factory through `runtime-daemon/src/index.ts`. Bundling that surface at the baseline loaded both the daemon facade and `local-store-sqlite/src/index.ts`. Importing `daemon-control.ts` directly would still load SQLite because its path resolver came from the store barrel.

`runtime-state-paths/src/index.ts` now owns the existing OS state-root policy, Git common-dir/worktree identities and derived paths. It imports only Node built-ins. The store re-exports the same public symbols; daemon control and the fast hook consume this single path authority. Three path tests move alongside the module, with their Git fixture helpers shared with the store tests.

`@archcontext/local-runtime/runtime-rpc-client` is the narrow entrypoint for the RPC client, connection factory, wire contract and the erased book-input type needed by MCP. It uses the shared control-file helpers without loading `rpc-server.ts`, the daemon facade or SQLite. The architecture model records the shared control-helper dependency explicitly rather than claiming that all control functions moved into the client.

## P2 — trace

For MCP, the connection factory resolves the user state directory and repository/worktree partition, validates the existing connection file and constructs the same RPC client. RPC method defaults, authentication, deadlines and wire encoding remain table-owned.

For the fast hook, repository discovery remains unchanged. Its connection read now calls the same state-path resolver as the store and daemon. The actual loopback request test writes connection files using the store's public path API, then enqueues from the repository root, a monorepo subdirectory and a linked worktree. Each request reaches the expected server and retains the repository root and event/source parameters.

## P3 — constraints and verification

All nine extracted path declarations retain exact source text. Existing public store imports and path values remain available; no migration, new directory layout or write authority is introduced. The hook's digest implementation and other helpers remain separate deferred work in #164. This slice does not claim to complete all helper deduplication.

A bundler dependency test checks actual runtime inputs for both MCP and the new client entrypoint. It includes the RPC client and shared path resolver while rejecting the daemon facade and SQLite source. Baseline bundling confirms both forbidden implementations were previously present. Existing MCP tests and the new root/subdirectory/worktree hook test exercise behavior in addition to that import boundary.

Self-model footprint and relation changes use daemon ChangeSet and validate without errors. At 10x invocation volume, the same Git path discovery subprocesses remain the cost; this extraction makes no latency or throughput claim.

Full `bun run verify` passed with 2009 tests and zero failures, including typecheck, package boundaries and all configured gates. The daemon retains its 34 runtime exports and the store retains its 27 runtime exports.
