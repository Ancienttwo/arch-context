---
schemaVersion: archcontext.adr/v1
id: adr.0012.changeset-only-architecture-writes
title: ChangeSet-only Architecture Writes
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - component.architecture-context.core.changeset-engine
supersedes: []
---

# Context

Free-form model edits can corrupt architecture state and hide stale context.

# Decision

All structured architecture writes go through ChangeSet plan, preview, approve, apply, and rollback.

# Consequences

- Writes require path allowlist, expected digests, schema validation, and policy checks.
- Apply is atomic from the runtime writer.
- CLI and MCP share one approval model (amended 2026-10-10, issue #260). Apply requires an explicit approval (`archctx apply --approved`, MCP `approved: true`), the preview's expected worktree digest, and each entity operation's expected file hash. The one-time approval token issued by `archctx approve` and `archctx projection approve` is removed. See [the explicit-approval note](../researches/20261010-changeset-explicit-approval.md).
