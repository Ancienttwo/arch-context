# Task Contract: remaining-audit-issues

> **Status**: Active
> **Plan**: plans/plan-20260925-1345-remaining-audit-issues.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: kito
> **Capability ID**: root
> **Last Updated**: 2026-09-25 13:48
> **Review File**: `tasks/reviews/20260925-1345-remaining-audit-issues.review.md`
> **Notes File**: `tasks/notes/20260925-1345-remaining-audit-issues.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

Audit issues must be handled without treating fabricated connection state, URL credentials, or duplicated feature authority as delivered behavior. Incorrect auth changes expose local architecture; incorrect refactors change writer ownership.

## Goal

Repair Explorer credential transport; integrate existing #164 feature extractions; verify and record the remaining #162/#171 delivery boundaries. Preserve local-product scope and all daemon/ChangeSet invariants.

## Scope

- In scope: Explorer auth/server/renderer tests, original #220/#221/#222 integration, bounded audit fixes and issue disposition evidence. Owner approved committing/pushing this candidate as a Draft PR, hosted Windows CI, and truthful validation-evidence updates. The latest approved slice replaces FG6 Markdown conclusion parsing with structured GitHub run/job authority and runs one frozen-candidate matrix; workflow failure remains distinct from matrix success. Owner additionally approved a manual Governance-only event in the existing Verify workflow and its actual hosted execution; normal PR/main matrix coverage remains intact.
- Out of scope: cloud delivery implementation, PR merge, package publication/deployment, bypassing model/ledger mutation boundaries. Draft-PR branch publication and hosted verification are authorized.
- Approved projection/RPC diagnosis: capture typed errors and subprocess/outer timing for the two CLI verification failures; repair only proven causes, retain the unreproduced failure as unconfirmed, and continue the existing Draft/current-source CI boundary after named checks pass.
- Approved egress continuation: add shared local-runtime admission for named outbound transports/commands, preserve existing feature consent, enforce explicit local-only denial, and verify the local E2E under real kernel network isolation. Refresh the existing FG6 proof and hosted evidence; no external provider invocation is authorized.
- Approved manifest continuation: implement the single-field `update_manifest_fields` ChangeSet contract, expose CLI/MCP planning, verify journal/approval boundaries, and apply `content.decisions = docs/adr` through the daemon. Arbitrary manifest editing and configurable ADR routing remain outside this slice.
- Approved DE1/DE3 continuation: repair only the three historical source predicates (indexedBacklinks, requiredDomainsFailClosed, explicitAuthorityBinding), with negative guards and current behavioral verification. Historical artifact verdicts remain unchanged; no S6 cleanup or runtime semantic changes.
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

The new regression must reject query credentials while preserving authenticated navigation, SSE, revocation and expiry. Existing feature tests must retain behavior after extraction integration. A regression blocks acceptance.

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260925-1345-remaining-audit-issues.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260925-1345-remaining-audit-issues.review.md`
- Notes file: `tasks/notes/20260925-1345-remaining-audit-issues.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Change Assessment

```json
{"protocol":1,"oracles":[]}
```

## Acceptance Policy

```json
{"protocol":2,"reviewer":"Codex","source":"codex-plugin","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - packages/local-runtime/
  - packages/surfaces/
  - packages/contracts/
  - packages/core/
  - scripts/
  - tests/
  - tsconfig.json
  - package.json
  - docs/researches/
  - docs/runbooks/
  - docs/adr/
  - docs/verification/
  - .github/workflows/verify.yml
  - .github/workflows/windows-acl-diagnostics.yml
  - .archcontext/manifest.yaml # only through approved daemon ChangeSet mutation
  - schemas/runtime/changeset.schema.json
  - .archcontext/model/
  - plans/
  - tasks/
```

## Evidence Requirements

```yaml
evidence_requirements:
  # Set benchmark to required when this contract consumes the harness profile benchmark matrix.
  benchmark: not_applicable
```

## Delegation Contract

```yaml
delegation:
  budget:
    tokens: null
    runner_invocations: null
    wall_time_minutes: null
  permission_scope:
    mode: inherit_allowed_paths
    writable_paths: []
    network: inherited
  roles:
    parent:
      mode: narrate_and_gatekeep
      purpose: approval_checkpoint_owner
    explorer:
      mode: read_only
      purpose: codebase_research
    worker:
      mode: edit_within_allowed_paths
      purpose: implementation
    verifier:
      mode: read_only
      purpose: exit_criteria_review
  runner:
    preferred:
      - subagent
    fallback: null
    brief_is_authoritative: true
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - docs/spec.md
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260925-1345-remaining-audit-issues.notes.md
  tests_pass:
    - path: packages/local-runtime/runtime-daemon/test/explorer-session.test.ts
  commands_succeed:
    - bun run typecheck
    - node scripts/package-boundary-audit.mjs
    - bun run verify
# Optional exact-subject reuse is fail-closed and opt-in. List only deterministic
# criteria whose inputs are fully bound by the frozen subject/toolchain context.
# criterion_reuse:
#   tests_pass:
#     - path/to/deterministic.test.ts
#   commands_succeed:
#     - bun test --timeout 60000
```

## Acceptance Notes (Human Review)

- Functional behavior:
- Edge cases:
- Regression risks:

## Rollback Point

- Commit / checkpoint: e3d8077 before this local integration.
- Revert strategy: revert only this worktree changes; preserve all primary/other-worktree WIP.
