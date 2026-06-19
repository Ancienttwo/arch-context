---
schemaVersion: archcontext.adr/v1
id: adr.0028.per-seat-billing-v1
title: Per-seat Billing v1
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.control-plane
  - package.control-plane-client
supersedes: []
---

# Context

Sprint 2 adds annual billing and multi-repo value, but team billing would expand the product into organization administration.

# Decision

Keep v1 billing per person: public repositories are free, Pro is $5/user/month or $99/user/year, and one user's Pro entitlement covers all private repositories that user can access.

# Consequences

- Entitlement carries `billingInterval`, not team seat pools.
- Monthly to annual switching delegates proration to Stripe.
- Organization private repositories require each participating developer to have their own seat.
- No SSO, SCIM, centralized policy distribution or organization billing is introduced in this sprint.
