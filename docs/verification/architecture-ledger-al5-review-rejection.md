# Architecture Ledger AL5 Review Rejection Readback

Date: 2026-06-26
Scope: AL5-12

## P1 Map

The implementation boundary is `packages/core/review-engine`. The new review path consumes a preview `ChangeSetDraft` from `packages/core/changeset-engine` and returns the existing `archcontext.review/v1` result shape.

The mutation boundary is unchanged. This review path does not apply a ChangeSet, append ledger events, write YAML projections, or persist source/diff bodies. It only evaluates candidate operation metadata already present in the preview proposal.

## P2 Traced Path

Input path:

1. `ChangeSetDraft.operations`
2. `reviewArchitectureCandidateChangeSet(...)`
3. deterministic metadata checks for unsupported candidate mutations
4. `PolicyFinding[]`
5. schema-valid `archcontext.review/v1` result

The checks reject:

- unsupported entity deletion
- owner authority changes
- constraint changes that can relax boundaries
- external-contract claims

The review ignores operation `body` while scanning metadata, and test coverage proves raw source/diff markers are not copied into the review result.

## P3 Decision

AL5 candidate promotion is still proposal-only, so the smallest coherent enforcement point is the review engine. This keeps `ChangeSetEngine.apply()` focused on atomic mutation mechanics while review-engine owns policy rejection before an accepted proposal can be treated as safe.

The implementation uses structured operation metadata and bounded JSON token checks for `external-contract` claims. It avoids LLM-style natural-language judgment and preserves the existing `archcontext.review/v1` contract instead of adding a parallel review schema.

## Verification

- `bun test packages/core/review-engine/test/review-engine.test.ts`
- `bun run typecheck`

The new tests assert:

- risky candidate operations fail with four explicit review findings
- supported node-add candidate proposals pass
- results validate against `schemas/runtime/review-result.schema.json`
- raw source and diff body markers are not returned in review output
