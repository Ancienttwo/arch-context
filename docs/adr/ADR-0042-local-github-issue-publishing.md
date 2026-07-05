---
schemaVersion: archcontext.adr/v1
id: adr.0042.local-github-issue-publishing
title: Local Approve-and-Publish for Advisory GitHub Issue Drafts
status: accepted
decidedAt: 2026-07-05
appliesTo:
  - package.core-architecture-ledger
  - package.local-runtime-runtime-daemon
  - package.surfaces-cli
supersedes: []
---

# Context

ADR-0041 gave `archctx` a daemon-driven, opt-in audit flow that produces typed, advisory-only
`GithubIssueDraftV1` drafts and records one append-only `ArchitectureAuditRunV1` ledger event per
run (`status: "pending" | "issued" | "failed"`). It deliberately stopped there: publishing those
drafts as real GitHub issues — `archctx audit approve`, a `gh` invocation with write intent, a
narrow-scope PAT, an additional confirmation gate for non-private repositories, and
crash-recovery idempotency for partially-issued runs — was named an explicit non-goal and
reserved for this ADR, because it is the first place this codebase would call `gh` with write
intent rather than read-only.

Two invariants carried over from ADR-0001/ADR-0005/ADR-0012/ADR-0040/ADR-0041 constrain this
design and must not move:

- The runtime daemon is the only ledger mutation authority. `appendArchitectureEvents` is a
  writer-locked, daemon-owned operation; nothing in this ADR bypasses it, and nothing outside the
  daemon (CLI, MCP, a subagent) gets a second mutation path.
- Subagents (headless `claude` runs) are investigators and drafters only, and the process-level
  tool boundary that enforces this (`INVESTIGATION_REPORT_PROPOSAL_FORBIDDEN_ACTIONS`, the
  read-only `--tools`/`--disallowedTools` allowlist) never loosens. `archctx audit approve` runs
  entirely in the daemon process, on the daemon's own decision after a human runs the CLI command;
  the investigation runner never gains — and is never given — a path to `gh`.

# Decision

Add a daemon-owned `archctx audit approve` flow with five parts.

1. **Append-only, content-addressed state transition.** `ArchitectureAuditRunV1.status` gains
   `"issuing"` between `"pending"` and `"issued"`, and `issuedIssues[]` entries gain an optional
   `draftDigest`. `pending -> issuing -> issued` is a strict forward transition driven entirely by
   new ledger events (`architecture.agent_audit.run_issuing` / `...run_issued`); `approve` never
   writes `"failed"` — that status stays reserved for ADR-0041's investigation-failed case, and a
   run that failed investigation is rejected outright (no drafts to publish). `pending`/`failed`
   keep ADR-0041's original single idempotency key per run
   (`architecture-ledger-agent-audit:<runId>`) byte-for-byte; `issuing`/`issued` use a
   content-addressed key
   (`architecture-ledger-agent-audit:<runId>:<status>:<digest of the transition's own content>`),
   so replaying the identical transition is a safe idempotent no-op while a genuinely different
   transition (a new draft filed, a status change) never collides with a prior key. The read
   model needs no schema change: `audit_runs.run_id` is already a primary key behind
   `INSERT OR REPLACE`, so a later event for the same run simply supersedes the row.
2. **An isolated `gh` executor port the investigation runner never sees.** A new
   `GithubIssueExecutorPort` (`createIssue`/`repoView`/`listRecentIssues`) is the only place in
   this codebase that shells out to `gh` with write intent, injected into `ArchctxDaemon`
   independently of (and never reachable from) `CommandInvestigationRunnerTransport` — the same
   separation ADR-0041 drew between the investigation transport and the daemon's own ledger
   writes, now drawn again between the investigation transport and this new publish path. The
   real executor uses `execFile` (no shell), passes the PAT only through the child process's
   `GH_TOKEN` environment variable (never argv, never the daemon's full `process.env`), and writes
   the issue body to a private (0600) temp file under `os.tmpdir()` — never inside the audited
   repository — deleted immediately after the call settles.
3. **A narrow trust boundary with no ambient fallback.** `auditApprove` requires a dedicated
   `ARCHCONTEXT_GH_ISSUES_TOKEN` fine-grained PAT scoped to `Issues: write` only; a missing token,
   an unresolvable `git remote get-url origin`, or a failed/inconclusive `gh repo view` visibility
   probe all fail closed with no `gh` call made and no fallback to an ambient `gh auth login`
   session. Every draft's full outbound payload (title, body, labels, and the footer marker below)
   is scanned against the same six secret-shaped patterns
   `scripts/fg5-retention-staging-readback.ts` already uses, and checked against GitHub's issue
   body length limit, for the entire batch before any ledger event is appended or any `gh` call is
   made; either check failing aborts the whole run, not just the offending draft. Authorization is
   local-process trust plus the manifest's `audit.githubIssues.enabled` opt-in plus this narrow
   PAT — not a new RBAC layer, matching this codebase's existing single-operator local trust model.
4. **A second, explicit gate for non-private repositories.** Beyond the opt-in manifest flag,
   publishing to a repository whose authoritatively-probed visibility is not `private` requires a
   caller-supplied `--confirm-public-repo <token>` matching
   `public:<owner/repo>:<baseSha>:<runId>` exactly; an absent or stale token returns
   `AC_USER_CONFIRMATION_REQUIRED` with the exact rerun command in the error message (the CLI
   prints it as a warning) rather than guessing intent. The token is not a secret — it is
   reconstructible from data already in the ledger — but its digest, never its raw text, is folded
   into the intent event's `provenance.inputDigest` so the specific confirmation used is
   cryptographically bound to that append.
5. **Crash-safe, human-gated resume.** Each successfully filed or deduped draft appends its own
   ledger event immediately (`issuedIssues` grows by one entry per event), so a crash mid-run
   leaves at most one filed-but-unrecorded issue — recovered by a footer marker
   (`` > Filed by archctx audit · run `<runId>` · draft `<draftDigest>` ``) that a resumed
   `approve --resume` matches via a plain `gh issue list --json number,url,body` scan (deliberately
   not GitHub's search index, whose indexing lag would make the exact crash-resume window
   unreliable) before creating anything. `--resume` is the only way to continue a run stuck in
   `"issuing"`; a bare `archctx audit approve <runId>` on an already-issuing run is rejected with
   the exact resume command, and there is no automatic retry or background resume anywhere in this
   design.

This is orthogonal to the SaaS control plane's existing `ghCli: "not-used"` posture
(`packages/surfaces/cli/src/main.ts`'s `github` command family): that posture governs a typed,
metadata-only GitHub App integration whose permission manifest
(`packages/contracts/src/github-governance.ts`'s `GITHUB_APP_PERMISSION_MANIFEST`) forbids
`issues` by default for the hosted product. This ADR is a structurally different path — a local
daemon shelling out to a locally-installed `gh` binary with a narrow, user-supplied PAT — and the
two never intersect.

# Consequences

- (+) The only two invariants that matter for a first `gh`-with-write-intent capability —
  daemon-only ledger mutation, and subagents never touching `gh` — are both provably unchanged:
  the investigation runner's process-level tool boundary is untouched, and the new executor is
  injected and called exclusively from `ArchctxDaemon.auditApprove`.
- (+) A crash between `createIssue` succeeding and its ledger event being appended is the only
  window that can produce an orphaned (filed-but-unrecorded) issue, and that window is bounded to
  at most one draft; the marker-based dedup scan recovers it on the next `--resume` without ever
  re-publishing.
- (+) Every ledger transition this ADR introduces is append-only and content-addressed; nothing
  here adds a second way to mutate `ArchitectureAuditRunV1`, and the SQLite read model needed zero
  schema changes.
- (−) `gh issue create` itself is not idempotent from this codebase's side — a second `gh` call
  for the same draft, absent the marker-based dedup check, would file a second issue. This is
  contained (dedup checked before every create, at most one draft's exposure window, manual
  `--resume` only, never automatic) but it is advisory-only content on a low-frequency path, so the
  residual risk is accepted rather than eliminated.
- (−) `scripts/github-api-contract-audit.mjs` only scans `packages/cloud` and
  `packages/contracts/src`; the new `gh` executor lives in
  `packages/local-runtime/runtime-daemon/src/github-issue-executor.ts`, outside both scan roots.
  This is a known, explicitly-recorded governance blind spot for this specific file — it is not
  covered by that static scanner and relies on the red-line tests in this ADR's implementation
  (runner-never-touches-`gh`, unapproved-run-never-touches-`gh`,
  unconfirmed-public-repo-never-touches-`gh`) as its actual gate instead.
- (−) `ARCHCONTEXT_GH_ISSUES_TOKEN` is a new sensitive runtime dependency: a live, narrow-scope PAT
  sitting in the daemon process's environment whenever this capability is used.
- **Non-goals:** a schedule/auto-run audit trigger; an `--auto-approve` flag or any unattended
  approval path; publishing via a GitHub App/OAuth installation instead of a local PAT;
  multi-user RBAC around who may approve; GitHub Enterprise Server; editing or closing an
  already-filed issue; applying a draft's labels via `gh issue create` at all (label existence on
  the target repository is never verified, and `gh issue create --label X` fails the entire call
  outright when `X` doesn't exist there — an unbounded new partial-failure shape this ADR does not
  attempt to classify — so `createIssue` never sends `--label`; a draft's labels stay visible only
  via `archctx audit show`, for a human to apply by hand after filing); any host other than
  `github.com`; an MCP-surfaced `approve` tool; and extracting `SECRET_PATTERNS` into a shared
  module across this file and `scripts/fg5-retention-staging-readback.ts` (the two lists are kept
  independently inlined on purpose — see the executor module's own comment).
