---
schemaVersion: archcontext.adr/v1
id: adr.0005.single-writer-runtime-daemon
title: Single-writer Runtime Daemon
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.runtime-daemon
supersedes: []
---

# Context

Repeated CLI/MCP startup would duplicate CodeGraph handles, DB connections, and task state.

# Decision

`archctxd` owns workspace sessions, locks, CodeGraph lifecycle, SQLite, and write serialization.

For MVP, the local RPC transport is protected loopback HTTP with a repo-local connection file and lock file under `.archcontext/.local/`. The connection file carries the ephemeral bearer token for local clients; it must be private to the current user, and user-visible status output must redact it. UDS / Windows Named Pipe can replace the transport later without changing the daemon ownership boundary.

# Consequences

- CLI and MCP are thin clients.
- ChangeSet apply has a single writer path.
- Two client processes can share the same daemon session when `archctxd` is running.
- Embedded runtime remains only as a recovery/test fallback when no daemon connection is available.
- Insecure connection files are ignored, and stale lock files are recovered before starting a new daemon.
- `archctx daemon start` starts a background daemon process and returns only after the connection file passes health readback.
- The package-manager `archctx` bin must preserve daemon self-spawn behavior, not only the source-file test entrypoint.
