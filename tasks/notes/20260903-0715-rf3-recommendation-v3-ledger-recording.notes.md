# Implementation Notes: rf3-recommendation-v3-ledger-recording

> **Status**: Active
> **Plan**: plans/plan-20260903-0715-rf3-recommendation-v3-ledger-recording.md
> **Contract**: tasks/contracts/20260903-0715-rf3-recommendation-v3-ledger-recording.contract.md
> **Review**: tasks/reviews/20260903-0715-rf3-recommendation-v3-ledger-recording.review.md
> **Last Updated**: 2026-09-03 09:20
> **Lifecycle**: notes

## Design Decisions

- **Materialization is additive.** `planRecommendationRun` and `ACTIVE_RECOMMENDATION_STATUSES` are untouched (RF0 fixture `plan-recommendation-run.json` still passes byte-identical). `planRefactorRecommendationRun` sits beside them with its own `REFACTOR_ACTIVE_RECOMMENDATION_STATUSES` that includes `accepted`, matching `open_recommendations_view`: an accepted refactor proposal is in flight and re-detecting its fingerprint must suppress, not duplicate.
- **Fingerprints.** `recommendationV3Fingerprint` delegates `practice` to the frozen `recommendationFingerprint` (v1 tag) because `recommendationId` is fingerprint-derived and a migrated record must keep its identity. Refactor categories hash `recommendationV3FingerprintInput` under `archcontext.recommendation-fingerprint/v2`.
- **Refactor-category ids bind the regression link.** `recommendation.${digestSuffix(digestJson({fingerprint, regressesFrom}))}`. A plain fingerprint-derived id would collide with the resolved record and `INSERT OR REPLACE` it away. Practice ids keep the frozen derivation.
- **Selector identity has one authority.** `selectorIdFor` in `architecture-delta` became the exported `architectureSubjectSelectorId`; the delta builder, the proposal subject and the v2-to-v3 upcast all call it.
- **Migration appends, never rewrites.** `ledger migrate --recommendation-v3` replays `mode: "genesis"`, upcasts every v2 record still latest for its id, and appends one event with `source: "migration"` and `operations: []`. An in-place `UPDATE` would leave the event log — the real authority — at v2. Empty `operations` is why `ledger rebuild` replays to an identical `graphDigest` (asserted before/after in the daemon and sqlite tests). `LOCAL_SQLITE_MIGRATIONS.length` stays 20.
- **The upcast never invents.** Missing `practiceId` or a non-string `extensions.baselineDigest` raises `AC_SCHEMA_INVALID`. The original `updatedAt` is preserved under `extensions.recommendationV3Migration`.
- **Resolve is v3-only and evidence-gated.** `resolve` on a v2 record returns `AC_PRECONDITION_FAILED` naming the migrate command. On a v3 non-practice record it returns `AC_REFACTOR_EVIDENCE_REQUIRED` both without a digest (`evidence-digest-missing`) and with one (`refactor-resolution-evidence-unavailable`, message names `refactor verify` (0.5.1)) — accepting a digest RF3 can never verify would be a lie in the ledger. `acknowledge/accept/reject/defer/waive` and every `practice` path are unchanged.
- **`refactorRecord` binds the measurement to HEAD.** `registerRefactorAssessment` is in-process only and never dispatched, so the snapshot and assessment cannot be resubmitted by an RPC caller. Stale worktree or HEAD ⇒ `AC_REFACTOR_STALE`; unknown/evicted digest ⇒ `AC_SCHEMA_INVALID`; bad author pair ⇒ `AC_REFACTOR_PROPOSAL_UNAUTHORED` (checked before the general scan invariants so the specific code wins); non-empty `refactorScanInvariantIssues` ⇒ `AC_SCHEMA_INVALID`. One `appendArchitectureEvents` transaction, `source: "refactor_scan"`, `catalogDigest` = classifier ruleset digest, `trigger {level: "L2", source: "refactor_scan"}`.
- **`model_adoption_required` records evidence, not a proposal;** `insufficient_evidence` does record the proposal — the scale value is the fail-closed signal RF4 reads.

## Deviations From Plan Or Spec

- **Evidence payload shape corrected mid-flight (orchestrator instruction).** The plan's `payload.evidenceItems` shape is rejected by `assertNoNewLegacyEvidencePayload` (`packages/local-runtime/local-store-sqlite/src/index.ts:3798`). New evidence is emitted as `payload.evidenceOperations: EvidenceLifecycleOperationV1[]` with `payloadVersion: ARCHITECTURE_EVIDENCE_LIFECYCLE_PAYLOAD_VERSION`. The operations are computed incrementally (create when absent, update when the digest moved, never remove) rather than through `compileEvidenceLifecycleOperations`, whose full-state reconcile would emit removals for items other producers own. Item operations are emitted before binding operations because a binding create requires its item to already be live in the same event.
- **Every `refactorRecord` now persists the baseline snapshot as evidence (orchestrator instruction).** `EvidenceItemV2` with `selector: {kind: "snapshot", id: snapshot.snapshotDigest}`, the snapshot body under `extensions.moduleStatisticsSnapshot`, `strength: "observed"`, `origin: "runtime-daemon"`, digest via the `{digest, extensions}`-stripped `digestJson` pattern; one `EvidenceBindingV1` per emitted recommendation with `target.kind: "recommendation"`. RF4 needs the persisted BEFORE snapshot to compute `direction`/`regressed`. Its `createdAt` is `snapshot.createdAt`, not the daemon clock, so re-recording the same snapshot produces zero evidence operations instead of a timestamp-only update. Consequence: `evidenceBindingIds` is now non-empty on every emitted record, so `computeRecommendationUncertainty` no longer adds `missing-evidence`.
- **`structural_observation.derivedOutcomes` is deliberately `[]` (orchestrator instruction).** RF4 owns the kind-to-outcome derivation in `refactor-assessment`; RF3 records the fact and its baseline, not the acceptance test for it. An earlier draft carried a kind-to-metric map in the engine; it was removed rather than forked into a second definition.
- **`refactorRecord` takes no `selection` input.** The plan named `selection?` without defining it. An unused, untested optional input is a speculative knob, so the RPC input is `{assessmentDigest, expectedWorktreeDigest}` only. Re-add it in RF5a when `refactor scan` gives it a meaning.
- **The docs bucket that flipped is `recommendation-engine`, not `local-runtime`.** The plan predicted `module-architecture-context-local-runtime.md:25` would move `10k-20k` to `20k-50k`. The actual owned drift was `component-architecture-context-core-recommendation-engine.md` moving `500-1000` to `1000-2000` lines; local-runtime stayed in its bucket. Regenerated through `docs apply --approved --id changeset.docs-rf3-1` with `majorChange.mode: "none"`; `docs drift --json` is `ok: true` and a second `docs plan --json` reports zero owned drift.
- **Reader widenings the plan did not enumerate.** `ArchitectureBookRecommendationsResult.recommendations`, `latestBookRecommendations` and `explainBookRecommendation` in `architecture-ledger`, plus `transitionRecommendationLifecycle` (now generic), `createRecommendationFeedback`, `recommendationLifecycleLedgerPayload` and `aggregateRecommendationLifecycleMetrics` in `recommendation-engine`, all had to accept `RecommendationV2 | RecommendationV3`. Without them the book and lifecycle surfaces would stop typechecking the moment a v3 record exists. All read only fields common to both arms.
- **`assertArchitectureLedgerPersistenceSafe` caps a persisted payload at 262,144 bytes.** The baseline snapshot body now rides inside the event payload, so a very large repository snapshot will fail the append closed rather than truncate. Left as-is: fail-closed is correct, and RF5a owns the real-repository scan that would hit it.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| In-place `UPDATE` of `recommendations` vs. one appended migration event | Appended event | The event stream is the authority; an UPDATE would leave the log at v2 while the table claimed v3. `INSERT OR REPLACE` refreshes the row for free. |
| Migration event carrying `operations` vs. `operations: []` | `operations: []` | Base/resulting-digest validation is skipped for empty operations, which is exactly why rebuild parity holds by construction rather than by luck. |
| `resolve` accepting an `--evidence-digest` it cannot verify vs. rejecting both cases | Reject both | Reading a `payload.refactorResolutionEvidence` RF3 never writes would be dead compatibility code, and accepting an unverifiable digest would record a false resolution. |
| Deriving `derivedOutcomes` in the engine vs. leaving it to RF4 | Leave to RF4 | Two producers deriving the same kind-to-outcome mapping is a fork; the verifier that evaluates it should own it. |
| Baseline evidence `createdAt = now` vs. `= snapshot.createdAt` | `snapshot.createdAt` | A clock-bound digest turns every repeat record into an evidence update that changes nothing but a timestamp. |
| Full-state `compileEvidenceLifecycleOperations` vs. incremental create/update | Incremental | The scan adds evidence; the full-state reconcile would emit `remove` operations for items other producers own. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- `bun run typecheck` -> exit 0; `node scripts/package-boundary-audit.mjs` -> "Package boundary audit passed (5 workspaces)".
- New suites: `packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts` (16 pass), `packages/local-runtime/local-store-sqlite/test/recommendation-v3-migration.test.ts` (6 pass), `packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts` (15 pass).
- Regression suites: recommendation-engine + 6 refactor-baseline + 2 contracts + module-statistics + refactor-assessment = 417 pass; local-store-sqlite 80 pass; local-runtime 149 pass; cli 62 pass.
- Rebuild parity measured in `refactor-recording.test.ts` ("keeps the rebuilt graphDigest identical..."): `ledger rebuild` graphDigest before the migration equals the graphDigest after it, with `appendedEventCount: 1` in between and `0` on the second migration run. Measured value both sides: `sha256:63bbbc3df07f73e5842110ddab52070593c66a1d8d6effa5f35ba8a928a441b3`.
- `bun run verify` -> exit 0.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
