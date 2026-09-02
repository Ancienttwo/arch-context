> **Archived**: 2026-09-03 07:12
> **Related Plan**: plans/archive/plan-20260903-0512-rf2-assessment-observations-scale.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260903-0712

# Implementation Notes: rf2-assessment-observations-scale

> **Status**: Active
> **Plan**: plans/plan-20260903-0512-rf2-assessment-observations-scale.md
> **Contract**: tasks/contracts/20260903-0512-rf2-assessment-observations-scale.contract.md
> **Review**: tasks/reviews/20260903-0512-rf2-assessment-observations-scale.review.md
> **Last Updated**: 2026-09-03 05:13
> **Lifecycle**: notes

## Design Decisions

- `assessRefactor({snapshot, model, request, requestId, createdAt})` returns `{assessment, proposal}`. The scan validator reads `proposal.targetDelta.unresolvedTargets`, and ArchContext is the party that fills it, so returning a bare assessment would leave the caller unable to satisfy `refactorScanInvariantIssues`. The fill is digest-safe: both `refactorProposalDigest` and `architectureTargetDeltaInterventionId` hash the delta with `unresolvedTargets` excluded, asserted in `target-delta.test.ts`.
- `request.task` is never read. Isolation is asserted as full `assessmentDigest` equality with and without task text, not merely equal scale.
- Pressure is derived from RF2's own observations using the pressure engine's weights (25/15/5, capped 100) and thresholds (60/30). `detectArchitecturePressure` is not called: its observed predicates regex over path/symbol strings and `multiple-lifecycle-owner` folds task text into an observed signal.
- `modelDigest` is re-derived here to bind `model` to `snapshot.modelDigest`. RF1b keeps its own copy private and RF1b is frozen for this slice, so the binding check could not reuse it. Without the check the classifier would resolve ownership against a model the snapshot never measured.
- `scopePaths` entries carrying a glob metacharacter or a trailing `/` are classified unowned before ownership resolution. `matchesGlob("src/m/**", "src/m/**")` is true, so a glob would otherwise resolve to a real owner and a set of files would be reported as one file.
- `ownership-changed` is derived only when every `targetState.owners` value resolves. An unresolvable owner establishes exactly one fact — the target is unresolved — and reading it as an ownership change would let a typo look like a decision.

## Deviations From Plan Or Spec

- **Scale ladder: `target-unresolved` moved ahead of the model gate.** The plan table puts the model gate (rows 1) before the evidence gate (rows 2), which includes `unresolvedTargets`. The frozen `refactorScanInvariantIssues` (`packages/contracts/src/refactor.ts:719-725`) makes a non-empty `targetDelta.unresolvedTargets` require `scale === "insufficient_evidence"` unconditionally, so a proposal that both names an unresolvable target and touches an unowned path could not be reported as `model_adoption_required` without emitting a pair that fails the frozen validator. The ladder therefore leads with `target-unresolved`; the model gate still precedes the remaining evidence conditions (coverage, contested ownership). No information is lost: `scaleReasonCodes` still carries `unowned-paths` / `node-footprint-undeclared` alongside `target-unresolved`. Covered by `scale.test.ts` "an unresolved target outranks the model gate, as the frozen scan invariant requires". No fixture named in the plan required this, and the frozen contract was not edited.

### Cross-review round 2 (Codex [P1] x3)

- **Snapshot is validated before it is read.** `assessRefactor` runs `moduleStatisticsSnapshotInvariantIssues` first and throws `AC_SCHEMA_INVALID`. Without it a snapshot whose payload was altered while `snapshotDigest` was kept would be laundered into a signed assessment. Test: `observations.test.ts` "rejects a snapshot whose payload no longer binds its own digest".
- **`scopePaths` are tested against the snapshot's tracked files, not against string syntax.** `trackedFiles: readonly string[]` is now a required input field; any entry outside that set is unowned before ownership resolution. This closes the real hole: `src/m/a/absent.ts` matches `component.a`'s include glob and would previously have resolved to a real owner. The metacharacter rejection stays as defense in depth and now covers `* ? [ ] { } ( ) !` plus a trailing `/`. Comparison is exact string equality: both sides are already contract-constrained to repo-relative POSIX (`isRepoRelativePosixPath` on `scopePaths`, `readTrackedSourceFiles` on the producer side), so adding a normalizer would fork the path dialect rather than reconcile one. Tests: `scale.test.ts` `test.each` over glob / character class / brace expansion / extglob / directory / untracked file, plus "an untracked path is unowned even though a node glob claims it".
- **Declared selector ids resolve in `targetDelta`.** A `removedConcepts` entry now resolves against node ids, relation ids, declared entrypoint ids, declared sink ids, and `snapshot.modules[].surfaces.observedEntrypoints`; only an id matching none is unresolved. A resolved entrypoint or sink contributes no reason code in v1 — `entrypoint-changed` and `interface-changed` would need the removed surface compared against a full target semantic state, which is exactly the target model RF2 must not build (PRD §0.1). It also contributes no `affectedNodeIds`, since a selector id is not a node id. Tests: `target-delta.test.ts` "declared selector resolution" (3 cases, incl. the same id unresolved against a snapshot that never observed it) and `scale.test.ts` "a removed declared entrypoint is resolved, so the scale is not insufficient_evidence".
- The observed-entrypoint fixture is built by `withObservedEntrypoint`, which reseals `moduleDigest` and `snapshotDigest` through the frozen helpers rather than tampering with a signed payload — required now that item 1 validates the snapshot.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Keep the model gate strictly first and accept an invalid pair in the combined case | Rejected | Would ship a classifier able to emit output that fails the frozen scan validator |
| Suppress `unresolvedTargets` when the model gate fires | Rejected | The unresolved id is a fact about the delta; hiding it to satisfy an ordering is inventing state |
| Emit `scaleReasonCodes` only for the winning ladder row | Rejected | Downstream loses the other true blockers; the codes are sorted-unique facts, not a single verdict |
| Reuse `detectArchitecturePressure` | Rejected | Its observed signals regex over strings and admit task text; RF2 admits nothing heuristic |
| Normalize `scopePaths` before matching `trackedFiles` | Rejected | Both sides are already repo-relative POSIX by contract; a normalizer would be a second path dialect |
| Derive `entrypoint-changed` from a removed declared entrypoint | Rejected | Needs a full target semantic state to compare against, i.e. ArchContext authoring the target model (PRD §0.1) |
| Keep syntax-only `scopePaths` checking | Rejected | `src/m/a/absent.ts` matches a node include glob, so a nonexistent file resolved to a real owner |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
