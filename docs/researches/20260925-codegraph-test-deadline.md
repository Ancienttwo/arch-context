# CodeGraph projection test deadline diagnosis

Scope: the two projection/recovery failures observed during the remaining audit issues work. The owner approved this bounded continuation after the AGENTS stop boundary.

## P1: map

Bun owns each test's overall deadline. Projection orchestration in `runtime-daemon/src/projection-service.ts` calls `prepareArchitectureDocumentationProjectionSnapshot`; the CodeGraph adapter invokes the package-local CLI and independently limits version/status/sync commands to 5/10/120 seconds. These production limits and the freshness, identity, receipt and writer checks remain authoritative.

## P2: concrete trace

The recovery scenario creates and indexes a fixture, adopts and applies documentation, then exercises accepted mutation, semantic/flow/output drift, forged requests, corrupt receipt, writer-race rejection and successful/idempotent recovery. Every proof may execute real CodeGraph version/status/sync calls. The original test has a 30-second total budget on macOS/Linux. An unchanged isolated run failed at 30.035 seconds, this time during `status` instead of the earlier `--version`.

A disposable copy changed only that overall budget to 120 seconds. With subprocess timing instrumentation it passed all 43 original assertions in 64.881 seconds. All 71 CodeGraph calls succeeded; cumulative command time was 61.279 seconds and the longest was 3.335 seconds. No individual command exhausted its own timeout.

The unchanged CLI adoption scenario independently failed at 30.025 seconds. Its last `status` command began at elapsed 29.919 seconds and was killed with SIGTERM after 389 ms, despite a 10,000 ms command timeout. The resulting adapter error says handshake failed, but the controlling cause is the expired outer test deadline.

Evidence: `_ops/remaining-issues/recovery-isolated.log`, `recovery-diagnostic.log`, `recovery-trace.jsonl`, `adopt-isolated.log`, `adopt-trace.jsonl`. The diagnostic preload records method, elapsed time, deadline and exit signal only; it is not part of product code.

## P3: decision

Use the existing 120-second macOS/Linux real-CodeGraph projection test budget for these two scenarios; keep the existing 240-second Windows budget. Limit the recovery-file change to its real-index scenario; retain the other test's current deadline. Do not change product timeouts, replace real CodeGraph with mocks, cache authority proofs, or weaken assertions. The pressure point is repeated CLI startup and proof reconstruction within one integration scenario; multiplying scenarios increases aggregate test time. This bounded timeout correction does not make a runtime performance claim.

## Verification

Pinned Bun 1.4.0, normal runner without diagnostic instrumentation:

```sh
bun test tests/ownership-change-acceptance-recovery.test.ts packages/surfaces/cli/test/cli.test.ts --test-name-pattern 'semantic recovery|projection adopt composes ownership adoption'
```

Result: 3 pass, 0 fail, 68 assertions; 122.45 seconds total. Recovery took 66.357 seconds, the adjacent unavailable-proof negative case 9.380 seconds, and CLI adoption 46.279 seconds. Both repaired scenarios exceed the old 30-second budget while preserving all assertions. A source comparison against HEAD confirmed that only the two timeout selections and the recovery timeout declaration/comment changed. `git diff --check` passes.

Artifacts: `_ops/remaining-issues/codegraph-deadline-fixed.log` and `codegraph-deadline-subject.json`. Earlier full verification remains interrupted/failed and is not replaced by a full-suite PASS claim. Windows was not executed; its existing 240-second deadline is unchanged.
