# CodeGraph handshake recurrence diagnosis

## P1: boundary

`packages/local-runtime/codegraph-adapter/src/index.ts:773` runs the package-local `--version` command with 5s; line 805 selects the 10s status limit; line 809 runs sync with 120s. `runProjectionCodeGraph` at line 917 executes the child synchronously and wraps failures into a generic handshake message. The daemon-owned projection readback reaches this adapter; CLI and MCP share the runtime client in `packages/surfaces/cli/test/cli.test.ts:5037`.

## P2: observations

The original full-gate failure is preserved in `20260927-final-acceptance-checkpoint.json`: parity comparison at test line 5095 receives MCP `AC_PRECONDITION_FAILED` / `ETIMEDOUT`, while CLI readback succeeds. The message does not identify the child arguments or elapsed time. No assertion evidence distinguishes version, status, or sync as the failed command.

Temporary local instrumentation recorded child command, arguments, per-call deadline, elapsed time, result/error code and signal without changing assertions, deadlines or runtime selection. With pinned Bun 1.4.0 and the same isolated TMPDIR, the single parity test passed 61 assertions and 110 child invocations. Running the four immediately preceding projection tests together with parity passed 209 assertions and 407 invocations. All 517 children succeeded; maximum duration was 881.427ms. Source instrumentation was restored byte-for-byte. The original parity test and existing child-deadline rejection test then passed uninstrumented (62 assertions).

These are bounded diagnostic observations, not evidence that the aggregate failure is fixed. Both instrumented runs omitted the rest of the aggregate suite, and instrumentation itself may affect timing. The earlier system-temp/Bun-startup diagnosis cannot explain this occurrence without new causal evidence.

## P3: decision and stop

No product fix, retry, timeout increase or repeated full gate. The root cause and original timed-out subcommand remain unproven after the bounded observations. At increased call volume the same synchronous child boundary remains the pressure point, but no scaling cause was measured here. Keep the failed acceptance result.

The next sufficient slice is bounded failure diagnostics at `runProjectionCodeGraph`: retain the fail-closed error and include the subcommand, deadline, elapsed time and process error code/signal without source bodies or credentials. A later full gate can then produce discriminating evidence on recurrence; repeatedly rerunning the isolated passing test cannot recover the missing original metadata.

## Root Cause Evidence

- root_cause: unproven; the only proven gap is loss of child-command/timing metadata in the generic failure message.
- repro: original full verify failed; two bounded instrumented scenarios and restored-source verification did not reproduce it.
- regression_guard: existing parity and child-deadline rejection tests retained unchanged.
- pre_fix_failure_artifact: prior checkpoint binds the original failed log; `docs/verification/20260927-handshake-diagnosis.json` binds diagnostic traces and source hashes.


## Approved handshake failure diagnostics

P1: the adapter executes package-local version/status/sync children; daemon readback forwards the thrown message in AC_PRECONDITION_FAILED. P2: a child error now retains its original detail and appends JSON containing the fixed subcommand, deadlineMs, monotonic elapsedMs, code, exitCode and signal. No invocation arguments or environment values are added. P3: preserve all deadlines, success output, fail-closed behavior and single-attempt execution; expose existing process facts rather than infer a timeout cause. Additional work occurs only on failure apart from one clock read.

Red proof: two new diagnostic assertions fail on the unchanged adapter. Green: all 16 adapter tests / 74 assertions, typecheck, package boundary audit and diff check pass. Real subprocess tests distinguish ETIMEDOUT, status exit 7 and ENOENT; the status fixture proves only version/status execute, with no retry. Evidence: `docs/verification/20260927-handshake-diagnostics-change.json`.

This completes the approved observability slice. The original aggregate timeout remains unexplained and formal acceptance remains blocked. Previously packed 0.5.12 artifacts do not contain this source change; next acceptance preparation must freeze and rebuild the changed producer before one current-source gate. No full gate, publication, merge or successful AcceptanceReceipt in this slice.
