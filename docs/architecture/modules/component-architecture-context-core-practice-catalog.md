# component/architecture-context/core/practice-catalog 架構文檔

<!-- BEGIN ARCHCONTEXT:generated target="projection_target.entity.component-architecture-context-core-practice-catalog" sourceDigest="sha256:2a73ac2d3246a2830c17933e887e5e9284c82b2d1e1b2e13567cc3c57ca4fcdb" rendererVersion="archcontext.docs-renderer/v4" outputDigest="sha256:01eb3b86ed65e2c16ff0bc613630e88bf28ae95327a11871bdbebbfd530ba8c3" -->
> **狀態**:`active`
> **Capability ID**:`component.architecture-context.core.practice-catalog`(kind `component`)
> **Matched Prefixes**:`packages/core/practice-catalog/src/**`、`packages/core/practice-catalog/assets/**`
> **Local Contracts**:未宣告(`extensions.localContracts` 缺失)
> **事實優先級**:倉庫當前狀態 > 本文檔機器區 > 本文檔人工區。機器區(引言、§1、§2)由 ArchContext 從架構模型與源碼度量投影生成,手改會在下次投影被覆蓋。本文檔不記錄出處;本次投影所驗證的 commit 見 `docs/architecture/.projection-manifest.json`。

Loads and validates practice assets, sources, and profiles into an effective practice catalog.

## 1. P1:能力架構地圖

### 1.1 架構圖

> **human-action-required**: P1 semantic authority is unprovable; no diagram was generated.
- `semantic-edge-missing`: component.architecture-context.core.practice-catalog has no declared in-scope relation

### 1.2 模組職責表

- 未宣告 `source.entrypoints`,入口清單無法從架構模型推導。

### 1.3 規模信號

- 規模量級:`10–20` 個文件 / `2000–5000` 行
- 匹配前綴:`packages/core/practice-catalog/src/**`、`packages/core/practice-catalog/assets/**`
- 推導:掃描 `source.include` 減 `source.exclude`,跳過 `.git/` 與 `node_modules/`,再按 1–2–5 階梯分桶。精確計數不入本文檔:量級足以回答「這個能力有多大」,而逐行計數會讓覆蓋範圍內任何一次源碼改動都改寫本文檔。

### 1.4 依賴邊界

出向關係:

- 無。

入向關係:

- 無。

## 2. P2:端到端數據流

> **human-action-required**: P2 flow evidence is unprovable; no sequence diagram was generated.
- `flow-missing`: no ArchitectureFlowV1 declares component.architecture-context.core.practice-catalog
<!-- END ARCHCONTEXT:generated target="projection_target.entity.component-architecture-context-core-practice-catalog" -->

## 3. P3:設計決策與不變量

## 4. 歷史決策記錄(append-only)

## Optimization Backlog
