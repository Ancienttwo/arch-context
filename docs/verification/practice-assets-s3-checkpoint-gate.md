# Practice Assets S3 Checkpoint Gate

> Status: local implementation evidence captured; PR #15 submitted.
> Scope: S3 incremental checkpoint and hook integration vertical slice.
> Branch: `codex/practice-checkpoint-hooks`

## Implementation Boundary

S3 adds a daemon-owned checkpoint loop for practice guidance. It does not add complete-stage enforcement, policy waivers, Context7, or network-backed documentation.

Implemented surfaces:

- Contract: `archcontext.practice-checkpoint/v1` schema, fixture, and TypeScript result types.
- Core: `checkpointTask` compiles current context, binds head/worktree/catalog/context/practice guidance digests, and computes practice delta.
- Runtime daemon: `prepare` records a task-session practice baseline; `checkpoint` syncs changed-path hints, evaluates current guidance, returns delta, and updates the baseline.
- RPC: runtime client/server dispatch includes `checkpoint`.
- CLI: `archctx checkpoint` and `archctx hook checkpoint --event post-edit --path ...` call the daemon. Hook failure is fail-open and local-only.
- MCP: `archcontext_checkpoint` returns delta rather than the old placeholder error.

## Data Flow Readback

```text
prepare task
  -> daemon prepare(root, task, taskSessionId)
  -> compileTaskContext
  -> practiceGuidance snapshot saved in daemon session

post-edit hook / manual checkpoint
  -> CLI/MCP forwards event + changedPaths only
  -> daemon checkpoint(root, input)
  -> CodeFacts sync(changedPaths)
  -> compileTaskContext
  -> practice delta = previous matches vs current matches
  -> checkpoint result with digests + noOpDigest + resultDigest
```

Changed paths are hints only. The daemon owns workspace binding, worktree digest, CodeFacts sync, catalog digest, and context digest.

## Verified Commands

```bash
bun run typecheck
bun test packages/contracts/test/contracts.test.ts packages/core/application/test/control-loop.test.ts
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
bun test packages/surfaces/cli/test/cli.test.ts packages/surfaces/mcp-local/test/mcp-local.test.ts
bun test packages/surfaces/cli/test/local-product-e2e.test.ts
bun scripts/practice-checkpoint-benchmark.ts run --json
bun run verify
```

Readbacks captured during implementation:

- Contracts + application: 117 pass / 0 fail.
- Runtime daemon: 18 pass / 0 fail.
- CLI + MCP: 26 pass / 0 fail.
- Local product E2E: 3 pass / 0 fail.
- Focused S3 suite: 164 pass / 0 fail / 975 expects.
- Full verification: 579 pass / 0 fail / 3457 expects.
- Representative eval gates: drift precision, constraint recall, Chinese Jieba, practice Top-3 recall, benign negatives, and target/migration invariant all PASS.

Hardening readbacks captured after PR #15 creation:

- Core application checkpoint suite: 10 pass / 0 fail / 36 expects.
- Runtime daemon checkpoint suite: 19 pass / 0 fail / 179 expects.
- Focused S3 suite after hardening: 166 pass / 0 fail / 990 expects.
- Full verification after hardening: 581 pass / 0 fail / 3472 expects.
- Benchmark fixture: darwin-arm64, Node v24.3.0, Bun 1.3.10, 4-file temporary repository, mock CodeGraph provider.
- Benchmark p95: cold 31.086ms <= 750ms, warm 29.416ms <= 250ms, coalesced 16.843ms <= 50ms.
- Coalesce readback: 10 repeated post-edit events for the same tool call/path set reuse one checkpoint result digest; runtime test asserts CodeFacts sync/build counts do not increase after the first analysis.
- Windows CI repair readback: developer-review temporary worktree/run-root cleanup now uses retrying removal for `EBUSY`/locked-path cleanup; focused CLI suite is 16 pass / 0 fail / 275 expects, git-adapter + runtime-daemon suite is 23 pass / 0 fail / 206 expects.
- Full verification after CI repair: 581 pass / 0 fail / 3472 expects.

## Gate Evidence

- S3-EG1: Hook checkpoint path is implemented through local CLI -> loopback daemon RPC only; result declares `hook.egress = "none"` and `hook.network = "forbidden"`.
- S3-EG2: `scripts/practice-checkpoint-benchmark.ts` records cold/warm/coalesced p95 under the S3 limits for a local temporary repository.
- S3-EG3: Daemon checkpoint coalescing returns cached checkpoint data for duplicate same-worktree events and marks `hook.coalesced = true`, `hook.skippedAnalysis = true`.
- S3-EG4: `archctx hook checkpoint` catches runtime errors and returns a fail-open `archcontext.hook-checkpoint-fail-open/v1` payload.
- S3-EG5: Core tests cover prepare -> edit introduces observed cycle -> checkpoint added `modularity.no-new-cycle` -> revert -> checkpoint removed `modularity.no-new-cycle`. Runtime/MCP tests cover prepare -> checkpoint no-op delta in a shared daemon session. Local product E2E covers installed CLI prepare -> checkpoint.
- S3-EG6: No repository hook runtime is added. The hook entrypoint is `archctx hook checkpoint`, preserving central-first hook ownership.

## Known Limits

- Rename/delete/generated/binary path classification is not yet a separate deterministic matrix; this slice covers normalization, de-dupe, absolute path rejection, and parent traversal rejection.
- Checkpoint state is daemon-session scoped; persistent task-state recovery across daemon restart remains deferred.
- `hooks install/status/remove` is not expanded in this slice; existing host config surfaces remain read-only/config output.
