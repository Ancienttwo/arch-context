# Windows CI flakes on 2026-10-11/12

Status: three Windows failures and one local timeout are diagnosed. One is a real race in the daemon idle exit. The other three are deadlines against measured cold-start or load costs.

## Evidence sources

- Failing jobs: 114652943303 (idle exit), 114517569425 (projection handshake), 114527733153 (first native create).
- History: Windows job logs of the last 100 Verify runs (2026-09-30 to 2026-10-12), 327 job logs.
- Probe runs on a temporary branch: 38204097359, 38205449500 and 38205509409. The probe branch is not for merge.

## 1. Idle exit races a private read (real race)

P1: `ArchctxRuntimeRpcServer.checkIdleAndMaybeExit` removes `archctxd.json`, then stops the daemon. `readPrivateControlFile` on Windows opens the file with `FileShare.Read`, so delete sharing is denied while a reader holds it. Each CLI command reads the connection file, and `daemon start` reads it twice while it waits for ready.

P2: when the idle timer fires during such a read, `rmSync` throws `EBUSY`. The throw happens before the `try`, so the rejection is unhandled. The connection file and the lock stay. All 6 historical failures of the CLI idle-exit test left `archctxd.json` (6 of about 290 Windows runs).

Proof (run 38205449500): another process opens the connection file in read mode as soon as it appears and holds it for 8 s.

| Code | Rounds | Result |
| --- | --- | --- |
| baseline `b1e49f65` | 8 | 8 of 8: `EBUSY` at `rpc-server.ts:226`. Connection and lock files stay. The pid is still alive after 25 s. |
| fixed | 8 | 8 of 8: both files are removed and the pid exits at 8.08 s, just after the holder releases. |

A direct `rmSync` while the reader holds the file fails with `EBUSY` on Windows Server 2025 with Bun 1.4.3.

P3: the reader keeps delete sharing denied on purpose, so the deleter must tolerate it. `removePrivateControlFile` retries `EBUSY`, `EPERM` and `EACCES` on Windows only, for the native read deadline (10 s) plus 2 s. At that deadline the reader child is killed, so its handle closes. Other errors and other platforms fail at once. The RPC server uses it in `stop`, in the failed-start release and in the idle exit. The idle exit always calls `stop` and then exits, also when the removal fails. The shutdown RPC logs a cleanup failure instead of an unhandled rejection. While the removal waits, the server still accepts requests, and the reader is often a CLI about to call the daemon. A request accepted during the wait cancels the exit: the daemon publishes its connection file again and re-arms the idle timer. Only one idle exit runs at a time.

Not changed: `recoverStaleDaemonControlFiles`, `acquireDaemonLock` and the GitHub connection removal in the CLI still use a plain `rmSync`. They are synchronous CLI paths and meet a reader only when two CLI processes act on one stale file.

## 2. Projection handshake `--version` deadline (runner stall)

The failing call took 5350 ms against a 5000 ms deadline. In the same position (whole `cli.test.ts`, run 38205509409, 97 tests pass), the Windows timings are:

| Subcommand | n | p50 | p99 | max |
| --- | --- | --- | --- | --- |
| `--version` | 210 | 94 ms | 116 ms | 2382 ms (first launch in the file) |
| `status -j` | 381 | 480 ms | 587 ms | 671 ms |
| `sync` | 127 | 604 ms | 1831 ms | 2972 ms |

The handshake runs `execFileSync`, so nothing else in the test process runs during the call. The 5350 ms is a runner stall of more than 50 times the median. It is not a race. `--version` starts the same launcher chain (Bun, the npm shim, the bundled Node) as `status`, which has 10 s. The version probe now has the same 10 s. The failing stall was killed at 5 s, so its full length is unknown; 10 s doubles the tolerance but does not prove that it covers that stall.

## 3. First native create deadline (PowerShell cold start)

First create per job in 323 historical Windows jobs: p50 4588 ms, p90 9277 ms, p95 12188 ms. The six slowest were 16677, 18782, 18782, 19163 and 24815 ms, and one did not finish in 30018 ms.

Probe run 38204097359 started PowerShell 5.1 on nine fresh runners. Three script variants each ran first on three runners:

| First script | Cold launch | Warm launches |
| --- | --- | --- |
| `[Console]::Out.Write` only | 2061, 2178, 9348 ms | 113 to 219 ms |
| .NET `FileStream` only | 3805, 5263, 8808 ms | 119 to 279 ms |
| cmdlets (`ConvertFrom-Json`, `New-Object`) | 3712, 5799, 6585 ms | 188 to 445 ms |

The cold cost belongs to `powershell.exe` startup. A script without cmdlets does not remove it. The first cmdlet use adds a one-time 1.4 to 3.2 s. The create deadline is now 60 s, more than twice the slowest completed sample. The two daemon startup files still fit in the 150 s Windows daemon start budget. The creation test timeout is 120 s, so a slow create reports its native diagnostic, not a test timeout. Reads keep 10 s.

## 4. Local projection test timeout (load)

One `generated present` scenario runs 19 CodeGraph handshakes, which is 95 CodeGraph launches. On macOS it took 62 s alone and 114 s with a host load average near 70. The CodeGraph launches used 104 s of the 114 s. Windows CI takes 81 to 84 s with its 240 s cap. The non-Windows cap of 120 s gave less than 1.1 times headroom on a loaded host, so it is now 240 s on every platform.
