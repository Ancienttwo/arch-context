---
schemaVersion: archcontext.adr/v1
id: adr.0018.dual-mcp-surface
title: Dual MCP Surface
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.mcp-local
  - package.mcp-cloud-metadata
supersedes: []
---

# Context

Local agents need full architecture workflow tools while SaaS should only expose account and metadata actions.

# Decision

Maintain separate local full MCP and remote metadata-only MCP surfaces.

# Consequences

- Remote MCP has no repository content proxy.
- Local write tools still require ChangeSet policy.
