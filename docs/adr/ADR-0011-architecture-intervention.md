---
schemaVersion: archcontext.adr/v1
id: adr.0011.architecture-intervention
title: Architecture Intervention
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.refactor-decision
supersedes: []
---

# Context

Some tasks expose structural pressure that a local patch should not hide.

# Decision

Intervention is a first-class object containing trigger, thesis, target state, migration, proof point, falsifiers, kill list, and completion criteria.

# Consequences

- High-pressure decisions are reviewable.
- Agents receive a bounded structural plan instead of vague refactor advice.
