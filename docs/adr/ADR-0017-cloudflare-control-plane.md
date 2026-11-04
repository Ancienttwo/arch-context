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

> **Amended**: [ADR-0053](ADR-0053-retire-github-app-governance-bridge.md) ([#478](https://github.com/Ancienttwo/arch-context/pull/478), 2026-11-05): the control plane no longer covers GitHub metadata, challenges or attestation verification. Identity, entitlement and Stripe state stay as written and stay deferred. The "Cloud release gate" section is removed: #224 is closed, and the challenge, lease and check delivery it gated are retired. The section also gated identity, authorization exchange, device registration and credential storage; the deferred identity and billing decision sets its own release gate for those.

# Context

The SaaS plane has low-write metadata needs and should stay operationally small.

# Decision

Use Cloudflare Workers, D1, and Queue for identity, entitlement, and Stripe state.

# Consequences

- D1 schema has no source, diff, symbol, model body, or detailed finding columns.
- Worker routes are privacy-audited.
