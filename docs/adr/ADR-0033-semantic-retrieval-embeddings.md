---
schemaVersion: archcontext.adr/v1
id: adr.0033.semantic-retrieval-embeddings
title: Semantic Retrieval and Embeddings
status: accepted
decidedAt: 2026-06-20
appliesTo:
  - package.retrieval
  - package.local-store-sqlite
  - package.context-compiler
supersedes: []
---

# Context

FTS5 plus CodeGraph provides deterministic local recall today. Embeddings may improve semantic context recall, but they add index complexity, provider choice, storage cost, privacy risk, and nondeterministic tuning pressure if introduced unconditionally.

# Decision

Keep retrieval in FTS5 mode by default. Embeddings may only be enabled after the retrieval eval gate shows a clear lift over the same FTS5 baseline using fixed metrics: context recall, constraint recall, irrelevant ratio, and tool-call count. Any embedding index is local, provider-pluggable through the retrieval port, and forbidden from egress.

# Consequences

- The default path remains simple, deterministic, and local.
- Embedding work can stop at a recorded "keep off" decision when it does not win the eval gate.
- If embeddings win later, local-store owns index persistence while retrieval owns scoring and decision records.
- Eval reports, not implementation enthusiasm, decide whether the extra abstraction is allowed.

# Sprint 4 Decision Record

The Sprint 4 repo-local eval kept embeddings off. Evidence is recorded in `docs/verification/s4-retrieval-eval.md`.
