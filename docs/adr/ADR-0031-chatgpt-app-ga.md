---
schemaVersion: archcontext.adr/v1
id: adr.0031.chatgpt-app-ga
title: ChatGPT App GA
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - module.architecture-context.cloud
  - component.architecture-context.surfaces.mcp-local
  - module.architecture-context.surfaces
  - component.architecture-context.cloud.control-plane
supersedes: []
---

# Context

MVP proved ChatGPT access through a local Secure MCP Tunnel and a remote metadata-only MCP surface. GA needs a publishable app package, directory metadata, and complete UI states without weakening the local-first trust boundary.

# Decision

Ship ChatGPT App GA as a Cloud Metadata App plus local runtime tunnel. Remote MCP exposes account, billing, installation, device, directory, and policy metadata only. Private repository content, architecture bodies, findings, and writes stay behind the local runtime. Write tools remain disabled by default and require explicit local confirmation when enabled.

# Amendment (2026-10-11)

The "explicit local confirmation" above is now the explicit-approval model: the caller sets `approved: true`, and apply is checked against the expected worktree digest and each operation's expected hash. See the ADR-0012 amendment and [the explicit-approval note](../researches/20261010-changeset-explicit-approval.md).

# Consequences

- GPT App Directory packaging can be published without proxying repository content through ArchContext SaaS.
- GA UI must show data-sharing disclosure and render Intervention, Migration Progress, and ChangeSet Diff states.
- Tunnel revocation invalidates the local runtime path.
- App review artifacts include manifest, privacy page, permissions, and rollback/version strategy.
