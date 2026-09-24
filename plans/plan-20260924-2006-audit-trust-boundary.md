# Plan: Audit trust boundary for #161

> **Status**: Approved
> **Created**: 20260924-2006
> **Slug**: audit-trust-boundary
> **Planning Source**: codex-plan-or-waza-think
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: runtime-daemon/context7/hardening/contracts tests, audit|doctor|consent CLI tests, typecheck
> **Rollback Surface**: revert branch commits; stale consent file is inert
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260924-2006-audit-trust-boundary.contract.md`
> **Task Review**: `tasks/reviews/20260924-2006-audit-trust-boundary.review.md`
> **Implementation Notes**: `tasks/notes/20260924-2006-audit-trust-boundary.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from codex-plan-or-waza-think planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260924-2006-audit-trust-boundary.md`
- Sprint contract: `tasks/contracts/20260924-2006-audit-trust-boundary.contract.md`
- Sprint review: `tasks/reviews/20260924-2006-audit-trust-boundary.review.md`
- Implementation notes: `tasks/notes/20260924-2006-audit-trust-boundary.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260924-2006-audit-trust-boundary.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260924-2006-audit-trust-boundary.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260924-2006-audit-trust-boundary.md`.

## Approach
### Strategy
Use the captured planning output below as the execution source of truth.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| See captured planning output | Follow | Implement only the approved scope named below |

### Code Snippets
See captured planning output.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Captured plan lacks enough detail | Medium | Execution may need clarification | Stop before implementation if the captured output contradicts repo rules or lacks concrete file targets |

## Task Contracts
- Contract file: `tasks/contracts/20260924-2006-audit-trust-boundary.contract.md`
- Review file: `tasks/reviews/20260924-2006-audit-trust-boundary.review.md`
- Implementation notes file: `tasks/notes/20260924-2006-audit-trust-boundary.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260924-2006-audit-trust-boundary.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260924-2006-audit-trust-boundary.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: revert branch commits; stale consent file is inert
- **Verification boundary**: runtime-daemon/context7/hardening/contracts tests, audit|doctor|consent CLI tests, typecheck
- **Review/acceptance boundary**: `tasks/reviews/20260924-2006-audit-trust-boundary.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: human_decision_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260924-2006-audit-trust-boundary.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260924-2006-audit-trust-boundary.contract.md`, `tasks/reviews/20260924-2006-audit-trust-boundary.review.md`, and `tasks/notes/20260924-2006-audit-trust-boundary.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260924-2006-audit-trust-boundary.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: revert branch commits; stale consent file is inert

## Captured Planning Output

# Audit trust boundary for #161

## Context

Issue #161: the audit investigation child inherits the daemon environment (including the GitHub PAT); audit consent is decided by the repository-committed manifest; doctor and ADR-0041 misreport egress; issue-draft secret detectors are narrow. The first commit on this branch implements the four acceptance criteria. The acceptance gate then failed it on:

1. `archctx audit consent` grants consent for any args without `--revoke` (e.g. `--help`, `revoke`).
2. The child-env allowlist drops Claude Code privacy opt-outs (DISABLE_TELEMETRY, DISABLE_ERROR_REPORTING, ...), which adds telemetry egress.
3. ADR-0042 still names the manifest opt-in as the publish authorization, which contradicts ADR-0041 §5.
4. The consent record stores and prints the raw origin URL, including embedded credentials.
Advisory: the egress-policy fingerprint omits the Bedrock/Vertex conditional list; some AWS/Vertex config-path vars are missing; the `ANTHROPIC_` prefix forwards admin keys; the consent write follows symlinks and is not atomic.

## Decision

- Separate authorities: the manifest declares the capability; user-level consent lives in the user state dir, bound to the git common dir, a credential-stripped origin and the egress-policy digest; issue publishing keeps its own confirmation and PAT.
- Strict `audit consent` argument parsing: no args grants, `--revoke` revokes, `--help`/`-h` prints help, anything else is `AC_SCHEMA_INVALID`.
- Env allowlist gains non-credential privacy opt-outs and provider config-path vars, and excludes admin keys. The policy digest covers every forwarded name.
- Consent writes are atomic, 0600, and do not follow symlinks.
- Follow-up (not in this change): doctor reads the CLI environment, not the running daemon's.

## Verification

- Tests: `consent --help` and `consent revoke` write nothing; a credentialed origin is never stored or printed; the privacy opt-outs reach the child; the admin key does not.
- `bun run typecheck`; `bun test packages/local-runtime/runtime-daemon packages/local-runtime/context7-adapter packages/cloud/hardening packages/contracts`; `bun test packages/surfaces/cli/test/cli.test.ts -t "audit|doctor|consent|egress"`.

## Rollback

Revert the branch commits. Users who granted consent keep a stale file in the state dir, and nothing reads it after a revert.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [ ] Execute captured plan: Audit trust boundary for #161
