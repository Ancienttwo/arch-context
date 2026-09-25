# Windows control-file ACL boundary (#171)

Status: first-create child timeout reproduced and corrected; bounded Windows/Node 24 verification passes. Full PR acceptance, historical FG6 and umbrella issues remain open. This does not close #171 or claim a release.

## P1: map

The RPC server publishes connection credentials and a PID lock marker. Daemon discovery, fast-hook discovery, and SQLite state recovery consume those files. They now share the lightweight `@archcontext/local-runtime/control-file-security` module. The installed-bin IPC readback independently observes native ACLs; the FG6 validator accepts only measured Windows evidence. New ownership and three caller relations were applied through ChangeSet, not handwritten model changes.

CLI doctor's general `private` report for state directories/SQLite still has a separate Windows placeholder; it is not a credential authorization path and is not evidence for this repaired boundary. No SQLite storage ACL migration is claimed.

## P2: trace and root cause evidence

- root_cause: daemon-control and fast-hook readers previously returned true on Windows before reading credential JSON; the platform readback reported a constant `win32-acl` label without inspecting permissions.
- repro: `bun test packages/local-runtime/runtime-daemon/test/daemon-control-acl.test.ts` under pinned Bun 1.4.0. The test explicitly simulates Windows with no native ACL authority; before repair discovery returned the fixture credential.
- regression_guard: the same missing-authority regression now rejects the file. Native Windows cases additionally exercise owner-only success, a broad Everyone-read ACE, inherited permissions, CreateNew collisions, and server cleanup ownership. POSIX runs do not exercise those Windows branches.
- pre_fix_failure_artifact: `_ops/remaining-issues/windows-acl-red.log`, exit 1. This is a missing-authority guard, not a native Windows DACL observation.

New write path: RPC builds the payload -> native FileStream CreateNew receives a protected owner-only DACL -> same-handle ACL readback -> write UTF-8 bytes -> publish connection ownership. Paths and content travel on stdin; command arguments contain fixed script code only. A failed CreateNew preserves the existing file and the server releases only its own lock/listener.

New read path: open the file with write/delete sharing denied -> inspect the opened handle's owner and ACL -> read bytes through that same handle -> validate JSON/RPC shape. A missing helper, denied access, malformed result or broad/inherited ACL supplies no credential. State recovery treats unverified permissions as blocked, never as evidence that no daemon exists.

## P3: decision

Use Windows PowerShell 5.1 and its .NET Framework FileStream overload accepting FileSecurity at creation. Creating a broadly accessible empty file and tightening ACLs later would allow another process to open a handle during that window; that design is not used. The policy is one explicit FullControl allow entry for the current user, no inherited entries, a protected DACL and a matching owner. No PowerShell/runtime fallback or permission cache is added.

The daemon lock remains an exclusive-create/PID marker, not an OS advisory lock: its descriptor is used only for lifecycle close. PowerShell creates it privately and Node reopens it read-only. An unverified existing lock is refused rather than interpreted as stale. Existing files are never overwritten; operators must use the normal stop/recovery lifecycle.

At 10x hook frequency, native PowerShell startup is the likely Windows cost; Windows latency is unmeasured. A shared helper is justified by three real consumers and the credential-read invariant. POSIX uses an opened non-symlink descriptor and checks mode before reading.

API authority: [FileStream constructor](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream.-ctor?view=netframework-4.8.1), [Microsoft FileStream source](https://github.com/microsoft/referencesource/blob/main/mscorlib/system/io/filestream.cs), and [FileMode.CreateNew](https://learn.microsoft.com/en-us/dotnet/api/system.io.filemode?view=net-10.0). These support the source design; they do not replace runtime Windows proof.

## Verification and remaining gate

- Final helper/RPC/fast-hook/evidence tests: 19 pass, 1 Windows-only skip, 125 assertions.
- State recovery: 6 pass, 43 assertions.
- Typecheck, package-boundary audit, diff check and packaged CLI smoke pass.
- Installed-bin macOS IPC readback v2 passes: connection/lock modes 600, token redaction and start/status/stop. Its `windowsAcl` is null, explicitly not Windows evidence.
- Read-only boundary review found no confirmed source defect but returned BLOCKED for lack of Windows execution. PowerShell overload binding, actual DACL normalization and Windows handle/lifecycle behavior remain unverified.
- Source fingerprint: `4c50cc6af916d683c8547a51c952335e742432cd0816decefba8bf0689b3cc90`; manifest `_ops/remaining-issues/windows-acl-subject.json`. Logs: `windows-acl-focused-final.log`, `windows-acl-recovery.log`, `windows-acl-packaged.log`, `windows-acl-platform-darwin.json`.
- Self-model receipt: `_ops/remaining-issues/control-security-applied.json`; proposal `sha256:e760f61d412c50aa16c9f01a0ed90597a4c02b2faa5a1a8c944e91ca1c00971f`.

The platform readback moves to v2 with owner/inheritance/rule-count evidence and an installed-bin broad-read rejection check. The historical FG6 record is intentionally NOT rewritten as passing: the new inspector rejects its absent Windows evidence (four findings in `windows-acl-historical-gate.json`). Governance therefore remains blocked until actual Windows artifacts are collected and the evidence record is truthfully updated. There is no legacy-evidence fallback.

Required next verification on actual Windows: run the helper/RPC/fast-hook tests and `node scripts/platform-ipc-permission-readback.mjs` through the installed CLI. Existing Verify CI has Windows Node 22/24/25 jobs. This machine has no Windows VM/runner. After local preparation, the owner authorized committing/pushing the candidate as a Draft PR and running hosted Windows verification. Native results will be recorded after artifact readback; no merge, issue closure or deployment is authorized.

## Hosted attempt 1: actual failures and bounded correction

[Verify run 36105876838](https://github.com/Ancienttwo/arch-context/actions/runs/36105876838) tested PR head `7136c6a81b21b4ceb247a5999bb530de27aa4242` through merge commit `54eee69bac93c3c1cbb9423bbb2d6bf2f807ac2e`. Both have tree `e531dfaaf6ed5a67999dbb65aef7ced028f91d4b`. All six Linux/macOS jobs and downloaded v2 IPC artifacts passed. Governance failed on the four old FG6 Windows evidence findings, with its test suite reporting 2027 pass, 2 skip, 0 fail.

Windows jobs were cancelled at their 20-minute limit; no Windows IPC artifact exists. Node 24 completed its test suite immediately before cancellation: 2024 pass, 5 fail. Three failures came from the broad-read fixture failing to load `Microsoft.PowerShell.Security`; one from an ordinary-write stale connection fixture now rejected as insecure; one from checking connection-file existence after the one-second idle daemon had already exited. Other runs reproduced the module/fixture failures. Logs are retained under `_ops/remaining-issues/ci-36105876838-windows{22,24,25}.log`.

Microsoft documents [PSModulePath inheritance through intermediate processes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath?view=powershell-7.6): a pwsh-launched Node/Bun process passes PS7 module paths to Windows PowerShell, which can select incompatible same-name modules. Fixed scripts now select their own `$PSHOME\Modules` authority; no fallback is added. Native ACL test/readback remains independent of the product predicate.

The stale fixture now uses private creation. Idle proof observes publication during the subprocess lifecycle, then still requires connection/lock deletion and PID exit; its one-second idle setting is unchanged. A missing-file rejection avoids an unnecessary PowerShell launch and cannot authorize any read. Windows-focused tests and installed-bin readback now precede the full suite, preserving actual boundary artifacts even if later checks fail. Native acceptance remains pending the corrected candidate.

Local correction validation: 14 pass, 1 native skip, 97 assertions in ACL/RPC/hook cases; both affected CLI cases pass (10 assertions); typecheck and diff check pass. These are macOS results and do not replace the next Windows execution.

## Hosted attempt 2: focused runner deadline

[Verify run 36107901114](https://github.com/Ancienttwo/arch-context/actions/runs/36107901114), candidate `410af0f8d5c57e8b6377b3308d404d308feeefa8`, passed 14 native cases on each Windows Node target, including private creation, broad-read rejection, inherited-ACL rejection and preservation of pre-existing files. The remaining RPC stale-recovery case was cancelled at exactly the standalone runner's default 5-second timeout on all three targets. No Windows readback ran because that step follows the focused tests.

The focused command now uses `bun test --timeout 60000`, matching the existing `package.json` full-verify runner. No test body, assertion or product deadline changes in this correction. This is repair round 2; native full acceptance remains pending.

## Hosted attempt 3: native boundary passes; whole-job budget is insufficient

[Verify run 36108161898](https://github.com/Ancienttwo/arch-context/actions/runs/36108161898), candidate `61b01b2390c52af0536c5f4643b91e9adaee5968`, passed all 15 native ACL/RPC/hook cases and installed-bin v2 readback on Windows Node 22.22/24/25. All nine readback artifacts were downloaded and validated. A read-only verifier independently matched the three Windows archive digests and remote/local payload bytes to that HEAD, and closed only the missing-native-proof finding. The PR merge commit `6da8683deac783cd41cb809f5ec7f17981a5fbf7` and candidate share tree `7ee79b8717af07202022bff2795322dd6dda379f`.

All six Linux/macOS jobs and Windows/Node 25 completed successfully. Windows/Node 25's full test suite passed 2029 tests in 886.79 s; packaging then needed another 85.59 s. Node 24 passed all 2029 tests in 1022.15 s but hit the 20-minute job cap during post-test verification; Node 22 was cancelled late in the E2E suite without a logged assertion failure. Thus native ACL acceptance passes, while full matrix acceptance is incomplete. Governance still reports exactly the four historical FG6 evidence findings.

Repair round 3 changes only the Windows job wall-clock budget to 30 minutes, keeping other platforms at 20 minutes and all product/test timeouts unchanged. The observed suite plus setup, focused native proof, readback and packaging exceeds the old 20-minute envelope on slower Windows targets. No test is removed or softened. This is the final repair round under the three-round cap; any remaining failure must be reported rather than starting another fix loop.

## Final stop: third repair round exposes native operation failure

[Verify run 36110137854](https://github.com/Ancienttwo/arch-context/actions/runs/36110137854), candidate `7b16ec641893daae7ae8896875d3d2363dd8976a`, failed its Windows/Node 24 focused step: the first `createPrivateControlFile` call threw `Windows native ACL operation failed` after 10024.63 ms. The helper has a 10000 ms subprocess deadline, but its fixed error deliberately suppresses subprocess diagnostics, so timeout/cold-start causality is not proven from this log alone. The other 14 focused cases passed in that job. No further fix or retry was attempted after the three-round cap; the remaining workflow was cancelled to avoid running a matrix already known not to pass.

The prior `61b01b2` native proof and its independent archive verification remain valid historical observations, not current-candidate acceptance. The product/test code is unchanged between that subject and `7b16ec6`; only workflow budget and research/plan records changed. This new intermittent failure therefore remains material. Historical FG6 records were not promoted or marked passing. Source and downloaded payload evidence: `docs/verification/20260925-windows-control-file-acl.json`.

Bounded next slice: capture non-sensitive native child exit code/signal/elapsed-time diagnostics and reproduce the first-create failure on Windows Node 24, then choose an evidence-supported startup/lifecycle correction. Do not blindly raise the product deadline or introduce a permissive fallback. Entry points: `control-file-security/src/index.ts:windowsControlFile`, its existing creation regression, and job `107991495231`. Whole-work-package acceptance, remaining #164/#171 scopes and deferred cloud delivery stay open.

## Approved first-create diagnostic continuation

Owner approved a bounded continuation after the stop. The prior failure's code/status/signal cannot be recovered from the generic recorded error. `windowsControlFile` now reports only operation, allowlisted errno/signal, integer exit status and monotonic elapsed milliseconds. Original errors, command text, paths, input, stdout/stderr and cause are never attached. The 10000 ms native deadline and all permission checks are unchanged.

The existing creation regression logs only its first-create completion flag and elapsed time on Windows. A separate diagnostic workflow runs this same case on three fresh Windows/Node 24 runners, without prewarming. Redundant full Verify runs are cancelled for this diagnostic slice. Passing samples are not treated as proof of the original cause or whole-candidate acceptance.

Local evidence: the new diagnostic regression fails against the prior implementation (exit 1), then both known/unknown metadata privacy guards pass with the candidate; existing control-file test passes on macOS and native inheritance is skipped. Total 3 pass / 1 skip / 22 assertions. Typecheck, package boundaries and diff check pass. Logs: `_ops/remaining-issues/native-diagnostics-red.log` and `native-diagnostics-local.log`.

### Confirmed reproduction and minimal correction

[Diagnostic run 36114666871](https://github.com/Ancienttwo/arch-context/actions/runs/36114666871), subject `86e2e7d0fe7aa5381fe088a69e120f89f0f274c7`, ran the same first-create regression on three fresh Windows/Node 24 runners. Sample 1 failed after 10252 ms with `code=ETIMEDOUT`, `status=null`, `signal=SIGTERM`. Samples 2 and 3 succeeded in 3395 ms and 9885 ms. This confirms that the fixed 10000 ms child deadline can terminate a first creation, with successful execution already observed within 115 ms of that limit. It does not identify the underlying OS/runtime startup cost as antivirus, module-cache initialization or another particular mechanism.

The minimal correction gives native **create** a 30000 ms child budget; reads retain 10000 ms. Daemon startup already permits 150000 ms on Windows (`surfaces/cli/src/main.ts`), so the two private startup writes have a combined child budget of 60000 ms within that existing outer envelope. The creation regression uses the repository's normal 60000 ms test budget. No retry, permission cache, fallback, credential transport or ACL predicate changes. The tradeoff is up to 20 s more waiting on a stuck create, with bounded diagnostic failure; hook/read latency limits remain unchanged.

Validation is bounded to three fresh first-create samples and one installed-bin private ACL/redaction/start/status/stop readback. A nine-platform full rerun is not required to distinguish this reproduced native deadline from the unchanged historical FG6 gate.

### Final bounded verification

[Diagnostic run 36115539255](https://github.com/Ancienttwo/arch-context/actions/runs/36115539255), subject `c6f73359bc2ec5e05355c4d0a2f6a972bec10132`, passed all three fresh-runner creation cases. First-create times were 4437, 5946 and 4428 ms. Each case retained private readback, Unicode roundtrip, CreateNew collision preservation, broad-read rejection and missing-file rejection assertions. These finite samples are not a worst-case latency guarantee.

The installed-bin Windows/Node 24 readback also passed owner/current-user checks, protected inheritance, exactly one explicit FullControl rule for both files, broad-read rejection, token redaction, and daemon start/status/stop. Archive `10855092826` SHA-256 matched GitHub metadata; downloaded payload bytes matched the remote archive. The tested merge commit `6f739c1a12a2601329c00937d5d6b1a1b73376db` and candidate have the same tree `24780643fdbc2edfb898431c78ad4e6823dd2eea`.

Reproduction and post-fix measurements, safe error metadata, artifact hashes and scope are preserved in `docs/verification/20260925-windows-first-create-diagnostics.json`. The first-create deadline defect is resolved within this slice. No claim is made that the particular OS startup subsystem is identified, that read latency changed, or that the full nine-platform Verify/Governance gate passed. Those full workflows were deliberately cancelled for this narrow diagnostic; historical FG6 remains unpromoted.
