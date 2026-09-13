# Historical projection journal lookup must not open a source session

Baseline: archctx 0.5.9, origin/main `e4a3a56640155bf9889b2dbb02754774035493b4`. The primary checkout had unrelated WIP, so the fix lives in the isolated `codex/projection-journal-read` worktree.

Projection run calls `listProjectionPriorCommittedApplies` before rendering/applying. The daemon called `openSession(root)` before querying the existing SQLite journal. Session opening binds the repository and hashes its generic worktree, including `.ai/harness`; the projection-specific digest already excludes that directory. The repo-harness checkout contained about 31.2 GiB of runtime evidence. Direct bounded RPC reads timed out before creating any new snapshot, while a concurrently captured daemon sample showed SHA-256 and synchronous file reads. The journal itself held only 189 committed rows. The unnecessary source scan, rather than journal volume or projection writes, was the pressure point.

The fix removes only `openSession` from this historical lookup. Runtime-running checks, canonical root/request filtering, receipt data, deduplication, transport and all write preconditions remain unchanged. Neither generic digest semantics nor provider deadlines change.

The regression uses the real daemon/local SQLite store: a prior-apply read must create neither a repository session nor a snapshot. It failed on baseline (one snapshot), then passed. Existing replay/RPC assertions also prove historical entries remain exact and a retry does not create another snapshot. Focused suite: 2 pass, 40 assertions. Typecheck and package-boundary checks passed. One initial CodeGraph cold handshake failed; direct invocation completed in 390 ms, and the unchanged focused suite then passed.

The official `fg6-npm-release-dry-run.ts run` builder produced a local 0.5.9 tarball, installed into an isolated artifact directory. An isolated daemon running that package under Node 24.18.0 queried the actual large repo-harness root in 0.1003 seconds, returned an empty prior-apply list from its fresh store, and created zero snapshots. Its temporary daemon/store were removed. The raw probe is `artifacts/projection-journal-read/node-probe.json`; it contains no bearer token.

These are local source/package results. The consumer still installs public archctx 0.5.9 without this fix; no public release, push, shared daemon restart, or installed-package hand edit was performed.
