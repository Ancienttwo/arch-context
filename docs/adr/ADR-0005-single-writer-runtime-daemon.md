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

# Consequences

- CLI and MCP are thin clients.
- ChangeSet apply has a single writer path.
