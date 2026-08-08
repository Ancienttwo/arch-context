# Task Contract: axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake

> **Status**: Fulfilled
> **Plan**: plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-08-08 17:35
> **Review File**: `tasks/reviews/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.review.md`
> **Notes File**: `tasks/notes/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

当前 docs projection 用 commit stamp和 `.codegraph` 目录存在近似 snapshot；dirty source、
stale index 或 PATH 上错误 binary 都可能生成无法证明的 P1/P2，并让 repo-harness 在 AXR5
以后错误 ack runtime event。

## Goal

投影 receipt 必须绑定实际 package-local CodeGraph 1.5.0 handshake与同一个 dirty worktree
的 source/model/layout/render inputs；任何 stale/mismatch/timeout fail closed；source 与 docs
位于同一 commit 时仍由 semantic digest 得到正确 freshness。

## Scope

- In scope: projection snapshot contracts；CodeGraph 1.5.0 exact package/binary/version/status/
  sync/query proof；source tree digest；manifest/CLI/daemon/freshness readback；tests。
- Out of scope: node v2/ArchitectureFlow semantic compiler（AXR3）；major-change signal（AXR4）；
  repo-harness provider/runtime（AXR5+）；直接读取 `.codegraph` internals。
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

如果 CodeGraph 1.5.0 public CLI 无法给出可验证 status，且 sync 后对同一 source snapshot
不能稳定复现 graph digest，则不能宣称 verified diagram；最便宜证明是对 disposable fixture
运行 actual `--version`、`status -j`、`sync`、`status -j` 两轮并比较 canonical receipt。

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.review.md`
- Notes file: `tasks/notes/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.notes.md`
- Checks file: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope gate: edit only paths listed under `allowed_paths`; update this contract before widening scope.
- Completion gate: run `verify-sprint --prepare-acceptance`, record one typed AcceptanceReceipt under the frozen policy below, then run `verify-sprint`; review Markdown is projection only.

## Acceptance Policy

```json
{"protocol":1,"reviewer":"Claude","user_waiver":"allowed"}
```

## Allowed Paths

```yaml
allowed_paths:
  - docs/spec.md
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md
  - tasks/reviews/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.review.md
  - tasks/notes/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.notes.md
  - .ai/context/capabilities.json
  - .claude/templates/
  - package.json
  - bun.lock
  - packages/contracts/
  - packages/core/projection-engine/
  - packages/local-runtime/codegraph-adapter/
  - packages/local-runtime/package.json
  - packages/local-runtime/git-adapter/
  - packages/local-runtime/runtime-daemon/
  - packages/surfaces/cli/
  - packages/surfaces/renderer/test/renderer.test.ts
  - schemas/runtime/
  - scripts/architecture-ledger-al9-complete-task-provenance-readback.ts
  - scripts/architecture-ledger-al9-doc-projections-readback.ts
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
      - codex-exec
      - main-thread
    fallback: main-thread
    brief_is_authoritative: true
```

## Exit Criteria (Machine Verifiable)

```yaml
exit_criteria:
  files_exist:
    - packages/local-runtime/codegraph-adapter/src/index.ts
    - packages/core/projection-engine/test/projection-freshness.test.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.notes.md
  tests_pass:
    - path: packages/local-runtime/codegraph-adapter/test/codegraph-adapter.test.ts
    - path: packages/local-runtime/codegraph-adapter/test/capability-projection-inputs.test.ts
    - path: packages/core/projection-engine/test/projection-freshness.test.ts
    - path: packages/contracts/test/contracts.test.ts
    - path: packages/surfaces/cli/test/cli.test.ts
  commands_succeed:
    - bun run typecheck
    - bun test packages/local-runtime/codegraph-adapter/test packages/core/projection-engine/test/projection-freshness.test.ts packages/contracts/test/contracts.test.ts packages/surfaces/cli/test/cli.test.ts
```

## Acceptance Notes (Human Review)

- Functional behavior:
- Edge cases:
- Regression risks:

## Rollback Point

- Commit / checkpoint:
- Revert strategy:
