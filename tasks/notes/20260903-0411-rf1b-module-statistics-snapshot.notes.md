# Implementation Notes: rf1b-module-statistics-snapshot

> **Status**: Active
> **Plan**: plans/plan-20260903-0411-rf1b-module-statistics-snapshot.md
> **Contract**: tasks/contracts/20260903-0411-rf1b-module-statistics-snapshot.contract.md
> **Review**: tasks/reviews/20260903-0411-rf1b-module-statistics-snapshot.review.md
> **Last Updated**: 2026-09-03 04:17
> **Lifecycle**: notes

## Design Decisions

- **(e) `tests.callerCoverage` is always `null` in v1, and RF2 must not treat it as essential evidence.**
  `schemas/repo/architecture-node.schema.json` declares `source` with `additionalProperties: false`
  and only `include` / `exclude` / `entrypoints`, so a node cannot declare a test footprint: there is
  nothing to measure `testFileCount` or `observedTestEdges` against. `callerCoverage` is a different
  problem: it is the share of a module's inbound call boundary that was resolved, and import edges
  cannot observe dynamic invocation (reflection, registry lookup, DI container, string-keyed
  dispatch). A ratio computed from import edges alone would claim a boundary was fully resolved
  whenever the unresolved part happened to be dynamic, which is exactly the failure mode the PRD
  wants surfaced. So v1 emits `dynamicInvocation: "unknown"` and `callerCoverage: null`, with the
  `caller-coverage-unknown` reason code on every snapshot. **PRD clarification needed before RF2
  starts**: §0.3-16 must state that a null `callerCoverage` lowers `confidence.level` and never
  blocks an assessment, otherwise every RF2 assessment in 0.5.0 stalls on evidence that no v1
  producer can supply.
- **Contract correction rationale.** `moduleStatisticsInvariantIssues` required
  `tests.callerCoverage` to be null whenever `coverageStatus` was `unknown`. The two fields measure
  different things: `coverageStatus` is about observed test evidence, `callerCoverage` is a
  graph-boundary resolution ratio. A future producer that resolves the call boundary through the
  index while observing no tests at all is a legal, useful measurement, and the coupled rule would
  have rejected it. The rule and its doc are removed; the 0-1 ratio bound still applies under every
  `coverageStatus`, and `packages/contracts/test/refactor-contracts.test.ts` now pins both halves
  (non-null ratio accepted under `unknown`, out-of-range still rejected). No shape change, no other
  frozen rule touched.
- **Ownership: own resolver, not `resolveArchitectureOwnerForPath`.** That function implements the
  ADR-0043 tie-break for `archctx resolve --path` (longest literal glob prefix wins, equal
  specificity is rejected), which contradicts the PRD's structural rule. `resolveOwnership` applies
  `source.exclude` first, then: candidates on one `parent` chain resolve to the deepest node; a
  candidate set that is not one chain is a real modeling conflict, so every claimant keeps the file,
  every claimant reports `ambiguousOwnership: true`, and the file counts once in
  `multiplyOwnedFileCount`. Attributing a contested file to one arbitrary winner would hide the
  conflict the PRD exists to surface.
- **`cycleCount` is not simple-cycle enumeration.** It counts the module's own out-edges (self-loop
  included) that stay inside its own Tarjan component. Enumerating simple cycles is exponential in
  the component size; a repository-wide scan cannot ship an answer that may never terminate. The
  component id (`scc.<16 hex>`) is derived from the sorted member set, so it is stable under node
  ordering. `instability` and `directionViolationCount` stay `null` (out of scope, P1).
- **`dependencyGraph` is `null`, not zero-filled, when nothing was measured** — for every module
  when coverage is `unknown`, and for a node that declared no footprint. A zero-filled graph would
  claim an observation that did not happen.
- **`indexedWorktreeDigest` is bound to the measured tree.** It is emitted only when the input's
  `indexFreshForWorktreeDigest` equals `worktree.worktreeDigest`; otherwise coverage is forced to
  `unknown` and the digest is `null`. The handshake's own `indexedWorktreeDigest` and
  `CodeFactsSnapshot.workspaceDigest` are different domains and are deliberately not reused.
- **Pure synchronous core.** `@archcontext/core` forbids I/O, clocks and child processes, so the
  builder takes a materialized `ModuleStatisticsInputV1`. Git and the code index are read by the two
  thin local-runtime producers. That also makes a snapshot exactly reproducible from a recorded
  input, which is what the resolution ledger needs.

## Deviations From Plan Or Spec

- **`readTrackedSourceFiles` signature.** The plan wrote `readTrackedSourceFiles(root, includeGlobs?)`;
  the shipped signature is `readTrackedSourceFiles(root, { include?: string[] })` per the brief.
- **`repositoryImportPairs` does not refactor `capabilityImportGraphs`.** The plan said "extracts the
  existing pairs/truncated computation". The two producers share `codeGraphImportNodes` only:
  `capabilityImportGraphs` keeps its resolved-only edge set because the RF0 capability-projection
  fixtures pin that output byte for byte, and widening it to unresolved specifiers would change it.
- **`packages/core/module-statistics/test/factories.ts`** was added alongside the three required test
  files to hold the shared synthetic model; it is inside the allowed path and excluded from the core
  scale scan (`packages/core/**/test/**`).
- **`docs plan --json` zero-owned-drift criterion.** The clean tree at `main 144b975` already reports
  one owned diff, `projection_target.entity.module-architecture-context-contracts`
  (`projection-generated-region-stale`, from PR #129 flipping the contracts module's scale bucket),
  plus a `projection-manifest-stale` entry with a null `targetId`. That baseline was captured before
  any edit in this worktree and is being settled on `main` separately. This change adds **no new
  owned diffs**: the drift list after the change is byte-identical to the baseline. The contract's
  literal criterion still fails on the pre-existing entry; it was not edited.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Contested file: pick a winner vs. keep every claimant | Keep every claimant, flag all | Arbitrating a non-ancestor overlap hides the modeling conflict the snapshot exists to report |
| Graph keys: joined strings vs. nested maps | Nested maps | Node ids and repo paths are free-form; a delimiter collision would silently merge two distinct edges |
| Tarjan: recursive vs. iterative | Iterative | A repository-sized component would overflow the stack, and the builder must not fail on a model that is merely large |
| `cycleCount`: simple cycles vs. in-component out-edges | In-component out-edges | Simple-cycle enumeration is exponential; a scan cannot ship a possibly non-terminating answer |
| Undeclared node: zero-filled graph vs. `null` | `null` | Zeros would claim an observation that never happened |

## Open Questions

- PRD §0.3-16 must state explicitly that a `null` `callerCoverage` lowers `confidence.level` rather
  than blocking an assessment, before RF2 starts. No v1 producer can supply a non-null value.
- `module.architecture-context.local-runtime` now measures 19,995 lines against a `10k-20k` bucket:
  five lines of headroom. The next additive change to that module flips the bucket and will report
  owned drift in `docs plan`. RF5a should budget for a projection refresh, not treat it as a
  regression.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
