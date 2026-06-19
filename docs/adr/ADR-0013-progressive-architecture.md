---
schemaVersion: archcontext.adr/v1
id: adr.0013.progressive-architecture
title: Progressive Architecture
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.architecture-domain
supersedes: []
---

# Context

Simple applications should not be forced into enterprise modeling overhead.

# Decision

Governance level grows from L0 to L3 based on product complexity, risk domain, and architecture pressure.

# Consequences

- L0 projects can start with a product and a few nodes.
- Payment, auth, and private data boundaries raise governance requirements.
