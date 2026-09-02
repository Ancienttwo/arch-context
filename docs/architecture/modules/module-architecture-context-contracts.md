# module/architecture-context/contracts 架構文檔

<!-- BEGIN ARCHCONTEXT:generated target="projection_target.entity.module-architecture-context-contracts" sourceDigest="sha256:fc19c60ee82a245b2f8764316f7994d1e758f088cd767fe2f7147fedeff97190" rendererVersion="archcontext.docs-renderer/v4" outputDigest="sha256:44b233e4a661d41ede6045dd93132a0873cc64fb7b4d3dd365597386c2bae200" -->
> **狀態**:`active`
> **Capability ID**:`module.architecture-context.contracts`(kind `module`)
> **Matched Prefixes**:`packages/contracts/src/**`
> **Local Contracts**:未宣告(`extensions.localContracts` 缺失)
> **事實優先級**:倉庫當前狀態 > 本文檔機器區 > 本文檔人工區。機器區(引言、§1、§2)由 ArchContext 從架構模型與源碼度量投影生成,手改會在下次投影被覆蓋。本文檔不記錄出處;本次投影所驗證的 commit 見 `docs/architecture/.projection-manifest.json`。

Declares the shared schema versions, envelope types, digest helpers, and runtime port interfaces that every other workspace imports.

## 1. P1:能力架構地圖

### 1.1 架構圖

> **human-action-required**: P1 semantic authority is unprovable; no diagram was generated.
- `semantic-edge-missing`: module.architecture-context.contracts has no declared in-scope relation

### 1.2 模組職責表

- 未宣告 `source.entrypoints`,入口清單無法從架構模型推導。

### 1.3 規模信號

- 規模量級:`10–20` 個文件 / `2000–5000` 行
- 匹配前綴:`packages/contracts/src/**`
- 排除前綴:`packages/contracts/test/**`
- 推導:掃描 `source.include` 減 `source.exclude`,跳過 `.git/` 與 `node_modules/`,再按 1–2–5 階梯分桶。精確計數不入本文檔:量級足以回答「這個能力有多大」,而逐行計數會讓覆蓋範圍內任何一次源碼改動都改寫本文檔。

### 1.4 依賴邊界

出向關係:

- 無。

入向關係:

- 無。

## 2. P2:端到端數據流

> **human-action-required**: P2 flow evidence is unprovable; no sequence diagram was generated.
- `flow-missing`: no ArchitectureFlowV1 declares module.architecture-context.contracts
<!-- END ARCHCONTEXT:generated target="projection_target.entity.module-architecture-context-contracts" -->

## 3. P3:設計決策與不變量

## 4. 歷史決策記錄(append-only)

## Optimization Backlog
