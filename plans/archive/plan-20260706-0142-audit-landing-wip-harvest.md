# Plan: Audit native pending-run 收尾落地 + wip/contracts-npm-scope 兩刀收割

> **Status**: Done
> **Created**: 20260706-0142
> **Slug**: audit-landing-wip-harvest
> **Planning Source**: codex-plan-or-waza-think
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: (required before projection)
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260706-0142-audit-landing-wip-harvest.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260706-0142-audit-landing-wip-harvest.md`; after execution revert branch `codex/audit-landing-wip-harvest` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260706-0142-audit-landing-wip-harvest.contract.md`
> **Task Review**: `tasks/reviews/20260706-0142-audit-landing-wip-harvest.review.md`
> **Implementation Notes**: `tasks/notes/20260706-0142-audit-landing-wip-harvest.notes.md`

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

- Active plan: `plans/plan-20260706-0142-audit-landing-wip-harvest.md`
- Sprint contract: `tasks/contracts/20260706-0142-audit-landing-wip-harvest.contract.md`
- Sprint review: `tasks/reviews/20260706-0142-audit-landing-wip-harvest.review.md`
- Implementation notes: `tasks/notes/20260706-0142-audit-landing-wip-harvest.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260706-0142-audit-landing-wip-harvest.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree; `.claude/.active-plan` is a legacy fallback during transition. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260706-0142-audit-landing-wip-harvest.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260706-0142-audit-landing-wip-harvest.md`.

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
- Contract file: `tasks/contracts/20260706-0142-audit-landing-wip-harvest.contract.md`
- Review file: `tasks/reviews/20260706-0142-audit-landing-wip-harvest.review.md`
- Implementation notes file: `tasks/notes/20260706-0142-audit-landing-wip-harvest.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260706-0142-audit-landing-wip-harvest.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan`, the owning worktree is written to `.ai/harness/active-worktree`, and the plan is mirrored to `.claude/.active-plan` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260706-0142-audit-landing-wip-harvest.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260706-0142-audit-landing-wip-harvest.md`; after execution revert branch `codex/audit-landing-wip-harvest` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260706-0142-audit-landing-wip-harvest.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260706-0142-audit-landing-wip-harvest.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: (required before projection)

## Evidence Contract

- **State/progress path**: `plans/plan-20260706-0142-audit-landing-wip-harvest.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260706-0142-audit-landing-wip-harvest.contract.md`, `tasks/reviews/20260706-0142-audit-landing-wip-harvest.review.md`, and `tasks/notes/20260706-0142-audit-landing-wip-harvest.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260706-0142-audit-landing-wip-harvest.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260706-0142-audit-landing-wip-harvest.md`; after execution revert branch `codex/audit-landing-wip-harvest` or the explicitly reviewed diff.

## Captured Planning Output

## Goal

把 audit/native-pending-run 的未提交工作收尾落地 main，然後分兩刀收割 wip/contracts-npm-scope（已備份 origin），最後清掉 wip 分支。

## Context

- audit/native-pending-run 領先 main 5 commits；工作區有 4 檔案未提交（runtime-daemon src+test、surfaces/cli src+test，共 +335 行）。
- wip/contracts-npm-scope（8a25a02，已備份 origin/wip/contracts-npm-scope）含兩塊零耦合工作：
  - npm 包名：發佈預設名 `@ancienttwo/archcontext-contracts` → 無 scope `archctx-contracts`（scripts/publish-archcontext-contracts.mjs 4 行 + notes + readback；兩名皆未發佈，npm E404 已驗證）。
  - explorer-ui 遷移：surfaces → core 下沉（772 行）+ daemon `/` 路由 JSON → HTML（renderExplorerHtml + CSP writeHtml）。動機：scripts/package-boundary-audit.mjs:122 的 runtime-must-not-depend-on-surfaces 規則。
- ModelContext 死人開關（MODELCONTEXT_REQUIRE_ARCHCONTEXT_CONTRACTS=1）保持關閉，直到 archctx-contracts 發佈且 clean-room install/import readback 通過（tasks/notes/20260628-archcontext-contracts-npm-scope.notes.md）。

## Task Breakdown

- [x] T1 audit 工作提交：已由並行 session 完成（commit 158a4ac，daemon idle exit + stale status reporting；gatekeeper 三度 PASS，verify 948 pass exit 0；驗收記錄見 tasks/reviews/audit-approve-gh-publishing.review.md）。
- [x] T2 audit 分支落地 main：PR #86 merged（origin/main 11cb5ae）。
- [x] T3 verify envelope gap 修復：f67971f（1 行 exit 映射修復 + 63 行單測/e2e 回歸），PR #87 merged（5133a67）。
- [x] T4 wip 第一刀（npm 包名）：e01eb2f 從 wip 取 3 檔案（publish 腳本 + notes + readback）落 codex/contracts-unscoped-npm-name，preflight 驗證 scopeAccess 通過（唯一 blocker 是本機 npm 未登入 E401，屬發佈時環境事項），PR #88 auto-merge 已武裝，CI 綠自動合。
- [x] T5 wip 第二刀（explorer 遷移）：歸屬決策定案 local-runtime（`@archcontext/local-runtime/explorer-html`，daemon 自有 UI，core/ 保持純領域引擎層）；渲染器內容與 main 側 byte-identical（純搬移零落後）；surfaces/explorer-ui 變 re-export shim；daemon `/` 路由改 HTML+CSP，`/projection`/`/search` 保留 JSON；本地 `bun run verify` 全鏈綠 Verdict PASS；PR #89 auto-merge 已武裝。
- [x] T6 收尾：#89 merged（main 6a25187）後兩刀內容驗證在 main（publish 腳本 archctx-contracts、local-runtime/explorer-html、surfaces shim）；wip/contracts-npm-scope 刪除（本地+origin）；todos.md 收割條目移除；plan 歸檔。

## Decision Notes

- T3 是使用者在 audit 驗收記錄中指定的下一刀首選：該 gap 是「全部驗收證據的可信度基石」，pre-existing、侷限 practices 段，但影響所有後續刀的驗證可信度，故排在 wip 收割之前。
- T5 歸屬傾向 local-runtime 內部模組（core/ 現為純領域引擎層，772 行 HTML 渲染器下沉 core 有分層品味問題），最終判斷在 T5 執行時做。
- T4 與 T5 零耦合，T4 先行以解除 ModelContext 發佈前置。

## Verification

- 每刀落地前 `bun run verify` 綠（注意 privacy-route-audit 也掃測試檔字面詞；T3 落地前 verify 的 practices 段結論按 gap 打折看待）。
- T2/T3/T4/T5 各自 PR merge 後 main 綠。

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] T1 audit 工作提交：已由並行 session 完成（commit 158a4ac；gatekeeper 三度 PASS，verify 948 pass exit 0）。
- [x] T2 audit 分支落地 main：PR #86 merged。
- [x] T3 verify envelope gap 修復：f67971f，PR #87 merged。
- [x] T4 wip 第一刀（npm 包名）：e01eb2f，PR #88 auto-merge 武裝，CI 綠自動合。
- [x] T5 wip 第二刀（explorer 遷移）：落 local-runtime/explorer-html，verify 全鏈 PASS，PR #89 auto-merge 武裝。
- [x] T6 收尾：wip 分支已刪（本地+origin），todos.md 收割條目已移除，plan 歸檔。
