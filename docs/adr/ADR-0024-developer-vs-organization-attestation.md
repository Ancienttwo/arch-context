---
schemaVersion: archcontext.adr/v1
id: adr.0024.developer-vs-organization-attestation
title: Developer vs Organization Attestation
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.attestation
supersedes: []
---

# Context

Local developer devices and customer-controlled runners have different trust properties.

# Decision

Model Developer Attestation and Organization Runner Attestation as different trust levels.

# Consequences

- MVP ships Developer Attestation.
- Enterprise language must not overstate developer-device guarantees.
