# M1 Local Runtime Gate

Date: 2026-06-19

## Scope

M1 establishes the local-only runtime foundation: `archctxd`, repository session binding, worktree digest, local store migration contract, CodeGraph adapter boundary, `.archcontext/` model loader, generated projection rebuild, and thin CLI commands.

## Evidence

- Runtime daemon: `packages/runtime-daemon/src/index.ts`.
- Repository and Git binding: `packages/architecture-domain/src/index.ts`, `packages/git-adapter/src/index.ts`.
- Local store: `packages/local-store-sqlite/src/index.ts`.
- CodeGraph adapter: `packages/codegraph-adapter/src/index.ts`, pinned to `@colbymchenry/codegraph@1.0.1`.
- Model store: `packages/model-store-yaml/src/index.ts`.
- CLI: `packages/cli/src/main.ts`.

## Verified Path

Temporary repository path exercised by tests:

```text
archctx init -> .archcontext/manifest.yaml/product/model/policy/generated
archctx validate -> deterministic model digest
archctx sync -> CodeGraph adapter snapshot
archctx context -> TaskContext envelope
archctx status -> repo/head/worktree binding
```

## Verification

Command:

```bash
bun test
```

Observed result:

```text
38 pass
0 fail
```

## Boundary Notes

- The local store migration contract enables WAL, foreign keys, and busy timeout.
- The SQLite schema guard rejects source, diff, symbol payload, and CodeGraph internal DB storage.
- The CodeGraph adapter rejects incompatible versions and denies internal `.codegraph` storage access.
- CLI commands output JSON envelope results and do not bypass runtime services.
