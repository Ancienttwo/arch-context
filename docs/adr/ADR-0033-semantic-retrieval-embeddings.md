---
schemaVersion: archcontext.adr/v1
id: adr.0033.semantic-retrieval-embeddings
title: Semantic Retrieval and Embeddings
status: accepted
decidedAt: 2026-06-20
appliesTo:
  - component.architecture-context.core.retrieval
  - component.architecture-context.local-runtime.local-store-sqlite
  - component.architecture-context.core.context-compiler
supersedes: []
---

> Approval source: Sprint 4 CD4 record, first committed in `aa3d5b98`, [docs/approvals/archctx-sprint-4-cd4.md @ 04b4c108](https://github.com/Ancienttwo/arch-context/blob/04b4c1084d78f7c2fa805f4cebd64a84bee84924/docs/approvals/archctx-sprint-4-cd4.md). Removed from `docs/approvals/` by [#442](https://github.com/Ancienttwo/arch-context/issues/442).

# Context

The current shipped retrieval path is an in-memory lexical baseline over constraint-tagged documents, with English normalization and jieba search tokenization for Chinese. Real SQLite FTS5 remains part of the local-store target architecture, but it is not the current implementation. Embeddings may improve semantic context recall, but they add index complexity, provider choice, storage cost, privacy risk, and nondeterministic tuning pressure if introduced unconditionally.

# Decision

Keep retrieval in lexical mode by default until a real SQLite FTS5 index is implemented and verified. Embeddings may only be enabled after the retrieval eval gate shows a clear lift over the same lexical baseline using fixed metrics: context recall, constraint recall, irrelevant ratio, and tool-call count. Any embedding index is local, provider-pluggable through the retrieval port, and forbidden from egress.

# Consequences

- The default path remains simple, deterministic, and local.
- Embedding work can stop at a recorded "keep off" decision when it does not win the eval gate.
- If embeddings win later, local-store owns index persistence while retrieval owns scoring and decision records.
- Eval reports, not implementation enthusiasm, decide whether the extra abstraction is allowed.

# Sprint 4 Decision Record

The Sprint 4 repo-local eval kept embeddings off. Evidence is recorded in `docs/verification/s4-retrieval-eval.md`.
