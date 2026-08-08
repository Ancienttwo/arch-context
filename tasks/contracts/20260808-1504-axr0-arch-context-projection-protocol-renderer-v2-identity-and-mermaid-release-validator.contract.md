# Task Contract: axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator

> **Status**: Fulfilled
> **Plan**: plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-08-08 15:04
> **Review File**: `tasks/reviews/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.review.md`
> **Notes File**: `tasks/notes/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

repo-harness 不能直接依赖 arch-context 的内部 TypeScript 类型、renderer 常量或散落的 CLI 输出。若没有一个版本化、可校验、可能力协商的 projection wire contract，后续 Stop checkpoint、projection worker、freshness gate 与 release cutover 都只能靠字符串约定，升级时会静默漂移。Mermaid 同样需要独立于 agent skill 的确定性发布前校验，否则 docs projection 可以写出 GitHub 无法渲染的图，而生产包又可能误带 Chromium。

## Goal

冻结 `ProjectionRequestV1`、`ProjectionResultV1`、`ArchitectureRefreshSignalV1` 与 `ArchctxCapabilitiesV1` 的 JSON Schema/TypeScript contract；将 architecture docs renderer identity 提升到 `archcontext.docs-renderer/v2`；提供不启动 daemon 的 `archctx capabilities --json`；用 exact dev-only `@mermaid-js/mermaid-cli@11.16.0` 渲染校验所有 checked-in architecture Mermaid source，并证明生产 tarball 不含 Mermaid/Chromium。

## Scope

- In scope:
  - projection request/result、refresh signal、capabilities 的 runtime JSON Schema、TypeScript 类型、常量与 valid/invalid fixtures
  - `archctx capabilities --json` 的本地、无 daemon、确定性输出
  - docs renderer v2 identity
  - exact Mermaid CLI dev dependency 与扫描 `docs/architecture/**/*.{md,mmd}` 的无写入渲染 validator
  - npm release dry-run 对 Mermaid/Chromium runtime dependency 和 tarball content 的负面断言
- Out of scope:
  - projection check/plan/apply/adopt 执行器、daemon ledger write、layout manifest、changed-path ownership、semantic/dataflow verifier、refresh producer/consumer
  - repo-harness reader、hook scheduler、Stop drain、capability_source cutover 与 npm publish
  - 修改任何 `.archcontext/` model 或 `docs/architecture/` 投影内容
- Taste constraints: contract fail-closed、`additionalProperties: false`；capabilities 只能声明本 work-package 已实现的 feature；Mermaid 工具仅 devDependency，禁止 production fallback 或 runtime auto-install

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

若 exact Mermaid CLI 无法渲染当前 checked-in architecture Mermaid corpus，或 `npm pack --dry-run` 显示 Mermaid/Chromium 进入生产 tarball/dependencies，则此设计不可交付；最低成本 proof point 是先运行 `bun run verify:architecture-mermaid`，再运行 FG6 dry-run 的负面断言。

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.review.md`
- Notes file: `tasks/notes/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.notes.md`
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
  - package.json
  - bun.lock
  - plans/
  - tasks/todos.md
  - tasks/contracts/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.contract.md
  - tasks/reviews/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.review.md
  - tasks/notes/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.notes.md
  - packages/contracts/
  - packages/core/projection-engine/src/index.ts
  - packages/core/projection-engine/test/
  - packages/surfaces/cli/src/main.ts
  - packages/surfaces/cli/test/cli.test.ts
  - packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  - schemas/runtime/
  - scripts/verify-architecture-mermaid.mjs
  - scripts/fg6-npm-release-dry-run.ts
  - scripts/fg6-npm-release-dry-run.test.ts
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
    - packages/contracts/src/projection.ts
    - schemas/runtime/projection-request.schema.json
    - schemas/runtime/projection-result.schema.json
    - schemas/runtime/architecture-refresh-signal.schema.json
    - schemas/runtime/archctx-capabilities.schema.json
    - scripts/verify-architecture-mermaid.mjs
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.notes.md
  tests_pass:
    - path: packages/contracts/test/contracts.test.ts
    - path: packages/contracts/test/publishability.test.ts
    - path: packages/surfaces/cli/test/cli.test.ts
    - path: packages/core/projection-engine/test/entity-summary.test.ts
    - path: scripts/fg6-npm-release-dry-run.test.ts
    - path: packages/local-runtime/runtime-daemon/test/local-runtime.test.ts
  commands_succeed:
    - bun run typecheck
    - bun test packages/contracts/test/contracts.test.ts packages/contracts/test/publishability.test.ts packages/surfaces/cli/test/cli.test.ts packages/core/projection-engine/test/entity-summary.test.ts scripts/fg6-npm-release-dry-run.test.ts
    - bun run verify:architecture-mermaid
    - bun scripts/fg6-npm-release-dry-run.ts run --out /tmp/archctx-axr0-fg6.json --artifact-dir /tmp/archctx-axr0-artifacts --json
    - bun scripts/fg6-npm-release-dry-run.ts inspect --out /tmp/archctx-axr0-fg6.json --json
    - node scripts/package-boundary-audit.mjs
```

## Acceptance Notes (Human Review)

- Functional behavior: schemas 与 CLI capability output 同形；renderer identity 精确为 v2；所有 checked-in Mermaid fenced blocks 与 `.mmd` 可被 exact CLI 渲染；tarball 负面断言覆盖 dependency 与 file list。
- Edge cases: adopt mode 缺 `adoptionPlanId`、changedPaths 重复/非 POSIX/未排序、snapshot identity 缺失、unknown feature、空 Mermaid corpus 必须拒绝；validator 不改 docs。
- Regression risks: rendererVersion 改变会有意触发已有 projection drift；新增 exact Mermaid devDependency 会显著增加 install size，但不进入生产发布包。

## Rollback Point

- Commit / checkpoint: worktree base `c7963b4`
- Revert strategy: revert AXR0 branch commit；不需要恢复 docs projection 或 ledger，因为本任务不写它们。
