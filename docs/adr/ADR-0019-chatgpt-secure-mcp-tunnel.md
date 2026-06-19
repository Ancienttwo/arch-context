---
schemaVersion: archcontext.adr/v1
id: adr.0019.chatgpt-secure-mcp-tunnel
title: ChatGPT via Secure MCP Tunnel
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.mcp-local
  - app.chatgpt-ui
supersedes: []
---

# Context

ChatGPT can help discuss architecture but private tool results sent through the connector enter OpenAI systems.

# Decision

Secure MCP Tunnel is explicit opt-in, short-lived, revocable, and scoped. UI and tools disclose data classification.

# Consequences

- Tunnel defaults off.
- Apply ChangeSet is not exposed to ChatGPT by default.
