# Task Contract: axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler

> **Status**: Fulfilled
> **Plan**: plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md
> **Task Profile**: code-change
> <!-- legal values: code-change | docs-only | ledger-closeout | migration | eval-only | delegated-run | bugfix (omit for legacy passthrough); see docs/reference-configs/sprint-contracts.md -->
> **Owner**: ancienttwo
> **Capability ID**: root
> **Last Updated**: 2026-08-08 18:24
> **Review File**: `tasks/reviews/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.review.md`
> **Notes File**: `tasks/notes/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.notes.md`
> **Exemplar**: `docs/reference-configs/contract-brief-example.md`

## Why

当前投影把 raw directory/import edge 画成 P1，把 entrypoint 文件 top-five symbol 的 call
trail 画成 P2。edge 虽来自 CodeGraph，但 participant、业务顺序、success/error branch 与终态
均未被架构 authority 声明，repo-harness 后续若据此自动刷新，会把候选图误当 verified truth。

## Goal

原子切换到唯一 `archcontext.node/v2`，新增 `ArchitectureFlowV1` 与 exact CodeGraph
source/sink evidence binding；pure compiler 输出 proven/not-applicable/unprovable proof matrix，
只有 proven 才生成 BYOK-grade semantic P1 与含 success/error terminal outcomes 的 P2。

## Scope

- In scope: node v2 schema/model/fixture/ledger/runtime atomic migration；flow v1 schema/loader；
  exact selector evidence；semantic compiler/renderer/proof digest；two-fixture fidelity gate；Mermaid
  automated render + skill Architecture review evidence。
- Out of scope: modeling repo-harness remaining eight capabilities；major-change signal（AXR4）；
  provider/job/hook runtime（AXR5+）；直接写 docs/YAML 绕过 ChangeSet；LLM 在 render time 发明语义。
- Taste constraints: semantic labels必须显式声明；Mermaid quoted labels/stable IDs/high-contrast
  dark/light class styles；unprovable 不得输出降级图。

## Stop Conditions

- Stop and hand back to the parent if the change would require editing a path outside Allowed Paths.
- Stop if an Exit Criteria command cannot be run in this environment.
- Stop if Goal, Scope, or Exit Criteria are internally contradictory.

## Falsifier

若 `verification/codegraph-readiness` 或 `runtime-harness/hook-adapters` 在不复制 prose、
不发明 branch 的情况下无法同时得到 unique selector bindings、success/error terminal outcomes 与
proven proof，则 semantic model不足以支持自动投影；最便宜证明是先跑两个 synthetic fixture
的 compiler matrix，任一 unprovable 即停止扩展，而不是调整 heuristic 让它过关。

## Root Cause Evidence

Required when Task Profile is `bugfix`; leave as-is otherwise.

- root_cause: one sentence naming file:line/condition (testable, not "a state issue").
- repro: the command or UI path that reproduces the symptom.
- regression_guard: path to a test that fails on the unfixed code and passes after the fix (must also appear under exit_criteria.tests_pass).
- pre_fix_failure_artifact: path to a captured run of regression_guard on the UNFIXED code. Capture with `bun test <regression_guard> > <artifact> 2>&1; echo "PRE_FIX_EXIT=$?" >> <artifact>` (no pipes — pipes swallow the exit status). The gate requires a non-zero `PRE_FIX_EXIT=` line plus the regression_guard path string in the artifact (see the Root Cause Evidence Gate section in docs/reference-configs/sprint-contracts.md).

## Workflow Inventory

- Source plan: `plans/plan-20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.md`
- Deferred-goal ledger: `tasks/todos.md`
- Review file: `tasks/reviews/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.review.md`
- Notes file: `tasks/notes/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.notes.md`
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
  - tasks/contracts/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.contract.md
  - tasks/reviews/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.review.md
  - tasks/notes/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.notes.md
  - tasks/archive/
  - .archcontext/model/nodes/
  - .archcontext/model/flows/
  - docs/adr/ADR-0043-agent-context-provider.md
  - docs/runbooks/schema-upgrade-guide.md
  - package.json
  - schemas/repo/
  - packages/contracts/
  - packages/core/
  - packages/local-runtime/
  - packages/surfaces/
  - scripts/
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
    - schemas/repo/architecture-flow.schema.json
    - packages/core/projection-engine/src/semantic-diagrams.ts
    - packages/core/projection-engine/test/semantic-diagrams.test.ts
  artifacts_exist:
    - .ai/harness/checks/latest.json
    - tasks/notes/20260808-1817-axr3-arch-context-node-v2-architectureflowv1-and-byok-grade-semantic-p1-p2-compiler.notes.md
  tests_pass:
    - path: packages/contracts/test/contracts.test.ts
    - path: packages/core/projection-engine/test/semantic-diagrams.test.ts
    - path: packages/core/projection-engine/test/entity-summary.test.ts
    - path: packages/local-runtime/codegraph-adapter/test/capability-projection-inputs.test.ts
    - path: packages/core/architecture-ledger/test/architecture-ledger.test.ts
  commands_succeed:
    - bun run typecheck
    - bun test packages/contracts/test/contracts.test.ts packages/core/projection-engine/test/semantic-diagrams.test.ts packages/core/projection-engine/test/entity-summary.test.ts packages/local-runtime/codegraph-adapter/test/capability-projection-inputs.test.ts packages/core/architecture-ledger/test/architecture-ledger.test.ts
    - bun run verify:architecture-mermaid
    - bun run verify
  manual_checks:
    - "Repository runtime, fixtures and tests contain no archcontext.node/v1 reader or accepted fixture"
    - "verification/codegraph-readiness and runtime-harness/hook-adapters both compile proven; evidence records declaration LOC, selector coverage, unbound selectors and human review minutes"
    - "Representative semantic P1, normal P2 and alt/error P2 SVGs pass Mermaid skill Architecture review"
    - "Raw paths, directory names or top-five call trails without ArchitectureFlowV1 cannot produce a verified diagram"
```

## Acceptance Notes (Human Review)

- Functional behavior: unique node v2/flow v1 authority；proven matrix；semantic P1；success/error P2；
  proof digest enters projection input。
- Edge cases: explicit not-applicable；missing/ambiguous/truncated selector；missing error/success outcome；
  Mermaid punctuation/quotes；flow references missing node/relation/participant。
- Regression risks: atomic node v2 cutover touches ledger import/project and broad fixtures；CodeGraph exact
  symbol queries may expose existing index ambiguity；entity body/source digest changes invalidate projections once。

## Rollback Point

- Commit / checkpoint: branch base `fd3fe81`.
- Revert strategy: revert the AXR3 merge unit；node v2/flow v1 schema and consumers必须作为同一 unit
  回滚，不保留 v1/v2 mixed runtime。
