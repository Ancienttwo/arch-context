---
schemaVersion: archcontext.adr/v1
id: adr.0023.user-level-private-entitlement
title: User-level Private Entitlement
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.control-plane
supersedes: []
---

# Context

Per-repository or per-seat pricing creates friction for solo developers using many private repositories.

# Decision

Personal Pro covers all private repositories the developer can access. Public repositories remain free.

# Consequences

- Entitlement checks key on user plus repository visibility.
- Adding more private repos does not add per-repo billing.
