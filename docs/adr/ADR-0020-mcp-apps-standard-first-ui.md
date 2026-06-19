---
schemaVersion: archcontext.adr/v1
id: adr.0020.mcp-apps-standard-first-ui
title: MCP Apps Standard-first UI
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - app.chatgpt-ui
supersedes: []
---

# Context

MCP UI hosts vary; product UI should remain portable.

# Decision

Use `_meta.ui.resourceUri` and standard `ui/*` host bridge first. ChatGPT-specific behavior is enhancement only.

# Consequences

- Non-UI MCP hosts remain functional through tool output.
- UI resources are static and content-budgeted.
