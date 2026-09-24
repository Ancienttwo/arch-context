# component/architecture-context/surfaces/cli 架構文檔

<!-- BEGIN ARCHCONTEXT:generated target="projection_target.entity.component-architecture-context-surfaces-cli" sourceDigest="sha256:64813b44534af34156bb830bd6b4256a810183dce82b41861b79d922d5e48246" rendererVersion="archcontext.docs-renderer/v4" outputDigest="sha256:722e041206d69d25b5c8c670d8601752472df4b853c7550a0b62631492164263" -->
> **狀態**:`active`
> **Capability ID**:`component.architecture-context.surfaces.cli`(kind `component`)
> **Matched Prefixes**:`packages/surfaces/cli/src/**`、`packages/surfaces/cli/bin/**`
> **Local Contracts**:未宣告(`extensions.localContracts` 缺失)
> **事實優先級**:倉庫當前狀態 > 本文檔機器區 > 本文檔人工區。機器區(引言、§1、§2)由 ArchContext 從架構模型與源碼度量投影生成,手改會在下次投影被覆蓋。本文檔不記錄出處;本次投影所驗證的 commit 見 `docs/architecture/.projection-manifest.json`。

Provides the archctx command line: the bin launcher with its fast hook-enqueue path and the command dispatcher that drives the runtime daemon.

## 1. P1:能力架構地圖

### 1.1 架構圖

> **human-action-required**: P1 semantic authority is unprovable; no diagram was generated.
- `semantic-edge-missing`: component.architecture-context.surfaces.cli has no declared in-scope relation

### 1.2 模組職責表

- 未宣告 `source.entrypoints`,入口清單無法從架構模型推導。

### 1.3 規模信號

- 規模量級:`2–5` 個文件 / `2000–5000` 行
- 匹配前綴:`packages/surfaces/cli/src/**`、`packages/surfaces/cli/bin/**`
- 推導:掃描 `source.include` 減 `source.exclude`,跳過 `.git/` 與 `node_modules/`,再按 1–2–5 階梯分桶。精確計數不入本文檔:量級足以回答「這個能力有多大」,而逐行計數會讓覆蓋範圍內任何一次源碼改動都改寫本文檔。

### 1.4 依賴邊界

出向關係:

- 無。

入向關係:

- 無。

## 2. P2:端到端數據流

> **human-action-required**: P2 flow evidence is unprovable; no sequence diagram was generated.
- `flow-missing`: no ArchitectureFlowV1 declares component.architecture-context.surfaces.cli
<!-- END ARCHCONTEXT:generated target="projection_target.entity.component-architecture-context-surfaces-cli" -->

## 3. P3:設計決策與不變量

## 4. 歷史決策記錄(append-only)

## Optimization Backlog
