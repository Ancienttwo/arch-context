# Issue #226: local projection deadline diagnosis

## P1: map

The runtime completion gate and projection readback reconstruct current architecture proof through the package-local CodeGraph CLI. `codegraph-adapter/src/index.ts` runs the shim using the current executable, with 5/10/120-second version/status/sync limits. In these tests that executable is pinned Bun 1.4.0; the shim then invokes the installed Darwin bundle and its Node runtime. The main readback test has a separate 120-second outer budget. `projection-apply.ts` rebuilds the fixed point under the daemon writer and never changes receipt delivery state merely to read it.

## P2: measured path

1. Source and old failure-log hashes matched the prior acceptance record. Unchanged completion passed under system temp in 6.548s; four version children consumed 5.651s, none failed.
2. The readback test reproduced the outer failure at 120.004s. It recorded 118 CodeGraph calls, 114.411s cumulative child time. The last status call was killed with SIGTERM after 304ms against its own 10000ms limit. This is an outer interruption.
3. A diagnostic-only 240s window with phase markers then failed during shared fixture preparation at 57.067s. Two version calls actually exhausted their 5000ms deadlines at 5022/5008ms; the main RPC readback stage had not begun. The test source was restored byte-for-byte. Increasing only the outer deadline therefore does not solve this issue.
4. A no-CodeGraph control, `bun -e process.stdout.write(...)`, also timed out at 5172ms under a fresh system-temp cwd with no output. Nested timing placed 847ms before Bun preload, while the bundled Node's version path took only 27ms after its preload. Static inspection found the installed-bundle shim/launcher path; no download or graph/index action was needed.
5. Native sampling of the owned minimal Bun process found 719/767 main-thread samples at `__getdirentries64`. The exact internal Bun function and directory set are not established. Empty package/config markers and env/install/tsconfig flags did not remove the warm startup penalty. A paired same-runtime/same-program comparison gave system-temp starts of 793/637ms versus 14/14ms beneath the isolated worktree temp base.
6. With only `TMPDIR` isolated, both original, uninstrumented cases passed: completion 1.367s, readback 28.030s, 79 assertions total in 29.84s. The existing child-deadline negative guard passed too (24.23ms); a child that really exceeds its limit still rejects.

## P3: decision

The demonstrated pressure point is environment-dependent Bun bootstrap directory enumeration before application code; repeated starts amplify this cost into an outer test timeout. Keep production code, runner selection, model/receipt authority, all assertions and all deadlines unchanged. Use task-scoped temporary-directory isolation for local verification and fingerprint `TMPDIR` in the contract. Do not infer a universal Bun defect, blame CodeGraph semantics, delete other temporary state, or turn the old failed aggregate result green.

At 10x process starts the startup cost multiplies even if every individual call passes. The remedy isolates the observed local cost without caching away current proof or weakening the failure boundary. Operator instructions: `docs/runbooks/projection-verification-environment.md`.

## Root Cause Evidence

- root_cause: local system-temp Bun bootstrap spends substantial time enumerating directories before user code; one no-CodeGraph start exceeds 5s, and repeated CodeGraph starts exhaust the outer 120s scenario. Exact native internal function/directory remains unresolved.
- repro: `readback-round1` reproduces the outer timeout; `readback-round2` reproduces child deadlines; `bun-startup-results.json` reproduces a no-CodeGraph 5s failure.
- regression_guard: both original targeted tests under task-scoped `TMPDIR`, plus the existing bounded child-handshake rejection test. No test or production source changed.
- pre_fix_failure_artifact: original full-run hash, both diagnostic failures and minimal startup probes are bound in `docs/verification/20260925-projection-environment-diagnosis.json`.

## Disposition

#226's bounded diagnosis and local verification correction are complete. No full matrix was rerun. The historical full local verification remains failed and hosted source evidence remains bound to its original revision. #225 still blocks formal acceptance of Draft #223; this slice issues no AcceptanceReceipt and performs no merge/release/deployment.
