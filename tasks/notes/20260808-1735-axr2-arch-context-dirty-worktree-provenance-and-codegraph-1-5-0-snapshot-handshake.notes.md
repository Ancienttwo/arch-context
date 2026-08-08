# Implementation Notes: axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake

> **Status**: Active
> **Plan**: plans/plan-20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.md
> **Contract**: tasks/contracts/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.contract.md
> **Review**: tasks/reviews/20260808-1735-axr2-arch-context-dirty-worktree-provenance-and-codegraph-1-5-0-snapshot-handshake.review.md
> **Last Updated**: 2026-08-08 18:03
> **Lifecycle**: notes

## Design Decisions

- `prepareArchitectureDocumentationProjectionSnapshot()` 是 CLI 与 daemon 的单一 snapshot
  assembly：同一次调用冻结 base HEAD、projection-fixed-point worktree、declared source tree、
  model、CodeGraph facts、renderer/layout 与 `projectionInputDigest`。
- projection runtime 只解析 package-local `@colbymchenry/codegraph@1.5.0`，实际执行
  `--version`、public `status -j`、一次 `sync`、post-status 和 bounded query；不读取
  `.codegraph` database/WAL。existing-but-stale index fail closed；missing index 是显式
  `unavailable`，声明 entrypoint 的 P2 随后 fail closed。
- `codeGraphBinaryDigest` 绑定 npm shim、platform package manifest、platform launcher、bundled
  Node runtime 与 CLI entrypoint，不把 thin npm shim 冒充真实 runtime artifact。
- `sourceTreeDigest` 对 `source.include - source.exclude` 的当前文件路径与 bytes 排序哈希，
  因而同一 HEAD 下的 tracked/untracked/rename/delete 变化都会改变 snapshot。
- base HEAD 与完整 worktree 是生成 provenance，不是 freshness truth。语义输入未变时沿用 prior
  provenance，避免提交 projection 本身或无关 commit 让 manifest 永久追逐 HEAD；freshness
  比较 source/model/CodeGraph proof，并保留 per-node Git change-set 解释。

## Deviations From Plan Or Spec

- 没有修改 `git-adapter`：现有 `readHeadSha`/Git diff contract 足够；source snapshot 与
  projection-fixed-point worktree measurement 放在 projection-engine，shared snapshot assembly
  放在 CodeGraph adapter，避免增加第二套 Git abstraction。
- 当前 arch-context checkout 没有 `.codegraph`，且 repo contract 明确禁止 agent 自行 init；
  因此本仓库 `docs plan` 对已声明 entrypoint 正确返回 `call-graph-missing`。actual 1.5 ready
  handshake 与两轮固定点改在 disposable indexed fixture 验证。

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| PATH-first vs package-local | package-local | projection receipt 必须可复现，PATH 不具 authority |
| Hash npm shim only vs full runtime bundle | full bundle | CodeGraph shim 会 exec 自带 Node 与 CLI entrypoint |
| Moving HEAD invalidates projection vs sticky generation provenance | sticky provenance | HEAD 仅解释生成时点，semantic source/proof 决定 freshness |
| Missing CodeGraph index auto-init vs explicit unavailable | explicit unavailable | indexing 是用户决策；有 entrypoint 时 renderer fail closed |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Targeted contract suite: `260 pass / 0 fail`。
- Runtime fixed-point regressions: `5 pass / 0 fail`。
- Actual CodeGraph 1.5 disposable indexed fixture：连续两轮 `graphDigest` 与
  `indexedWorktreeDigest` 相等。
- Full repository verification: `bun run verify` pass。

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
