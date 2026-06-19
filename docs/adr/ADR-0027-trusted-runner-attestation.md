---
schemaVersion: archcontext.adr/v1
id: adr.0027.trusted-runner-attestation
title: Trusted Runner Attestation
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.attestation
  - package.runner
  - package.github-app
supersedes: []
---

# Context

Developer-attested review proves a local key signed a review digest, but it cannot prove the developer runtime was controlled by the organization.

# Decision

Add `trustLevel = organization` for customer-controlled runners bound to a GitHub Installation and runner public key. The runner executes review in the customer's environment and uploads only attestation metadata, digest and signature.

# Consequences

- Protected repositories may require organization-attested checks.
- Organization attestation has higher provenance than developer attestation, but must not be described as tamper-proof or zero-trust.
- Runner key rotation and revocation invalidate future verification.
- ArchContext SaaS still does not receive repository content, findings or detailed review bodies.
