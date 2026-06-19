---
schemaVersion: archcontext.adr/v1
id: adr.0001.agentic-architecture-control-loop
title: Agentic Architecture Control Loop
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.application
supersedes: []
---

# Context

ArchContext is not a passive architecture document browser. It exists to change how coding agents act during real implementation work.

# Decision

The runtime exposes a task SOP: `prepare_task`, `checkpoint`, `plan_update`, `apply_update`, and `complete_task`.

# Consequences

- Search-only integrations are insufficient.
- Review and write operations must bind to task state and repository snapshots.
