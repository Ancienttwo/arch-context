---
schemaVersion: archcontext.adr/v1
id: adr.0017.cloudflare-control-plane
title: Cloudflare Control Plane
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - component.architecture-context.cloud.control-plane
supersedes: []
---

# Context

The SaaS plane has low-write metadata needs and should stay operationally small.

# Decision

Use Cloudflare Workers, D1, and Queue for identity, entitlement, GitHub metadata, Stripe state, challenges, and attestation verification.

# Consequences

- D1 schema has no source, diff, symbol, model body, or detailed finding columns.
- Worker routes are privacy-audited.

## Cloud release gate

This decision remains the delivery target. Local CLI status truthfulness does not deliver the cloud service. Before a real cloud release, #224 must demonstrate D1-backed identity/challenge/lease/nonce state across Worker restarts, Queue-backed check delivery, a real authorization exchange and device registration, and secure credentials usable by a later CLI process. In-memory ControlPlane and credential adapters and FG3 fixture readbacks do not satisfy this gate. The CLI connection surface fails closed while that composition is unavailable.
