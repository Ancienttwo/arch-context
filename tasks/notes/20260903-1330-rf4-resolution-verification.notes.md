# Implementation Notes: rf4-resolution-verification

> **Status**: Active
> **Plan**: plans/plan-20260903-1330-rf4-resolution-verification.md
> **Contract**: tasks/contracts/20260903-1330-rf4-resolution-verification.contract.md
> **Review**: tasks/reviews/20260903-1330-rf4-resolution-verification.review.md
> **Last Updated**: 2026-09-03 13:33
> **Lifecycle**: notes

## Design Decisions

- `evaluateResolution` is pure: no clock, no filesystem, no network. `verifiedAt`, the verified HEAD, the worktree digest and the baseline digest all arrive as inputs, so two evaluations of the same inputs are byte-identical and `resolutionDigest` (which excludes `verifiedAt`) is a stable idempotency key.
- The frozen validator is the disposition authority. `evaluateResolution` re-runs `refactorVerifyInvariantIssues` on the sealed record and throws on any disagreement, so a drift between the local `outcomeSatisfied` copy and `packages/contracts` fails closed instead of shipping an invented verdict. `outcomeSatisfied` is copied because contracts does not export it; the copy is never trusted on its own.
- `stale` is the single "cannot decide" arm. Because the frozen validator forbids `resolved` under incomplete coverage or a non-covering index, verify on an unindexed or dirty worktree can never return `resolved`. The deliberate PRD deviation (RF4 Failure path 2's `partially_resolved`) is unreachable and is not implemented.
- Kill-list `path` is decided against the tracked-file set and `relation` against the declared model's relation ids; both are exact membership questions. `symbol` is not decidable from `ModuleStatisticsSnapshotV1` (it carries entrypoints, not a symbol inventory), so a required symbol entry forces `stale` and a non-required one is a warning residual. Kill-list `direction` is always `unknown`: a snapshot carries `sourceFilesDigest`, not a file list.
- Observation kinds derive `absent`/`present` outcomes, never `less_than 1`: `less_than` on a `null` observation is unsatisfied, so dissolving the subject module — the strongest possible fix — would read as a failure to fix it.
- Outcome ids are derived only for ArchContext-synthesized outcomes (observation derivations, kill-list entries). An agent-authored `targetOutcome` keeps the id it authored, because that id is digest-bound into `proposalDigest`; re-deriving it would rewrite authored data.
- `recommendationDigest` binds `recommendationId`, `fingerprint`, `category`, `subjectSelectorId` and `payload`, and deliberately excludes `status`/`updatedAt`: acknowledging a record between two verifies must not fork the resolution digest.
- The evidence event carries `operations: []`, so `ledger rebuild` replays to the same `graphDigest` with or without it. Evidence rides in `payload.evidenceOperations` with `payloadVersion: archcontext.architecture-evidence-lifecycle/v2`; `payload.evidenceItems` throws at append.
- Re-verify does not rely on idempotency-key dedup. The real store recomputes the submitted event's hash and throws `architecture-ledger-idempotency-conflict` when the second submission differs (it does — the clock moves). Instead the daemon looks the verdict up by `resolutionDigest` before appending and returns `append.status: "already-recorded"`.
- The evidence operations are diffed incrementally against the replayed evidence state (RF3's `evidenceLifecycleOperations`, now exported). Blind `create` would throw when the AFTER snapshot is the same measurement a prior `refactor record` already made live.
- The resolve gate reads the **live** HEAD, not the ledger scope's. The stored scope carries the identity of the last appended event; resolving is a claim about the tree that is here now.

## Deviations From Plan Or Spec

- **`runRefactorVerify` is the pure planner; the daemon owns IO.** The plan described `runRefactorVerify` as doing load → guard → re-scan → evaluate → append. It takes the AFTER measurement, model, tracked files, evidence state and graph digest as inputs and returns `{evidence, resolutionItem, afterSnapshotItem, binding, evidenceOperations, event}`; `ArchctxRuntimeDaemon.refactorVerify` does `findRepositoryRoot` → `withWriter` → freshness/HEAD guards → replay → record lookup → `runRefactorScan` → planner → append. Reason: the fixture repository has no CodeGraph index, so a live scan there can only report `coverage: unknown` and every daemon-level verdict would be `stale`. With the seam at the measurement boundary, `refactor-verify.test.ts` drives the real production planner and the real ledger over a complete measurement, which is the state an indexed repository is actually in. `refactor-verify.ts` imports no test double.
- **`refactorRecord` already persisted the baseline snapshot.** RF3 landed `baselineSnapshotEvidenceItem` + `baselineEvidenceBinding` inside `planRefactorRecommendationRun` (`packages/core/recommendation-engine/src/index.ts:1391`), and `buildRefactorRecordEvent` already routed them through `payload.evidenceOperations`. The plan's step 8 was therefore already done; `refactor-recording.test.ts` gained an assertion proving it rather than new production code.
- **`derivedOutcomes` is filled at the record site, in `refactor-recording.ts`.** RF3 writes `derivedOutcomes: []` in `recommendation-engine`, which is outside `allowed_paths`. Left alone, every structural observation would be permanently unverifiable (`not_improved` + `no-required-outcome` forever). `buildRefactorRecordEvent` now post-processes the planned records through `deriveObservationOutcomes`. Safe by construction: `recommendationV3FingerprintInput` hashes only `kind` and `affectedNodeIds` for this category, so fingerprints, `recommendationId`s and every dedup decision are untouched — verified by `packages/core/recommendation-engine/test/refactor-recommendation-v3.test.ts` still asserting `derivedOutcomes: []` on the engine's own output.
- **Evidence ids follow RF3's namespaced convention.** The plan wrote `evidence.${digestSuffix(resolutionDigest)}`; the code uses `evidence.refactor_resolution.${suffix}` to match the sibling `evidence.module_statistics_snapshot.${suffix}`.
- **The resolution item's `subject` is the recommendation id.** `queryArchitectureLedgerBookEvidence` matches items on `evidenceId | subject | selector.id`, so this is what makes `book evidence <recommendationId>` return the item as well as the binding.
- **`expectedWorktreeDigest` is optional on verify.** `refactor record` requires it; verify always measures what is at HEAD now, so an absent claim is a verification of the current tree rather than a missing precondition.
- **Contract exit-criteria defect (not fixed here).** `bun packages/surfaces/cli/src/main.ts docs plan --json | jq -e '.data.rejected == [] and ...'` can never pass: `docs plan` never emits a `rejected` key (`packages/surfaces/cli/src/main.ts:1078` turns a non-empty `rejected` into an `AC_PRECONDITION_FAILED` error envelope instead; only `docs drift --json` carries the field). Observed state is correct — `ok: true`, no rejection, and the owned-drift half of the predicate (`[.data.drift.diffs[]? | select(.targetId != null)] | length == 0`) is `true`; the only diff is `docs/architecture/.projection-manifest.json` with `targetId: null`. The contract was not edited.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Re-derive `derivedOutcomes` inside `evaluateResolution` when the payload is empty | Rejected | A silent fallback that re-derives authoritative recorded data; an empty array would stop meaning "no acceptance test". Filled once at the record site instead. |
| Emit three unconditional `create` operations | Rejected | `applyEvidenceItemLifecycleOperation` throws `create-requires-unused-id` on a live id, and the AFTER snapshot digest collides with an already-recorded baseline. Incremental diff instead. |
| Let re-verify dedup on `idempotencyKey` | Rejected | The real store rehashes the submitted event and throws `architecture-ledger-idempotency-conflict` when the timestamp moves. The daemon short-circuits on the recorded `resolutionDigest` instead. |
| Auto-transition status on `partially_resolved` / `regressed` / `stale` | Rejected | PRD S6 pins "status 保持 accepted"; transitioning would make ArchContext the decider rather than the instrument. |
| A sixth disposition or an `undecidable` flag instead of overloading `stale` | Deferred | Requires a `packages/contracts` change, which is in this contract's deny list. Belongs to RF5b. |

## Open Questions

- The ladder's first rung (`beforeSnapshotDigest != payload.baselineSnapshotDigest` -> `stale`) fires today only when the ledger binds a recommendation to a snapshot item other than the baseline its payload names — an evidence-corruption guard. `baselineSnapshotForRecommendation` reports the digest as *bound*, not as the payload claims, so the guard is live rather than tautological; it becomes an ordinary arm once RF5b admits a caller-supplied baseline through `--request-json`.
- `ARCHITECTURE_LEDGER_MAX_PERSISTED_JSON_BYTES` is 262_144. A resolution event carries the verdict plus one full `ModuleStatisticsSnapshotV1`; on a repository with many declared modules this is the first payload budget that will bind. Not reachable with the current fixtures.
- `relations.supersedes` stays deferred (plan decision (d)); a `stale` verdict is not proof of supersession and RF3 already emits the `regressesFrom` inverse.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- `bun test packages/core/refactor-assessment/test/resolution.test.ts` -> 44 pass / 0 fail
- `bun test packages/local-runtime/runtime-daemon/test/refactor-verify.test.ts` -> 15 pass / 0 fail
- `bun test packages/local-runtime/runtime-daemon/test/refactor-recording.test.ts` -> 19 pass / 0 fail
- `bun test --timeout 60000` (whole repo) -> 1716 pass / 0 fail across 169 files
- Budgets after RF4: core 30 files / 19,529 lines (limits 50 / 20,000); local-runtime 14 src files

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.

## Gate fixes (2026-09-03)

- `decodeRuntimeRefactorVerifyInput` now validates `executionEvidenceRefs` fail-closed instead of casting an `Array.isArray` result: each element must be a plain object with exactly `kind` (∈ `REFACTOR_EXECUTION_EVIDENCE_KINDS`), a non-empty `locator`, and a bare `/^[a-f0-9]{64}$/` `sha256`; any extra key is named in the `AC_SCHEMA_INVALID` message and nothing is appended. Elements are rebuilt from the three validated fields, so a caller object never rides through.
- `evaluateResolution` copies refs field-explicitly rather than spreading, closing the same smuggling path for internal callers — the frozen validator only checks `sha256`/`locator`, so keys like `rawDiff` would otherwise have been digest-bound into the ledger against `privacy.rawDiffPersisted: false`.
- Residual: kill-list `path`/`relation` selectorIds have no existence check (a typo is `absent` → satisfied); follow-up with a selector inventory.
- Residual: verify reads tracked files a second time for `afterTrackedFiles`; guarded by the pre-append identity re-check, unify with the scan array in RF5b.
