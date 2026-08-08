> **Archived**: 2026-08-08 17:34
> **Related Plan**: plans/archive/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md
> **Outcome**: Completed
> **Lifecycle**: contract
> **Parent Run ID**: run-20260808-1734

# Task Contract: axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption

> **Status**: Fulfilled
> **Plan**: plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-08-08 16:25
> **Review File**: `tasks/reviews/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.review.md`
> **Notes File**: `tasks/notes/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

当前 renderer 将 capability module 固定投影为 flat path，contract path 从第一个 source
include 推导，existing loader 只扫描一层；更危险的是 mixed marker-free 文件会在普通
apply 中被静默追加第二份生成区。这会让 repo-harness 的 10 份 nested architecture
documents、capability registry 与 agent contracts 分裂为两套 truth，并使自动 runtime
在首次触发时破坏 brownfield 文档。

## Goal

提供 strict `repo-harness/v1` layout authority与显式 adoption lane：nested fixture 精确解析
module/index/contract targets，expected reads 与 recursive orphan scan 分离；普通 apply 遇到
marker-free mixed file 写零 bytes 并返回 adoption-required；只有 approved、preview-ID-bound、
worktree/preimage-matched ChangeSet 才接管范围，所有 marker-external hashes 保持不变，第二次
apply 明确 noop。

## Scope

- In scope:
  - `layout.ts` canonical repo-harness node/profile parser and nested target map
  - exact repo-relative POSIX validation, collision/traversal/symlink rejection
  - exact expected target reads plus recursive orphan marker discovery
  - `adoption.ts` deterministic target ranges, preimage/output/preserved-region hashes and plan ID
  - `docs adopt --profile repo-harness/v1` explicit preview/apply through daemon ChangeSet
  - ordinary mixed marker-free projection rejection and second-run noop
  - canonical contractFiles consumption by module intro, agent-context targets and projection-owned paths
- Out of scope:
  - CodeGraph 1.5/worktree provenance beyond existing ChangeSet digest (AXR2)
  - node v2/ArchitectureFlow/semantic compiler (AXR3)
  - major-change signal producer (AXR4)
  - repo-harness provider/Stop runtime/release cutover (AXR5–AXR8)
- Taste constraints: <!-- advisory only, no run gate; default style/taste lives in AGENTS.md and the minimal-change policy, use this to record a per-task override -->

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

若一个 10-document repo-harness-shaped fixture不能在 pure layout/adoption tests 中同时证明
nested target uniqueness、zero-write unapproved preview、marker-external byte hashes不变与第二次
render clean，则该抽象不足，停止 CLI/daemon 接线。最便宜 proof 是先完成两个 capability 的
`layout.test.ts` + `adoption.test.ts`。

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.review.md`
- Notes file: `tasks/notes/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.notes.md`
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
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md
  - tasks/reviews/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.review.md
  - tasks/notes/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.notes.md
  - packages/core/projection-engine/src/index.ts
  - packages/core/projection-engine/src/layout.ts
  - packages/core/projection-engine/src/adoption.ts
  - packages/core/projection-engine/test/
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - packages/surfaces/renderer/test/renderer.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
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
    - packages/core/projection-engine/src/layout.ts
    - packages/core/projection-engine/src/adoption.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.notes.md
  tests_pass:
    - path: packages/core/projection-engine/test/layout.test.ts
    - path: packages/core/projection-engine/test/adoption.test.ts
    - path: packages/core/projection-engine/test/entity-summary.test.ts
    - path: packages/core/projection-engine/test/agent-context.test.ts
    - path: packages/surfaces/cli/test/cli.test.ts
    - path: packages/surfaces/renderer/test/renderer.test.ts
    - path: packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  commands_succeed:
    - bun run typecheck
    - bun test packages/core/projection-engine/test/layout.test.ts packages/core/projection-engine/test/adoption.test.ts packages/core/projection-engine/test/entity-summary.test.ts packages/core/projection-engine/test/agent-context.test.ts packages/core/projection-engine/test/resolve.test.ts packages/surfaces/cli/test/cli.test.ts packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
    - bun run verify:architecture-mermaid
```

## Acceptance Notes (Human Review)

- Functional behavior: exact nested/index/contract target map；normal apply zero-write on marker-free mixed files；explicit adoption preserves prefix/suffix bytes；second apply noop.
- Edge cases: path traversal/absolute/backslash、target collision、symlink、recursive orphan、missing/duplicate/out-of-order headings、preview/worktree/preimage drift、rollback.
- Regression risks: default generic profile and existing flat ArchContext fixtures must remain stable；strict repo-harness behavior must never fall back after malformed explicit authority.

## Rollback Point

- Commit / checkpoint: worktree base `81e881e`
- Revert strategy: revert AXR1 branch commits；ChangeSet adoption test fixtures are temporary and no checked-in brownfield docs are adopted in this work package.
