---
schemaVersion: archcontext.adr/v1
id: adr.0008.declared-observed-verified
title: Declared / Observed / Verified
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.review-engine
  - package.reconcile-engine
supersedes: []
---

# Context

Declared intent, code facts, and validation state drift at different speeds.

# Decision

Keep declared architecture, observed evidence, and verified alignment as separate state classes.

# Consequences

- CodeGraph observations never overwrite declared model automatically.
- Review reports name the layer where a mismatch occurs.
