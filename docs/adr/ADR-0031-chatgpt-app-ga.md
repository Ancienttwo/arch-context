---
schemaVersion: archcontext.adr/v1
id: adr.0031.chatgpt-app-ga
title: ChatGPT App GA
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.mcp-cloud-metadata
  - package.mcp-local
  - app.chatgpt-ui
  - app.control-plane
supersedes: []
---

# Context

MVP proved ChatGPT access through a local Secure MCP Tunnel and a remote metadata-only MCP surface. GA needs a publishable app package, directory metadata, and complete UI states without weakening the local-first trust boundary.

# Decision

Ship ChatGPT App GA as a Cloud Metadata App plus local runtime tunnel. Remote MCP exposes account, billing, installation, device, directory, and policy metadata only. Private repository content, architecture bodies, findings, and writes stay behind the local runtime. Write tools remain disabled by default and require explicit local confirmation when enabled.

# Consequences

- GPT App Directory packaging can be published without proxying repository content through ArchContext SaaS.
- GA UI must show data-sharing disclosure and render Intervention, Migration Progress, and ChangeSet Diff states.
- Tunnel revocation invalidates the local runtime path.
- App review artifacts include manifest, privacy page, permissions, and rollback/version strategy.
