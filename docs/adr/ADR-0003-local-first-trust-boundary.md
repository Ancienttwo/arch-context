---
schemaVersion: archcontext.adr/v1
id: adr.0003.local-first-trust-boundary
title: Local-first Trust Boundary
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.control-plane
  - package.attestation
supersedes: []
---

# Context

The product promise depends on private source, diffs, symbols, CodeGraph data, architecture model body, and detailed findings staying local by default.

# Decision

SaaS handles identity, billing, GitHub metadata, challenge issuance, and attestation verification only.

# Consequences

- Cloud routes must be privacy-audited.
- ChatGPT tunnel disclosure must not claim that data never leaves the local machine.
