---
schemaVersion: archcontext.adr/v1
id: adr.0017.cloudflare-control-plane
title: Cloudflare Control Plane
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - app.control-plane
supersedes: []
---

# Context

The SaaS plane has low-write metadata needs and should stay operationally small.

# Decision

Use Cloudflare Workers, D1, and Queue for identity, entitlement, GitHub metadata, Stripe state, challenges, and attestation verification.

# Consequences

- D1 schema has no source, diff, symbol, model body, or detailed finding columns.
- Worker routes are privacy-audited.
