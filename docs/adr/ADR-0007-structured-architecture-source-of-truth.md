---
schemaVersion: archcontext.adr/v1
id: adr.0007.structured-architecture-source-of-truth
title: Structured Architecture Source of Truth
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.model-store-yaml
supersedes: []
---

# Context

Agents need machine-checkable architecture intent that still produces reviewable Git diffs.

# Decision

`.archcontext/model`, `.archcontext/decisions`, and `.archcontext/policies` are the repository source of truth. Generated Markdown and diagrams are projections.

# Consequences

- One entity per file is the default layout.
- Generated projection drift is a validation failure.
