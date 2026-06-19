---
schemaVersion: archcontext.adr/v1
id: adr.0004.sqlite-local-store
title: SQLite Local Store
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.local-store-sqlite
supersedes: []
---

# Context

Runtime needs fast derived state for task sessions, evidence, reviews, verification, and cache.

# Decision

Use local SQLite as rebuildable derived state. Do not use PGlite for MVP.

# Consequences

- Git remains the architecture source of truth.
- SQLite is excluded from repository commits and can be rebuilt.
