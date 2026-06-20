---
schemaVersion: archcontext.adr/v1
id: adr.0036.deterministic-gate-llm-advisory
title: Deterministic Gate, LLM Advisory
status: accepted
decidedAt: 2026-06-20
appliesTo:
  - package.review-engine
  - package.runner
  - package.github-app
supersedes: []
---

# Context

ArchContext may run near coding agents, but a required check cannot depend on model text or a cloud-hosted provider. The organization runner route must work in customer-controlled CI without LLM secrets.

# Decision

Required check conclusions come only from deterministic, versioned runtime rules: schema, policy, repository/head/worktree freshness, compatibility contracts, target/migration state, cleanup requirements, declared boundary, CodeGraph evidence, and review engine output.

LLM output may produce advisory explanations or local repair guidance. It cannot directly set Attestation `result`, required check conclusion, or Cloud stored fields.

# Consequences

- GitHub App and SaaS do not configure or proxy LLM providers.
- Runner workflows must pass no-provider tests.
- Advisory output is separate from signed deterministic evidence.
