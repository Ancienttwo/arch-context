# AL6 Provider Adapters and Run Metadata Verification

Date: 2026-06-26

## Scope

This closes AL6-11 through AL6-14 for the architecture ledger sprint.

Implemented behavior:

- Claude Code adapter behind `InvestigationRunnerPort`.
- Codex adapter behind the same port.
- Command transport boundary with bounded JSON stdin and typed `InvestigationReport/v1` output.
- Provider run metadata containing provider, model ID, prompt-template digest, input digest, output digest, duration, outcome, attempts, timeout and fallback state.
- Runtime completion persistence of run metadata under `job.extensions.agentRun`.
- Timeout, bounded retry and deterministic advisory-only fallback output.

Out of scope:

- AL6-15 CLI commands: `archctx investigate`, `archctx agents status`, `archctx agents budget`.
- Full AL6-16 fixture matrix closure: duplicate-result fixture remains open.

## Architecture Boundary

`@archcontext/core/agent-orchestrator` owns provider-neutral execution.

`createClaudeCodeInvestigationRunner` and `createCodexInvestigationRunner` are adapter factories over the existing `InvestigationRunnerPort`; they do not change domain eligibility, job state transitions, report validation or ChangeSet authority.

`runInvestigationThroughPort` remains the primitive single-run validator. `runInvestigationWithRetry` wraps it with timeout, bounded retry and fallback behavior.

`@archcontext/local-runtime/runtime-daemon` accepts completed run metadata through `jobs.complete`.

`@archcontext/local-runtime/local-store-sqlite` persists metadata with the runtime queue job JSON only. It does not append architecture ledger events and does not promote agent output to authority.

## Concrete Trace

1. Runtime enqueue creates an `AgentJob/v1` with `runnerPort`, `inputDigest` and `promptTemplateDigest`.
2. A worker claims the job through `jobs.claim`, moving it to `running`.
3. The runner adapter receives bounded JSON stdin containing job identity, digests and bounded context references.
4. Provider command output is parsed as JSON and validated as `InvestigationReport/v1`.
5. `runInvestigationWithRetry` returns `{ report, metadata }`.
6. `jobs.complete` persists `outputDigest` and `runMetadata`.
7. Job readback returns metadata at `job.extensions.agentRun`.

Error route:

1. Provider timeout aborts the run attempt.
2. Attempts continue until `maxAttempts` is exhausted.
3. The orchestrator returns a failed advisory-only fallback report.
4. Metadata records `outcome: "timeout"`, attempt count, timeout and error digest.
5. No raw source, diff, stdout, stderr, prompt or completion body is stored.

## Design Rationale

The implementation keeps provider-specific command behavior outside the domain model. The stable boundary remains:

- Domain: spawn policy, state machine, context bounding, report validation.
- Adapter: command, args, transport, model label.
- Runtime store: operational job status and run metadata.
- Ledger authority: unchanged; only ChangeSet or daemon-owned event append can mutate architecture state.

The tradeoff is that CLI ergonomics are still unfinished. This is intentional because AL6-15 is a separate surface-area task; the reusable runner primitive is now in place first.

At 10x job volume, the first pressure point is queue visibility and budget control, not report validation. That is why AL6-15 remains the next AL6 bottleneck.

## Verification

Passed:

```bash
bun test packages/core/agent-orchestrator/test/agent-orchestrator.test.ts --timeout 90000
bun test packages/local-runtime/runtime-daemon/test/local-runtime.test.ts --timeout 90000
bun test packages/local-runtime/local-store-sqlite/test/local-store-sqlite.test.ts --timeout 90000
bun run typecheck
node scripts/package-boundary-audit.mjs
node scripts/sprint-status-check.mjs
git diff --check
bun test --timeout 90000
ARCHCONTEXT_STATE_DIR=$(mktemp -d /tmp/archctx-al6-provider-adapters-verify-state-XXXXXX) bun run verify
```

Focused coverage:

- Claude and Codex adapters share the same provider-neutral port.
- Adapter stdin includes digests and bounded context, not source or diff bodies.
- Malformed command output is rejected before report validation.
- Timeout retries return deterministic failed advisory output.
- Run metadata persists through runtime completion and readback.
- Root verification passed through packaged CLI smoke, privacy/readback gates, acceptance ledgers, sprint status and representative eval.
