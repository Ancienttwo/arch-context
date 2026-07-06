# Practice Assets S3 Checkpoint Gate

> Status: local implementation evidence captured; PR #15 submitted; hook adapter follow-up captured on `codex/practice-hook-adapter`; checkpoint hardening captured on `codex/practice-checkpoint-hardening`; CodeGraph import-edge follow-up captured on `codex/practice-codegraph-edge-context`; hook egress audit captured on `codex/practice-hook-egress-audit`.
> Scope: S3 incremental checkpoint and hook integration vertical slice.
> Branch stack: `codex/practice-checkpoint-hooks` -> `codex/practice-hook-adapter` -> `codex/practice-checkpoint-hardening` -> `codex/practice-codegraph-edge-context` -> `codex/practice-hook-egress-audit`

## Implementation Boundary

S3 adds a daemon-owned checkpoint loop for practice guidance. It does not add complete-stage enforcement, policy waivers, Context7, or network-backed documentation.

Implemented surfaces:

- Contract: `archcontext.practice-checkpoint/v1` schema, fixture, and TypeScript result types.
- Core: `checkpointTask` compiles current context, binds head/worktree/catalog/context/practice guidance digests, and computes practice delta.
- Runtime daemon: `prepare` records a task-session practice baseline; `checkpoint` syncs changed-path hints, evaluates current guidance, returns delta, persists the next baseline, and restores the baseline after daemon restart.
- CodeFacts: checkpoint-scoped changed paths are passed into `buildTaskContext`; the CodeGraph CLI adapter performs a separate `query -k import` over normalized changed paths and synthesizes file-level `imports` edges without reading CodeGraph internal storage.
- RPC: runtime client/server dispatch includes `checkpoint`.
- CLI: `archctx checkpoint` and `archctx hook checkpoint --event post-edit --path ...` call the daemon. Hook failure is fail-open and local-only.
- CLI hook adapter: `archctx hooks install/status/remove --host codex|claude|generic` emits a central-first `repo-harness-hook` adapter contract and manual host configuration example; it does not write host config or vendor hook runtime into this repository.
- Hook log contract: `archctx hook checkpoint` attaches `archcontext.hook-log/v1` with schema version, event, elapsed time, path count, changed-path digest, reason code, fail-open, egress, and network fields only. The checkpoint result also includes an aggregate `hook.pathSummary` for source/generated/ignored/binary/deleted/rename-hint counts without path bodies.
- MCP: `archcontext_checkpoint` returns delta rather than the old placeholder error.
- Skills: first-party skills describe prepare/checkpoint/complete SOP and checkpoint delta interpretation only; runtime packages own practice matching and checker behavior.

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
node scripts/practice-hook-egress-readback.mjs readback --evidence docs/verification/practice-hook-egress-readback.json --json
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

Hook adapter follow-up readbacks:

- CLI focused suite: 18 pass / 0 fail / 338 expects.
- Full verification after hook adapter follow-up: 605 pass / 0 fail / 3653 expects.
- `archctx hooks install/status/remove` returns `archcontext.hook-adapter/v1`, names `repo-harness-hook`, keeps `writes = manual-host-config`, and keeps `repoLocalRuntime = not-vendored`.
- Hook checkpoint success and fail-open payloads include `archcontext.hook-log/v1`; tests assert the log contains a changed-path digest, declares forbidden network, and does not contain the raw changed path.
- First-party skills are covered by a regression test that rejects embedded practice IDs, candidate terms, structural predicates, or practice matcher names in skill prose.

Checkpoint hardening follow-up readbacks:

- Focused contract/core/runtime/local-product suite: 151 pass / 0 fail / 718 expects.
- Local product E2E: 4 pass / 0 fail / 73 expects.
- CLI focused suite: 18 pass / 0 fail / 339 expects.
- Core application checkpoint suite: 11 pass / 0 fail / 39 expects.
- Runtime daemon checkpoint suite: 22 pass / 0 fail / 206 expects.
- Typecheck: `tsc --noEmit`.
- Full verification after checkpoint hardening: 608 pass / 0 fail / 3677 expects; packaged CLI smoke, privacy audits, acceptance ledger, sprint-status check, and representative eval gates PASS.
- Path classification matrix covers source, generated, ignored, binary, deleted, and rename-hint counts, and asserts the summary omits raw path bodies.
- Runtime daemon restart test reuses persisted task state and restores the prior practice checkpoint baseline before the next checkpoint.
- Installed `archctx hook checkpoint` E2E covers prepare -> edit compatibility path -> upgraded practice delta -> revert -> downgraded practice delta through a separate CLI process and loopback daemon.

CodeGraph import-edge follow-up readbacks:

- Typecheck: `tsc --noEmit`.
- CodeGraph adapter focused suite: 5 pass / 0 fail / 22 expects.
- Context compiler focused suite: 3 pass / 0 fail / 23 expects.
- Core application checkpoint suite: 11 pass / 0 fail / 39 expects.
- Practice engine focused suite: 14 pass / 0 fail / 69 expects.
- Local product E2E: 5 pass / 0 fail / 82 expects.
- Full verification after CodeGraph import-edge follow-up: 610 pass / 0 fail / 3693 expects; packaged CLI smoke, privacy audits, acceptance ledger, sprint-status check, and representative eval gates PASS.
- Real installed `archctx hook checkpoint` E2E covers prepare without dependency-direction guidance -> edit `src/web/page.ts` with `../domain/order-service` import -> checkpoint added `modularity.respect-dependency-direction` with `import-edge` evidence `file:src/web/page.ts->file:src/domain/order-service.ts`.

Hook egress audit follow-up readbacks:

- Hook egress readback: `node scripts/practice-hook-egress-readback.mjs readback --evidence docs/verification/practice-hook-egress-readback.json --json` returns `ok = true`, `totalRequests = 0`, DLP `ok = true`, and 115 checked values.
- Hook egress readback focused suite: 5 pass / 0 fail / 10 expects.
- Typecheck: `tsc --noEmit`.
- Sprint status check: `STRUCTURE AND EVIDENCE CLAIMS OK`.
- Full verification after hook egress audit: 615 pass / 0 fail / 3703 expects; packaged CLI smoke, privacy audits, acceptance ledger, sprint-status check, hook egress readback, and representative eval gates PASS.

## Gate Evidence

- S3-EG1: Hook checkpoint path is implemented through local CLI -> loopback daemon RPC only; result declares `hook.egress = "none"` and `hook.network = "forbidden"`. Hook fail-open payload also declares `egress = "none"` and `network = "forbidden"`. Hook adapter output declares `entrypoint.egress = "none"` and `entrypoint.network = "forbidden"`. `docs/verification/practice-hook-egress-readback.json` plus `scripts/practice-hook-egress-readback.mjs` independently prove packet capture `totalRequests = 0`, zero network entries, no raw changed path body, and no source/diff/token payload through the shared capture DLP audit.
- S3-EG2: Captured benchmark evidence records cold/warm/coalesced p95 under the S3 limits for a local temporary repository.
- S3-EG3: Daemon checkpoint coalescing returns cached checkpoint data for duplicate same-worktree events and marks `hook.coalesced = true`, `hook.skippedAnalysis = true`.
- S3-EG4: `archctx hook checkpoint` catches runtime errors and returns a fail-open `archcontext.hook-checkpoint-fail-open/v1` payload.
- S3-EG5: Core tests cover prepare -> edit introduces observed cycle -> checkpoint added `modularity.no-new-cycle` -> revert -> checkpoint removed `modularity.no-new-cycle`. Runtime/MCP tests cover prepare -> checkpoint no-op delta in a shared daemon session. Local product E2E covers installed `archctx hook checkpoint` prepare -> edit compatibility path -> upgraded delta -> revert -> downgraded delta, plus prepare -> edit real cross-layer import -> added `modularity.respect-dependency-direction` with `import-edge` evidence.
- S3-EG6: No repository hook runtime is added. The hook entrypoint is `archctx hook checkpoint`, and `archctx hooks install/status/remove` outputs central-first `repo-harness-hook` config without requiring `hook_source = repo`.

## Known Limits

- No open S3 exit-gate limit remains in this evidence file after the hook egress audit follow-up.
