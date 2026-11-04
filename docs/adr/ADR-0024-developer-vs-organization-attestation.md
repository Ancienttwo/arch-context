---
schemaVersion: archcontext.adr/v1
id: adr.0024.developer-vs-organization-attestation
title: Developer vs Organization Attestation
status: superseded
decidedAt: 2026-06-19
appliesTo:
  - module.architecture-context.cloud
supersedes: []
supersededBy: adr.0053.retire-github-app-governance-bridge
---

> **Status**: Superseded by [ADR-0053](ADR-0053-retire-github-app-governance-bridge.md), accepted on [#478](https://github.com/Ancienttwo/arch-context/pull/478) on 2026-11-05. The GitHub App governance bridge, Developer Review and Organization Runner are retired; this record stays as history.

# Context

Local developer devices and customer-controlled runners have different trust properties.

# Decision

Model Developer Attestation and Organization Runner Attestation as different trust levels, different check contexts, and different policy semantics:

- `ArchContext / Developer Review`
- `ArchContext / Organization Runner`

`requiredTrust: organization` can only be satisfied by organization attestation bound to an active runner identity, repository scope, workflow ref, and key. Developer attestation may remain useful as an informational or soft gate, but it cannot update the organization context to success.

# Consequences

- MVP ships Developer Attestation.
- Enterprise language must not overstate developer-device guarantees.
- Protected branch or ruleset documentation must point to Organization Runner when organization trust is required.
- The legacy single-check wording is migration-only and must not be used as the current governance context.
