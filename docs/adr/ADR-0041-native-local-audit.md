---
schemaVersion: archcontext.adr/v1
id: adr.0041.native-local-audit
title: Daemon-Driven Local Architecture Audit with Advisory GitHub Issue Drafts
status: accepted
decidedAt: 2026-07-05
appliesTo:
  - package.contracts
  - package.agent-orchestrator
  - package.architecture-ledger
  - package.local-store-sqlite
  - package.runtime-daemon
  - package.surfaces-cli
supersedes: []
---

# Context

`archctxd` already accepts `jobsEnqueueGitHook` and queues `AgentJobV1` records, but
nothing previously executed those jobs end to end: the protocol layer was complete
while the daemon had no real transport to spawn a coding-agent process, and no
command actually drove a full-repository audit. Separately, ArchContext has no
typed way to propose an advisory GitHub issue from an investigation; the existing
`InvestigationReportV1` proposal shape only covers documentation drafts and
deterministic architecture deltas.

This ADR closes both gaps for the local, single-repository MVP: the daemon gains a
real, synchronous audit entrypoint, and investigation output gains a typed,
advisory-only GitHub issue draft shape. It does this with zero external side
effects — no network calls, no `gh` invocations, nothing leaves the local machine.

Two invariants from ADR-0001/ADR-0012/ADR-0040 constrain the design and must not
move:

- Subagents (headless `claude` runs) are investigators and drafters only. They
  produce advisory-only typed reports and must never execute `gh` or any other
  mutating command. `INVESTIGATION_REPORT_PROPOSAL_FORBIDDEN_ACTIONS` already
  covers this with six tests; this ADR adds a parallel proposal shape without
  touching that boundary.
- The runtime daemon is the only ledger mutation authority.
  `appendArchitectureEvents` is a writer-locked, daemon-owned operation; nothing
  in this ADR bypasses it.

# Decision

Adopt a daemon-driven, opt-in local audit flow with four parts.

1. **Daemon-owned `auditRun` RPC.** `archctxd` builds its own investigation job
   in-process (trigger source `agent_audit`, distinct from the git-hook trigger
   semantics used by `jobsEnqueueGitHook`), claims it, and runs a real transport:
   `spawn("claude", ["--print", "--output-format", "json", ...])` with no shell,
   unwrapping the CLI's JSON envelope into an `InvestigationReportV1`. This is a
   synchronous RPC — the CLI caller blocks until the audit finishes or times out
   — matching the "trigger and read" boundary CLI/MCP already hold everywhere
   else in this codebase.
2. **New typed proposal shape.** `GithubIssueDraftV1` (in
   `core/agent-orchestrator`, carried under `InvestigationReportV1.extensions.
   githubIssueDrafts`) is advisory-only: it uses `bodyMarkdown` rather than the
   raw-payload-guarded `body` field, and carries a `bodyDigest` the daemon
   recomputes and compares before trusting the draft. `ArchitectureAuditRunV1`
   (in `core/architecture-ledger`) is the ledger-facing record of one audit run
   (`status: "pending" | "issued" | "failed"`, digests, no issue body content).
3. **Parallel validation, not a shared one.** `validateRuntimeAgentProposalPlan`
   checks `githubIssueDrafts` the same way it already checks
   `documentationDrafts` — jobId/reportId/digest match, advisory-only, recomputed
   `bodyDigest` — but does not require a deterministic
   `ArchitectureCandidateChangeV1` binding. Audit-directed issues are usually not
   1:1 with a deterministic delta the way documentation drafts are, so forcing
   that binding would make the validator reject legitimate audit output.
4. **Append-only, opt-in.** A successful or failed run appends one
   `agent_audit`-sourced event through the existing daemon-owned
   `appendArchitectureEvents` path and projects into an `audit_runs` table —
   append-only, queryable, no new mutation surface. The entire capability is
   off by default: `.archcontext/manifest.yaml` gets
   `audit.githubIssues.enabled: false`, and both layers enforce that gate,
   fail-closed, on their own resolved repository root: the CLI checks it
   (resolving up from `cwd` to the repository root first, so the check still
   finds the manifest when invoked from a subdirectory) before it ever calls
   the daemon's `auditRun` RPC, and the daemon's `auditRun` resolves its own
   repository root and checks the same manifest again before doing any work.
   Neither side treats the other as the sole policy owner, matching the
   existing CLI/MCP-are-triggers split from ADR-0006.

# Consequences

- (+) The investigation-job protocol layer that ADR-0001 defined but never
  wired to a real transport is now exercised end to end, with a genuine
  `spawn` transport instead of a stub.
- (+) Audit output is typed and auditable: every run is one append-only ledger
  event, every issue draft carries a recomputed digest, and the six existing
  `INVESTIGATION_REPORT_PROPOSAL_FORBIDDEN_ACTIONS` tests continue to prove
  subagents cannot self-execute `gh` or any other mutating command.
- (+) Responsibility stays split the way ADR-0006 already established: the
  subagent drafts, the daemon is the sole ledger writer, and the CLI is a
  trigger/reader that fails closed in front of a capability it does not own.
- (−) `repoVisibility` is a first-cut `"private"` placeholder on every audit
  run record; pending runs are never published, and a real visibility probe
  (via `gh`) only needs to exist once approval/publish exists.
- (−) `AUDIT_PROMPT_TEMPLATE` is a first version. Porting the fuller
  geju-style audit methodology into the prompt is deferred; this ADR only
  commits to the typed contract and the execution path, not prompt quality.
- (+) `validationDigest` folds in `githubIssueDraftDigests` alongside
  `proposedDeltaDigests` and `documentationDraftDigests`, and the runtime
  daemon recomputes both `validationDigest` and `proposalDigest` from the
  claimed plan's own fields when a job completes. A plan that claims either
  digest without the daemon-recomputed value matching is rejected
  (`AC_SCHEMA_INVALID`) before it can be stored as that job's advisory
  proposal.
- **Explicit non-goal:** publishing these drafts as real GitHub issues —
  `archctx audit approve`, `execFile("gh", ["issue", "create", ...])`, a
  narrow-scope PAT, an additional confirmation gate for public repositories,
  and crash-recovery idempotency for partially-issued runs — is out of scope
  here and is addressed by **ADR-0042**. That ADR has its own trust-boundary
  argument (it is the first place this codebase calls `gh` with write intent)
  and is orthogonal to the SaaS control plane's existing `ghCli: "not-used"`
  posture, which governs the hosted product, not this local CLI path.
