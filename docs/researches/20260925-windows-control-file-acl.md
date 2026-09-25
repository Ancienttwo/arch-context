# Windows control-file ACL boundary (#171)

Status: implemented and locally verified; native Windows acceptance is pending. This does not close #171 or claim a release.

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
