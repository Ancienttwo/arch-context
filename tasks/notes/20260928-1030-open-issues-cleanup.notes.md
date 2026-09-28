# Implementation Notes: open-issues-cleanup (handoff)

> **Status**: Handoff — cloud session → local agent
> **PRs**: Ancienttwo/arch-context#244, #245, #246 (all draft)
> **Issues**: closes #235, #236, #237, #239, #240; #224 and #238 left open on purpose
> **Last Updated**: 2026-09-28 10:30 UTC
> **Lifecycle**: notes

## PR Map And Merge Order

| PR | Branch | Base | Closes | CI (at handoff) |
|----|--------|------|--------|-----------------|
| #244 | `claude/charming-babbage-7ojsjw` | `main` | #235, #240, #239 | green, mergeable clean, no review threads |
| #245 | `claude/charming-babbage-7ojsjw-237` | `main` | #237 | running |
| #246 | `claude/charming-babbage-7ojsjw-236` | `claude/charming-babbage-7ojsjw` (stacked on #244) | #236 | running |

Merge order: **#244 → #246 → #245**, or #244 → #245 → #246. #246 needs #244 first because it depends on the #235 fix. When #244's branch is merged and deleted, GitHub retargets #246 to `main`.

Commits: #244 has `968a6b8` (#235), `569c2b9` (#240) and `5e5a566` (#239). #245 has `4f87899`. #246 has `801ebc8`. This note is one extra docs commit on #244.

## What Each Change Does

- **#235** `scripts/practice-context7-readback.ts`: the hard-gate scan reads every `runtime-daemon/src/*.ts` file (tests excluded) that declares `checkpoint` / `completeTask`, and throws when it finds no declaration. `countHardGateProviderReferences` is exported and tested. The packet shape is unchanged.
- **#240** `packages/core/module-statistics/src/ownership.ts`: `unownedFileCount` counts an unclaimed file only when both hold:
  - the file is under a top-level directory the model declares source in;
  - no node excludes it.

  Edge cases:
  - A root-spanning glob (`**`, `*.ts`) keeps the whole repo in scope.
  - A literal root file scopes only itself.
  - A model with no declared source keeps the whole repo in scope.

  `byPath` is unchanged, so scope-path ownership is unaffected. On this repo the count drops from 1145 to 5; the remaining 5 are the per-workspace `bunfig.toml` files.
- **#239** `runtime-daemon/src/landscape.ts` (`LandscapeService`): move-only. The four landscape tests moved to `test/landscape.test.ts`.
- **#237** `runtime-daemon/src/explorer-projection-service.ts` (`ExplorerProjectionService`): move-only, with 512 lines byte-identical. The DE1–DE5 readbacks, `explorer-view-compiler-readback.mjs` and `data-engine-source-invariants.test.ts` now read `index.ts` plus the new file. All 31 daemon-source predicates evaluate the same before and after the move.
- **#236** `runtime-daemon/src/practice-checkpoint.ts` (`PracticeCheckpointService`): move-only, with 221 lines byte-identical. `completeTask`, `completeTaskProjectionDrift` and `planPracticeWaiver` stay in the facade. The facade keeps a one-line private `readPracticeCheckpointBaseline` delegate, so `completeTask` and the #237 Explorer port don't change.

## Expected Conflict: #245 × #246 (checked by a trial merge)

Merging the second of the two gives 4 hunks, all in `packages/local-runtime/runtime-daemon/src/index.ts`. They are mechanical: each side added something next to the other's edit, so resolve every hunk by **keeping both sides**.

1. **The imports from `@archcontext/core/context-compiler` and `@archcontext/contracts`.**
   - Take `import { compileTaskContext, type ArchitectureContextLedgerPort }`; `compileLandscapeTaskContext` left with #239.
   - Take #245's trimmed contracts type list: no Explorer and change-feed types, and no `NormalizedCodeContext`.
2. **Constructor.** Keep both the `this.landscapes = new LandscapeService({...})` and the `this.explorerProjections = new ExplorerProjectionService({...})` blocks.
3. **`stop()`.** The result must be:
   ```ts
   this.practiceCheckpoints.clear();
   this.explorerProjections.clearDeferredChangeFeedFailures();
   ```
4. **After `appendArchitectureEventsWithFeed`.** Drop both `processArchitectureChangeFeedAfterCommit` / `processArchitectureChangeFeed` from the facade, since they now live in the #237 service. Also drop `createLandscapeCodeGraphProviders`, which moved with #239.

After resolving:
- run `bun run typecheck` and look for leftover unused imports;
- run `bun test packages/local-runtime/runtime-daemon scripts/data-engine-source-invariants.test.ts scripts/practice-context7-readback.test.ts`;
- then run the full `bun test --timeout 60000`.

A conflict-free merge is not enough on its own. Re-run the DE predicate comparison below, because `index.ts` changes.

## Environment Gotchas (from the cloud session)

- `scripts/check-bun-version.mjs` requires **Bun 1.4.0**. Older Bun aborts `bun test` before any test runs.
- Some CLI tests shell out to `codegraph`. Put `node_modules/.bin` on `PATH`, or 6 tests in `packages/surfaces/cli/test/cli.test.ts` fail with `Executable not found in $PATH: "codegraph"`.
- `verify:architecture-mermaid` needs a working headless browser. It was **not** run in the cloud session. Every other `bun run verify` step passed on all three branches.
- The DE1–DE5 readbacks in `run` mode need the `repo-harness` binary, so the DE evidence packets were **not** re-recorded. Their `inspect` `sourceDigest` goes stale whenever `index.ts` changes; this already happened before these PRs.

## Reproducing The Move-Only Evidence

- **Verbatim move.** Take each moved block from `git show origin/main:packages/local-runtime/runtime-daemon/src/index.ts` (for #236, from #244's head) and assert it appears verbatim in the new file. The only allowed edits:
  - #237: `processArchitectureChangeFeedAfterCommit` loses `private`;
  - #236: `readPracticeCheckpointBaseline` loses `private`.
- **DE predicates.** For each `scripts/data-engine-de{1..5}-readback.ts`, evaluate every literal `daemonSource.includes(...)` / `indexOf(...)`, plus `inspectDataEngine{IndexedBacklinks,RequiredDomains,AuthorityBinding}`, DE3's `invalidationPrecedesExactHit` and the DE5 metric names. Use the old composition (`index.ts`, plus `explorer-server.ts` for DE1 and DE3) and the new composition (which adds `explorer-projection-service.ts`). Expect 31/31 identical.

  Negative control: the three `inspectDataEngine*` checks against the post-move `index.ts` alone return `false`.
- **Context7 scan.** `bun scripts/practice-context7-readback.ts run --out /tmp/c7.json --json`, then check that `hardGateScan` is `{0, 0}` and `assertions.hardGateProviderCallsZero` is `true`. On #246, `checkpoint` is declared in both `index.ts` and `practice-checkpoint.ts`.

## Open Follow-ups

- **`bunfig.toml` ownership gap.** 5 files, now the only `unowned-paths` hits after #240. They need a model ChangeSet, for example adding `packages/<ws>/bunfig.toml` to each module's `source.include`. Don't edit `.archcontext/` by hand.
- **#237 side note, not addressed.** The Explorer "authority changed" live push compares raw and canonical roots (`explorer-server.ts`, `notifyExplorerAuthorityInvalidation`). It is not reproduced, and #245 is deliberately move-only.
- **#240 trade-off.** Resolution's `trackedFilesBindSnapshot` no longer binds tracked files outside the declared roots through `unownedFileCount`. This is documented in `packages/core/refactor-assessment/src/resolution.ts`.
- **#238** (ChangeSet / MCP approval extraction): gated on the committed-change acceptance generalization in `tasks/todos.md`, plus a dual-track security review. The issue also allows keeping this code in the facade permanently; decide explicitly.
- **#224** (durable cloud control plane): needs real deployment and end-to-end evidence. No code work was attempted.

## Monitoring State At Handoff

The cloud session stopped watching #244–#246. It unsubscribed from PR activity and deleted its scheduled check-in, so nothing else pushes to these branches. The local agent owns them from here.
