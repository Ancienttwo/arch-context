---
schemaVersion: archcontext.adr/v1
id: adr.0003.local-first-trust-boundary
title: Local-first Trust Boundary
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - component.architecture-context.cloud.control-plane
  - module.architecture-context.cloud
supersedes: []
---

> **Amended**: [ADR-0053](ADR-0053-retire-github-app-governance-bridge.md) ([#478](https://github.com/Ancienttwo/arch-context/pull/478), 2026-11-05) removed GitHub metadata, challenge issuance and attestation verification from the SaaS scope.

# Context

The product promise depends on private source, diffs, symbols, CodeGraph data, architecture model body, and detailed findings staying local by default.

# Decision

SaaS handles identity and billing only.

# Consequences

- Cloud routes must be privacy-audited.
- ChatGPT tunnel disclosure must not claim that data never leaves the local machine.
