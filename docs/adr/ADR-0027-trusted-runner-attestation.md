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

Add `trustLevel = organization` for customer-controlled GitHub-hosted or self-hosted runners bound to a GitHub Installation, repository scope, workflow ref, runner identity, and runner public key. The runner executes deterministic review in the customer's environment and uploads only attestation metadata, digests, and signature.

The official runner path must not require an LLM provider. LLM advisory may be an optional, non-blocking step, but required check conclusion comes only from deterministic runtime gates.

Runner keys support registration, overlap rotation, and revocation. Fork PR workflows must not expose signing secrets through unsafe `pull_request_target` execution.

# Consequences

- Protected repositories may require organization-attested checks.
- Organization attestation has higher provenance than developer attestation, but must not be described as tamper-proof or zero-trust.
- Runner key rotation and revocation invalidate future verification.
- ArchContext SaaS still does not receive repository content, findings or detailed review bodies.
- Managed ArchContext private-code runner remains outside the current route.
