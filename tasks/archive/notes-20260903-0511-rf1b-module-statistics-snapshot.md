> **Archived**: 2026-09-03 05:11
> **Related Plan**: plans/archive/plan-20260903-0411-rf1b-module-statistics-snapshot.md
> **Outcome**: Completed
> **Lifecycle**: notes
> **Parent Run ID**: run-20260903-0511

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
- **`indexedWorktreeDigest` is bound to the measured tree.** It is emitted only when the producer's
  returned `codeFacts.indexedWorktreeDigest` equals `worktree.worktreeDigest`; otherwise coverage is
  forced to `unknown`, the digest is `null`, and the edges are discarded (see round-2 item 4).
- **Pure synchronous core.** `@archcontext/core` forbids I/O, clocks and child processes, so the
  builder takes a materialized `ModuleStatisticsInputV1`. Git and the code index are read by the two
  thin local-runtime producers. That also makes a snapshot exactly reproducible from a recorded
  input, which is what the resolution ledger needs.

## Cross-Review Round 2 (Codex findings, all in scope)

- **(1) Workspace package imports were dropped.** `resolveImportTarget` only resolves relative
  specifiers, so `@archcontext/*` subpath imports — this repo's main cross-module mechanism — never
  became edges while coverage still said `complete`. `resolveImportTarget` and
  `capabilityImportGraphs` are untouched (RF0 pins them). Instead `repositoryImportPairs` now
  returns the specifier verbatim with `to: null`, `readWorkspacePackages` (git-adapter) reads each
  workspace manifest's `name` + `exports`, and the builder maps `@scope/pkg/sub` through
  `exports["./sub"]`. Resolution lives in core to protect the local-runtime line budget and to keep
  it unit-testable without an index. An export target the commit does not carry stays unresolved:
  an export entry is not evidence that a file exists.
- **(2) Unresolved imports collapsed.** Pairs are keyed by `(filePath, specifier)`, not
  `(filePath, target)`, so three distinct unresolved specifiers from one file are three records and
  `unresolvedImportCount` counts three. The `specifier` field is now part of the edge shape.
- **(3) Internal edges were self-loops.** A same-owner file edge is counted in `internalEdgeCount`
  and is no longer a module-graph edge. The module graph answers "which modules depend on which",
  and a module does not depend on itself. Consequence, deliberately: an intra-module file cycle is
  NOT a module cycle — it produces no one-member component, and an acyclic module with internal
  imports reports `stronglyConnectedComponentId: null` / `cycleCount: 0`. Intra-module cycles are a
  file-granularity fact a module-granularity snapshot cannot honestly report.
- **(4) Edges were not bound to index freshness.** `repositoryImportPairs` now returns
  `availability` and `indexedWorktreeDigest`, derived from `codeGraphIndexAvailable` plus the
  index's own `pendingChanges` status — producer-owned evidence, not a caller assertion. The
  builder's `codeFacts` takes that return. When coverage resolves to `unknown`, the supplied edges
  are ignored entirely (`unresolvedImports` 0 per module, `unresolvedImportCount` 0, `crossModule*`
  0) and `code-facts-missing` is recorded: an index that did not attest to this tree is not weaker
  evidence, it is no evidence.
- **(5) `readTrackedSourceFiles` read worktree bytes.** Line counts now come from the HEAD blobs via
  one `git cat-file --batch`, so a modified-but-uncommitted tracked file does not move the
  measurement and two scans at the same HEAD stay comparable. Fail-closed moved with it: the error
  is now `git-tracked-blob-unreadable: <paths>` for a blob Git cannot hand back. A tracked file
  deleted from the worktree is no longer an error, because the commit still carries its blob.
- **(6) `modelDigest` omitted relations.** It now hashes the whole model (nodes, relations, flows),
  each sorted by id, so a relation change moves the snapshot identity and a reordering does not.
- **(7) Line budget flipped.** local-runtime went from 19,990 to 20,068 lines, crossing the 20k
  bucket boundary. Regenerated through `docs plan --json` (`majorChange.mode: none`, single owned
  diff) then `docs apply --approved --id changeset.docs-rf1b-1`; `docs drift --json` is `ok: true`.
  Only the `規模量級` line plus projection digests changed. No hand edits, no `archctx init`.

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
| Workspace resolution in the adapter vs. in core | Core | Keeps local-runtime inside its line budget and makes resolution testable without an index |
| Stale index: keep edges as partial vs. discard | Discard | Edges from another tree are not weaker evidence, they are evidence about something else |
| Intra-module cycle: one-member SCC vs. not a module cycle | Not a module cycle | A module does not depend on itself; file-granularity cycles need a file-granularity report |

## Open Questions

- PRD §0.3-16 must state explicitly that a `null` `callerCoverage` lowers `confidence.level` rather
  than blocking an assessment, before RF2 starts. No v1 producer can supply a non-null value.
- `module.architecture-context.local-runtime` now measures 20,068 lines in a freshly regenerated
  `20k-50k` bucket, so there is real headroom again and RF5a's wiring will not flip it.
- Workspace specifier resolution reads `exports` only. A deep import that bypasses `exports`
  (`@archcontext/core/projection-engine/src/index`) stays unresolved and is reported as such rather
  than guessed. If RF2 needs those edges, the fix is an explicit resolution rule, not a heuristic.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
