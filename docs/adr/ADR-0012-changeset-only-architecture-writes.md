---
schemaVersion: archcontext.adr/v1
id: adr.0012.changeset-only-architecture-writes
title: ChangeSet-only Architecture Writes
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.changeset-engine
supersedes: []
---

# Context

Free-form model edits can corrupt architecture state and hide stale context.

# Decision

All structured architecture writes go through ChangeSet plan, preview, approve, apply, and rollback.

# Consequences

- Writes require path allowlist, expected digests, schema validation, and policy checks.
- Apply is atomic from the runtime writer.
