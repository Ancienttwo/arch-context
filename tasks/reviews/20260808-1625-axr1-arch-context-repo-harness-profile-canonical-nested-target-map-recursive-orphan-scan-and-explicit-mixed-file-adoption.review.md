# Task Review: axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption

> **Status**: Done
> **Plan**: plans/plan-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.md
> **Contract**: tasks/contracts/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.contract.md
> **Notes File**: tasks/notes/20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.notes.md
> **Checks File**: .ai/harness/checks/latest.json
> **Last Updated**: 2026-08-08 17:24
> **Recommendation**: pass
> **Review Rubric Version**: 2
> **Reviewed Subject SHA256**: sha256:8190b0bf5da0c9dbe562f04a21ded5416ed82e0298650e705a617884586bdda2
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 81e881e5c020ce27176ee824d0518aec3613d752

## Human Review Card

- Verdict: pass；external Claude re-review 无 P0/P1，保留一项 P2 profile-boundary advisory
- Change type: code-change
- Intended files changed: canonical layout/profile、recursive loader、explicit adoption、CLI ChangeSet path 与回归测试
- Actual files changed: 10 个 reviewed production/test paths，加 plan/contract/notes/review lifecycle artifacts
- Commands passed: `bun run verify`（1184 pass / 0 fail / 145 files）；strict contract 16/16；Mermaid exact render；external Claude review/re-review
- Residual risks: generic agent-context API 仍保留 source.include 推导；repo-harness caller 必须先通过 strict profile layout resolution
- Reviewer action required: none；typed AcceptanceReceipt 已记录
- Rollback: revert commits `082cbd7` 与 `a2af6fe`

## Mode Evidence

- Selected route: contract worktree + external Claude review
- P1/P2/P3 evidence: layout/renderer/loader/CLI 为 producer boundary；trace 覆盖 preview → digest binding → daemon ChangeSet → fixed point；选择 strict profile + one-time adoption
- Root cause or plan evidence: Sprint Architecture Notes、GPT review、repo-harness runtime audit与 AXR1 detailed plan

## Verification Evidence

- Waza `/check` run: external Claude first pass 2 P1 + 3 P2；P1 全修，关键 P2 tests 补齐；re-review 无 P0/P1
- Commands run: `bun run verify`（1184 pass / 0 fail / 7162 expects）；contract 16/16；`bun run verify:architecture-mermaid`
- Manual checks: real CLI adoption preview/incorrect binding/approved apply/second noop；marker-external prefix/suffix byte hashes
- Supporting artifacts: `.ai/harness/checks/latest.json`
- Implementation notes reviewed: yes
- Run snapshot: `.ai/harness/runs/run-20260808T172152-79040-20260808-1625-axr1-arch-context-repo-harness-profile-canonical-nested-target-map-recursive-orphan-scan-and-explicit-mixed-file-adoption.json`

## Manual Check Evidence

- Contract 未声明额外 `manual_checks`。

## Acceptance Receipt Projection

> **Disposition**: external_pass
> **Reviewer**: Claude
> **Source**: claude-review
> **Actor**: not-applicable
> **Reviewed Subject SHA256**: sha256:8190b0bf5da0c9dbe562f04a21ded5416ed82e0298650e705a617884586bdda2
> **Reviewed Subject Scope**: normalized-final-content
> **Reviewed Target Revision**: 81e881e5c020ce27176ee824d0518aec3613d752
> **Verification Evidence SHA256**: sha256:f06eb2a17ad553fa4e2aa49070f4992dcc61519ce1614da6d4015b601b9087db
> **Issued At**: 2026-08-08T09:34:04.755Z

- Summary: External Claude re-review confirmed both P1 regressions fixed and both critical P2 test gaps closed; no P0/P1 remains.
- Findings: P2: agentContextTargetPaths intentionally retains the generic source.include fallback while repo-harness/v1 layout resolution requires strict contractFiles, so callers must resolve the explicit profile before using generic agent-context derivation.

## Behavior Diff Notes

- repo-harness/v1 将 capability identity、nested module path 与 contractFiles 收口到一个 target map。
- marker-free mixed 文件从隐式 append 改为 `projection-adoption-required`，普通 apply 不进入 daemon writer。
- adoption receipt 绑定 preview/worktree/preimage/preserved regions，并在写前双 render 证明 manifest fixed point。
- CLI async handler 现在先 await 完成，再由 outer `finally` 关闭 embedded daemon。

## Residual Risks / Follow-ups

- P2：generic agent-context path derivation 保留 ADR-0043 source.include 行为；显式 repo-harness 流程不可绕过 profile layout validation。

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 9/10 | nested/profile/adoption/noop acceptance verified |
| Product depth | 9/10 | safe brownfield ownership migration through the real runtime writer |
| Design quality | 9/10 | one layout authority and fail-closed explicit adoption |
| Code quality | 9/10 | full suite, adversarial paths, and external P1 closure |

## Failing Items

- none blocking；one P2 advisory retained above

## Retest Steps

- Re-run: `repo-harness run verify-sprint`
- Re-check: `bun test packages/core/projection-engine/test/layout.test.ts packages/core/projection-engine/test/adoption.test.ts packages/surfaces/cli/test/cli.test.ts`

## Summary

- PASS。AXR1 建立 repo-harness nested projection authority与安全的一次性 brownfield adoption lane。
