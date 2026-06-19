---
schemaVersion: archcontext.adr/v1
id: adr.0010.compatibility-code-requires-contract
title: Compatibility Code Requires Contract
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.policy-engine
supersedes: []
---

# Context

Agents frequently add wrappers, fallbacks, and mappers because they reduce local diff risk.

# Decision

Compatibility code is valid only when backed by a Compatibility Contract with real consumer, owner, review date, and removal conditions.

# Consequences

- "Many internal callers" is migration scope, not a compatibility reason.
- Review fails unjustified compatibility paths.
