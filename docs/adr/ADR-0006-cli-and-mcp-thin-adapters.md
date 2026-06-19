---
schemaVersion: archcontext.adr/v1
id: adr.0006.cli-and-mcp-thin-adapters
title: CLI and MCP as Thin Adapters
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.cli
  - package.mcp-local
supersedes: []
---

# Context

Multiple user surfaces must not fork architecture semantics.

# Decision

CLI, stdio MCP, and local HTTP MCP call shared application services and only perform transport, validation, and rendering.

# Consequences

- Contract tests compare CLI and MCP outputs for the same task.
- Business logic does not live in tool descriptions.
