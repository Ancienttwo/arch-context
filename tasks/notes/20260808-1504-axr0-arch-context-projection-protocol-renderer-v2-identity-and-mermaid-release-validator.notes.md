# Implementation Notes: axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator

> **Status**: Active
> **Plan**: plans/plan-20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.md
> **Contract**: tasks/contracts/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.contract.md
> **Review**: tasks/reviews/20260808-1504-axr0-arch-context-projection-protocol-renderer-v2-identity-and-mermaid-release-validator.review.md
> **Last Updated**: 2026-08-08 15:04
> **Lifecycle**: notes

## Design Decisions

- `packages/contracts/src/projection.ts` 是 wire identity/type/invariant/receipt digest 的唯一 TypeScript authority；runtime JSON Schema 与 valid fixtures 逐个进通用 schema matrix。
- `archctx capabilities --json` 在 CLI 顶层、daemon/RPC discovery 之前返回独立 `ArchctxCapabilitiesV1`。未塞进 envelope，避免 repo-harness handshake 依赖人类 CLI shape。
- renderer v2 constant 由 contracts 定义，projection-engine 只 re-export 同一 constant；旧 v1 output 会有意进入 drift，不保留双读分支。
- Mermaid skill 保持 external authoring/review 能力；仓内仅 exact devDependency `@mermaid-js/mermaid-cli@11.16.0`。validator 扫描 `docs/architecture` 的 fenced blocks 与 `.mmd`，只写 temp SVG。
- `.mmd` 的 ArchContext ownership marker 不是 Mermaid grammar；validator 仅移除精确 BEGIN/END marker 行后渲染 diagram body，不剥离任意 HTML comment。
- FG6 production stage 继续显式构建 runtime dependency allowlist，并新增 Mermaid/Puppeteer/Playwright/Chromium package/file path 负面断言。

## Deviations From Plan Or Spec

- full `bun run verify` 首跑暴露 runtime test 仍硬编码 `archcontext.docs-renderer/v1`，导致 tamper 操作变成 no-op、drift gate 错误通过。测试改为消费 canonical v2 constant；聚焦回归与第二次 full verify 均通过。生产逻辑无需 compatibility 修补。
- clean-room tarball smoke 运行在本机 Node 26.5.0，npm 正确报告 package engine `>=24 <26` warning；命令仍完成。正式 AXR7/AXR8 smoke 必须使用 Sprint 指定的 Node 24 authority。

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| capability handshake 使用 envelope/v1 | 拒绝 | 增加无关 daemon CLI 语义，消费者还要解包 `data` |
| v1/v2 renderer 双读 | 拒绝 | 会隐藏 stale projection 并形成永久兼容面 |
| Mermaid skill 代替 CI renderer | 拒绝 | skill 不是 exact、可重放的 parser/render toolchain |
| Mermaid CLI 进入 production dependencies | 拒绝 | Chromium supply-chain/安装体积与文本 renderer runtime 无关 |
| exact Mermaid CLI devDependency | 采用 | 本地/CI/发布前用同一版本；FG6 证明不进入 production tarball |

## Open Questions

- AXR1–AXR4 完成时必须扩展 capabilities feature enum/list；AXR0 有意只声明当前已实现的 protocol、refresh contract 和 renderer v2，不能提前宣称 layout/snapshot/flow/major-change producer。

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- `repo-harness run verify-contract ... --strict`: 21/21 fulfilled（扩展 runtime regression guard 后需最终重跑）。
- `bun run verify`: 1170 pass / 0 fail，142 files；Mermaid、packaged CLI、privacy、Explorer、eval 全链 PASS。
- `bun run verify:architecture-mermaid`: 3 diagrams rendered with exact CLI 11.16.0。
- FG6 temp readback: `/tmp/archctx-axr0-fg6.json`，all assertions true；production dependencies 仅 CodeGraph + jieba，无 Mermaid/Chromium。
- packed clean-room smoke: `/tmp/archctx-axr0-consumer.lE7NfY`；tarball-installed `archctx capabilities --json` 与 source handshake 相同，package file scan 无 Mermaid/Puppeteer/Chromium path。

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
