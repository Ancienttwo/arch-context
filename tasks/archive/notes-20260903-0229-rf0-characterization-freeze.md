> **Archived**: 2026-09-03 02:29
> **Related Plan**: plans/archive/plan-20260902-2348-rf0-characterization-freeze.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260903-0229

# Implementation Notes: rf0-characterization-freeze

> **Status**: Active
> **Plan**: plans/plan-20260902-2348-rf0-characterization-freeze.md
> **Contract**: tasks/contracts/20260902-2348-rf0-characterization-freeze.contract.md
> **Review**: tasks/reviews/20260902-2348-rf0-characterization-freeze.review.md
> **Last Updated**: 2026-09-03 00:52
> **Lifecycle**: notes

## Design Decisions

- Fixture shape is `{ id, description, input, expected, digest }` per case, one JSON array per frozen
  function, loaded with `readFileSync` + `JSON.parse` rather than a JSON import so `tsc` keeps the
  fixture opaque. Every case asserts twice: `toEqual(expected)` on the observed payload and
  `digestJson(normalized) === digest`. No regeneration script, no update flag, no mismatch-tolerant
  branch ships; `expected` and `digest` were captured once by throwaway scripts that were deleted.
- `input` is committed data too, not just a seed. The projection-engine and codegraph-adapter cases
  carry the whole synthetic file tree (`input.tree`) as a literal map, so the test materializes the
  exact tree the capture measured and nothing is read from the real repository.
- Volatile fields are dropped by an explicit `normalize()` allow-list, never by a wildcard:
  - `prepareTask` freezes only `confidence`, `posture`, `pressure.{level,score,signalTypes}` and the
    proof-point/intervention branch; the compiled context carries tmpdir-dependent digests.
  - The CodeGraph handshake freezes `Object.keys(handshake).sort()` plus the identity values
    (`schemaVersion`, `packageName`, `requiredVersion` `1.5.0`, `actualVersion`, `availability`,
    `reasonCode`) and reduces `binaryDigest`, `preSyncStatusDigest`, `postSyncStatusDigest`,
    `syncDigest`, `indexedWorktreeDigest`, `graphDigest` to the literal `"sha256"` shape, because
    those hash the absolute project path and the fake binary's bytes.
  - Fixture digest stability was checked by running each capture twice and diffing the emitted JSON:
    `prepare-task.json`, `capability-import-graphs.json`, `normalized-import-edges.json` and
    `projection-handshake.json` were byte-identical across two consecutive runs.
- No `export` was added and nothing under any `src/` was edited. `scaleMagnitudeBucketLabel`
  (`packages/core/projection-engine/src/index.ts:814`) stays private and is frozen through the
  rendered `- 規模量級:` line of `renderArchitectureDocumentationProjection`. The codegraph
  `resolveImportTarget` / `importEdgesFromQueryNodes` / `capabilityImportGraphs` internals stay
  private and are frozen through `loadCapabilityCodeGraphProjectionInputs` and
  `CodeGraphCliProvider.buildContext` driven by the written-to-disk fake CLI.

## Baseline And Result

| Package | Tests before | Tests after |
|---|---|---|
| `packages/core/refactor-decision` | 2 | 33 |
| `packages/core/pressure-engine` | 5 | 25 |
| `packages/core/recommendation-engine` | 9 | 27 |
| `packages/core/projection-engine` | 93 | 129 |
| `packages/core/application` | 11 | 20 |
| `packages/local-runtime/codegraph-adapter` | 21 | 31 |
| **Total** | **141** | **265** |

`bun evals/run.ts --check` was `Verdict: PASS` before and after.

## Causation Control

`docs/verification/rf0-characterization-drift-probe.txt` captures the mandatory perturbation probe:
`score += 15` → `score += 16` at `packages/core/refactor-decision/src/index.ts:21`, one constant,
nothing else touched. Eleven tests failed across two packages (six in the refactor-decision score
table, five in the application `prepareTask` defaults) and the artifact ends with `PROBE_EXIT=1`,
captured by redirection rather than a pipe so the status is real. Every pre-RF0 test stayed green
under the same perturbation, which is exactly the blind spot this freeze closes. The perturbation
was reverted with `git checkout -- packages/core/refactor-decision/src/index.ts` and
`git status --short -- packages | grep '/src/'` is empty.

## Pre-Existing Defects Observed While Freezing (RF1/RF2 input, not fixed here)

**RF1 — `lineCount` is worktree-dependent, not source-of-truth-dependent.**
`loadCapabilitySourceScaleSignals` (`packages/core/projection-engine/src/index.ts:733`) sums
`countFileLines` over whatever `listScaleScanFiles` (`:778`) finds on disk. That walker skips only
`.git/` and `node_modules/` (`SCALE_SCAN_SKIPPED_DIRECTORIES`), so build output, coverage
directories, editor scratch files, and any other untracked or git-ignored file inside a declared
`source.include` prefix is measured as if it were declared source. Two clones at the same commit can
therefore render different `- 規模量級:` buckets, and the bucket a projection stamps depends on the
state of the machine that rendered it. The frozen fixture pins today's behavior over an explicit
synthetic tree (`capability-source-footprints.json`), so RF1's move to the Git-tracked set will show
up as a fixture change rather than as silent drift. Not fixed here.

**RF2 — one dump-wide `truncated` flag is copied into every capability's import graph.**
`codeGraphImportNodes` (`packages/local-runtime/codegraph-adapter/src/index.ts:1026`) computes a
single `truncated` for the whole repository dump (`parsed.length >= limit`), and
`capabilityImportGraphs` (`:1017`) then writes that same boolean into every node's graph. A
capability whose footprint contributed zero import edges is still reported as truncated: the frozen
`saturated-dump-copies-truncated-into-every-graph` case shows `capability.lib` with `edges: []` and
`truncated: true`. Consumers reading `truncated` per node cannot tell "this capability's edges may be
incomplete" from "some other capability's dump saturated". Not fixed here.

## Deviations From Plan Or Spec

- The plan's file table listed fixtures for five packages plus `packages/core/application`; all six
  were delivered. One extra fixture file (`scale-magnitude-rejections.json`) was added beyond the
  table so the bucket's `not-a-count` refusal is frozen next to the bucket ladder itself.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Export `scaleMagnitudeBucketLabel` to test it directly vs. drive it through the renderer | Renderer | The contract forbids new exports; the rendered `- 規模量級:` line reaches every branch of the bucket function, including its three rejection paths, so the private symbol needs no widening. |
| Ship a fixture regeneration script vs. one-shot throwaway capture | Throwaway | A shipped regenerator makes the fixture self-fulfilling: any future drift can be rewritten into the baseline in one command, which is exactly the failure mode RF0 exists to prevent. |
| Freeze whole `prepareTask` result vs. an allow-list | Allow-list | The compiled context carries tmpdir-dependent digests; a whole-object freeze would be flaky, and a wildcard scrub would quietly drop real fields. |
| Freeze the handshake digest values vs. their shapes | Shapes | `preSyncStatusDigest` and friends hash the absolute project path, so their values are machine-dependent; the field list plus `requiredVersion` `1.5.0` is the part that must not drift. |

## Open Questions

- **`verify-contract --strict` reports `status=Partial` for a contract-authoring reason, not a delivery
  gap.** All 7 `files_exist`, both `artifacts_exist` and all 7 `commands_succeed` criteria pass; the
  six `exit_criteria.tests_pass` entries fail as `tests_pass package scripts.test is missing: <path>`.
  `tests_pass` resolution walks up from the test file to the nearest `package.json`, which in this
  repo is a workspace grouping manifest (`packages/core`, `packages/local-runtime`) with no
  `scripts` at all. This is the exact failure recorded in `tasks/lessons.md` under
  "2026-09-02 — Contract template gaps stall the completion gate at the last mile", whose prevention
  rule is: express test files as `commands_succeed: bun test <paths>` rather than `tests_pass`.
  Precedent: `tasks/archive/contract-20260902-1414-audit-issue-batch-108-117.md:154`.
  The six files are already asserted green by the existing
  `commands_succeed: bun test <six packages> --timeout 60000` criterion. Changing acceptance criteria
  is not an execution call, so the `tests_pass` block was left exactly as authored; the contract owner
  decides whether to re-encode it as six per-file `commands_succeed` entries.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
