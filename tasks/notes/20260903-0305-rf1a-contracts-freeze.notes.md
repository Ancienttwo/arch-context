# Implementation Notes: rf1a-contracts-freeze

> **Status**: Active
> **Plan**: plans/plan-20260903-0305-rf1a-contracts-freeze.md
> **Contract**: tasks/contracts/20260903-0305-rf1a-contracts-freeze.contract.md
> **Review**: tasks/reviews/20260903-0305-rf1a-contracts-freeze.review.md
> **Last Updated**: 2026-09-03 04:05
> **Lifecycle**: notes

## Design Decisions

- **`RefactorTargetOutcomeV1` / `RefactorObservedOutcomeV1` shape is a design call.** The PRD names both types but never enumerates their fields; it only gives one worked example (`cycle` -> `cycleCount less_than 1`). Frozen as
  `RefactorTargetOutcomeV1 = {outcomeId, metric, subjectSelectorId, nodeId|null, operator, value: number|null, required: boolean}` and
  `RefactorObservedOutcomeV1 = {outcomeId, observedValue: number|null, satisfied: boolean, direction: "improved"|"regressed"|"unchanged"|"unknown"}`.
  Sized to that example: one numeric metric per outcome, joined to its observation by `outcomeId`, `required` driving the RF4 disposition ladder, `direction` carrying the regression signal that `satisfied` alone cannot express. `value` is `null` exactly for the value-free operators (`absent` / `present`), enforced by the validators.
- **`ModuleStatisticsSnapshotV1.repository` / `.worktree` reuse the ledger identity types.** The PRD lists narrower shapes (`{repositoryId}` and `{workspaceId, branch, headSha, worktreeDigest}`); `ArchitectureRepositoryIdentityV1` / `ArchitectureWorktreeIdentityV1` are supersets of both and are already what every other ledger record binds. Declaring a third identity shape for one entity was the worse trade; PRD §0.3 item 5 makes the same "do not re-declare" call for `subjectSelector`.
- **`PracticeRecommendationPayloadV1` fields are inferred, not specified.** The PRD names the type in the `RecommendationV3.payload` union but gives it no field list. Frozen as `{practiceId, baselineDigest: string|null}` — the smallest shape that preserves today's fingerprint semantics, because `subject` and `evidenceBindingIds` (the other two inputs of `recommendationFingerprint()`) are already v3 top-level fields.
- **`codeFacts.reasonCodes` is typed `RefactorScaleReasonCode[]`.** The PRD writes a bare `reasonCodes[]`; the only codes a code-facts probe can emit (`code-facts-missing`, `code-facts-truncated`) already live in that closed enum, so it stays closed rather than becoming `string[]`.
- **`edgeLimit` is `number | null`.** PRD RF1 forbids returning zero values when the index is missing, so an unknown edge limit must be `null` rather than `0`.

## Digest Extension Rule

Every digest helper drops the record's own digest field, its **top-level** `extensions`, and its timestamps. Nested `extensions` are hashed content: `modules[i].extensions` changes `moduleStatisticsSnapshotDigest`, while the same field is excluded when that module is hashed on its own via `moduleStatisticsDigest`. The exclusion is relative to the record being hashed, matching the existing `ledger.ts` destructure-and-hash helpers.

The one exception is the derived `targetDelta` identity: both `architectureTargetDeltaInterventionId` and `refactorProposalDigest` hash the delta through `authoredTargetDelta()`, which drops `interventionId`, `unresolvedTargets`, and `targetDelta.extensions`, so that ArchContext filling `unresolvedTargets` during assessment cannot move the agent-authored proposal identity.

## Enums Added Beyond The PRD

- `REFACTOR_OUTCOME_DIRECTIONS` (`improved`, `regressed`, `unchanged`, `unknown`) — the values are the PRD's own `direction` union; only the sorted `as const` array is new, so validators can check membership the same way as every other closed enum.
- `REFACTOR_PROPOSAL_AUTHOR_SOURCES` (`cli`, `manual`, `mcp`, `subagent`) — the PRD states this restriction as prose ("`source ∈ {cli, mcp, manual, subagent}`, 不得為 `system` / `daemon`"). Materialising it as an array lets `refactorProposalInvariantIssues` and `recommendationV3InvariantIssues` share one authority instead of repeating a literal set.
- No new enum *values* were invented. `REFACTOR_SCALE_REASON_CODES` is exactly the PRD's 10 codes, sorted.

## Deviations From Plan Or Spec

- `ledger.ts` gained one extra type-only import beyond `./refactor`: `import type { ArchitectureMajorChangeReasonCode } from "./projection"`, needed by `RefactorProposalPayloadV1.majorChangeReasons`. It is not a back-edge (`projection.ts` imports only `./schema`), and re-exporting the same type through `refactor.ts` would have produced two barrel paths to one declaration for no benefit.
- `refactorProposalDigest` excludes `targetDelta.interventionId` / `unresolvedTargets` / `extensions` (the plan scoped that exclusion to `interventionId` only). Settled inside the freeze on the gatekeeper advisory so RF2 never has to change a frozen digest; see the Digest Extension Rule above.
- `ModuleStatisticsSnapshotV1.createdAt`, `RefactorAssessmentV1.createdAt`, and `RefactorResolutionEvidenceV1.verifiedAt` are not in the PRD field lists, but the PRD requires `snapshotDigest` to exclude a timestamp, which implies one exists. Added and excluded from every digest.
- `refactorRequestInvariantIssues` is not named in the plan's validator list; added for symmetry so the entry-point entity has the same gate as the entities it carries.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Put `RECOMMENDATION_CATEGORIES` in `refactor.ts` with all other runtime code | Rejected | The plan's file-changes table places it in `ledger.ts` beside the V3 types it constrains; `refactor.ts` value-imports it, which is the plan's single intended runtime edge |
| Give `RefactorProposalV1` its own author interface | Rejected | `RecommendationAuthorV1` is the same three fields and the proposal's author is copied verbatim onto `RecommendationV3.authoredBy`; two identical shapes would drift |
| Exclude `targetDelta.unresolvedTargets` from `proposalDigest` as well as from `interventionId` | Adopted | Same reason the plan gives for `interventionId`: ArchContext fills `unresolvedTargets` after authoring, so hashing it would make the agent-authored proposal identity change under assessment and force RF2 to re-derive a frozen digest. `refactorProposalDigest` now hashes `targetDelta` through the same `authoredTargetDelta()` projection as `architectureTargetDeltaInterventionId` |

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
