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

## Cross-Review Decisions (Codex RF1a pass)

- **Outcome satisfaction is recomputed, never trusted.** `RefactorObservedOutcomeV1.satisfied` is a claim by whoever wrote the evidence, so `refactorResolutionEvidenceInvariantIssues` re-evaluates it from the expected outcome's `operator` and `value` and reports a disagreement; the disposition ladder then uses the recomputed values, not the claim. Operator semantics: `equals` / `less_than` / `greater_than` need a non-null `observedValue` and compare numerically; `absent` is satisfied by `observedValue === null || observedValue === 0` (a metric that is gone reads as either unmeasured or zero); `present` is its exact negation. A null `observedValue` never satisfies a comparison operator.
- **`fingerprint` equality is deliberately not asserted here.** `recommendationV3InvariantIssues` validates `schemaVersion` and the `sha256:<64-hex>` shape but does not check `fingerprint === digestJson(recommendationV3FingerprintInput(record))`. The hash is owned by `recommendationFingerprint()` in `packages/core/recommendation-engine`; contracts must not import core (`scripts/package-boundary-audit.mjs` enforces it), so asserting equality would mean re-deriving the hash envelope in contracts and freezing a second definition that RF3 would immediately have to fork. Equality belongs to RF3, on the engine side, where both halves are in scope.
- **Author identity is validated as a (kind, source) pair, not two independent fields.** `REFACTOR_PROPOSAL_AUTHOR_PAIRS` freezes `cli->cli`, `mcp->mcp`, `subagent->subagent`, `developer->manual`. `daemon`, `system`, `hook`, and `migration` kinds are ArchContext acting for itself and can never author a `refactor_proposal`, so `{kind: "daemon", source: "subagent"}` is rejected on the kind even though the source is allowed. `structural_observation` requires both `kind` and `source` to be `daemon`.
- **`RecommendationV3` is a discriminated union on `category`.** `RecommendationV3Base & RecommendationV3CategoryPayloadV1` makes a mismatched category/payload pair unrepresentable in typed code, while `recommendationV3InvariantIssues` still shape-guards `payload` at runtime (non-object/array/null rejected first, then a required-key check; issues returned, no throw) because v3 records also arrive from storage and RPC where the type is not enforced. Downstream branches only run their payload-specific checks after the shape guard passes.

  The no-throw guarantee is scoped to `payload` only, and deliberately so: `payload` is the one field the union cannot discriminate at runtime, which is why the validator owns it. Every other field — `authoredBy`, `evidenceBindingIds`, `subjectSelectorId`, `relations` — is trusted to match its declared type, and a null or primitive there will still throw. Guarding all of them would turn an invariant validator into a structural schema validator; structural validation of untrusted ingress belongs to the JSON Schemas deferred to RF5a, not to a second hand-written copy here.
- **`codeFacts.indexedWorktreeDigest` must equal `worktree.worktreeDigest` unless coverage is `unknown`.** A snapshot that claims `complete` or `partial` coverage while the index was built at another worktree is measuring the wrong tree; `refactorVerifyInvariantIssues` additionally refuses `resolved` in that state, so a stale index cannot launder a verification.
- **`pressure.score` is a closed domain.** Required to be an integer in `[0, 100]`, matching the clamped score the pressure engine already produces (`packages/core/pressure-engine/src/index.ts:104,160`). `pressure.level` and `confidence.level` need no runtime check: both are closed `"low" | "medium" | "high"` type unions, consistent with how `ledger.ts` declares its own small unions.
- **Numeric domains are closed.** Every count in `footprint`, `dependencyGraph`, `tests`, `uncertainty`, `repositorySummary`, plus `codeFacts.edgeLimit`, must be a non-negative integer (`null` allowed only where the type allows it); `callerCoverage` and `instability` are ratios in `[0, 1]` or `null`.

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
