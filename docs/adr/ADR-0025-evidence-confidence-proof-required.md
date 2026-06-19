---
schemaVersion: archcontext.adr/v1
id: adr.0025.evidence-confidence-proof-required
title: Evidence Confidence and Proof Required
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.refactor-decision
supersedes: []
---

# Context

High architecture pressure with low evidence confidence is exactly where agents should avoid both blind rewrites and endless patches.

# Decision

Pressure and confidence are separate signals. High pressure with low confidence enters Proof Required.

# Consequences

- Proof Point is generated before structural change.
- Reviews distinguish heuristic evidence from verified evidence.
