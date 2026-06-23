---
schemaVersion: archcontext.adr/v1
id: adr.0037.runtime-state-placement
title: Runtime State Placement and Identity
status: accepted
decidedAt: 2026-06-23
appliesTo:
  - package.local-store-sqlite
  - package.runtime-daemon
  - package.surfaces-cli
supersedes: []
---

# Context

ArchContext has three different state classes:

- Git-reviewed project truth under `.archcontext/`.
- Mutable local runtime state such as SQLite, daemon connection files, locks, logs, snapshots, and run manifests.
- User/device state such as license, preferences, and credential-store references.

Putting all runtime files under the repository makes single-worktree discovery simple, but it weakens the boundary between Git truth and mutable derived state and creates an anchor-repository problem for multi-repo landscapes. Putting all projects into one global database would also be wrong because repository and worktree state need strong isolation.

# Decision

Git-tracked `.archcontext/` is the repository architecture source of truth. Mutable ArchContext runtime state MUST be stored under the operating system's per-user application-data directory and partitioned by stable repository and workspace identity.

Default runtime roots:

- macOS: `~/Library/Application Support/ArchContext`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/archcontext`
- Windows: `%LOCALAPPDATA%\ArchContext`

Default storage partition layout:

```text
repositories/<storage-repository-id>/worktrees/<storage-workspace-id>/
```

The storage repository identity is derived from the Git common directory when available. The storage workspace identity is derived from the canonical worktree root. Non-Git fallback uses the canonical provided root for both identities. These storage IDs are distinct from runtime session repository IDs returned by `archctx init` and `archctx status`.

`ARCHCONTEXT_STATE_DIR` may override the OS user-data root for CI, portable environments, diagnostics, or controlled operations. `ARCHCONTEXT_LOCAL_STORE_PATH` may override only the SQLite file path for tests and diagnostics.

ArchContext MUST NOT write mutable state into its package installation directory. Repository-local runtime paths such as `.archcontext/.local/` are supported only for migration, explicit overrides, or non-secret discovery pointers.

# Consequences

- `.archcontext/model`, `.archcontext/decisions`, `.archcontext/policies`, and configured generated projections remain reviewable Git files.
- SQLite, daemon control files, logs, snapshots, and developer-review run manifests are outside the repository by default.
- Multi-repo landscapes avoid making one checkout own another repository's derived runtime state.
- Crash recovery must discover runtime paths through `archctx paths`.
- Existing `.archcontext/.local/runtime.sqlite` files may be copied forward into the new runtime partition, but `.archcontext/.local/` is not the canonical long-term state location.
