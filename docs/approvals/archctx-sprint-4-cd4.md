# ArchContext Sprint 4 CD4 Approval Record

> **Status**: Approved
> **Date**: 2026-06-20
> **Scope**: CD4 contract delta and ADR-0032/ADR-0033

## Source

- User goal authorized full execution of `plans/sprints/archctx-sprint-4.md` with `plans/prds/20260619-2039-archcontext.prd.md` as reference.
- ADR-0032 and ADR-0033 are accepted repo-local decisions for Sprint 4 implementation.

## Approved Boundary

- Explorer remains local loopback, read-only, token-gated, and zero-egress.
- Retrieval remains FTS5 by default.
- Embeddings stay disabled unless the retrieval eval decision gate clearly beats the FTS5 baseline.
- This approval does not close Sprint 1-3 production/external readback debt.

## Evidence

- `bun test packages/contracts/test/contracts.test.ts`
