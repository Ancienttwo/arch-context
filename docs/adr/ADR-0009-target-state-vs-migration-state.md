---
schemaVersion: archcontext.adr/v1
id: adr.0009.target-state-vs-migration-state
title: Target State vs Migration State
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.architecture-domain
supersedes: []
---

# Context

Migration structures are often mistaken for final architecture and then become permanent debt.

# Decision

Target State and Migration State are separate concepts in interventions and reviews.

# Consequences

- Compatibility code must have explicit removal criteria.
- Completion gates verify that target and migration are not conflated.
