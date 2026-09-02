# component/architecture-context/core/architecture-delta 架構文檔

<!-- BEGIN ARCHCONTEXT:generated target="projection_target.entity.component-architecture-context-core-architecture-delta" sourceDigest="sha256:f11f3b3a2e993ff00b67899a306a2fd90ace08ba6c7d557b3f14791823ee6c1a" rendererVersion="archcontext.docs-renderer/v4" outputDigest="sha256:9bfe9737e42126924a035dfa62223c7c4ff989e73ec0544eb6bc2d870a1d7b70" -->
> **狀態**:`active`
> **Capability ID**:`component.architecture-context.core.architecture-delta`(kind `component`)
> **Matched Prefixes**:`packages/core/architecture-delta/src/**`
> **Local Contracts**:未宣告(`extensions.localContracts` 缺失)
> **事實優先級**:倉庫當前狀態 > 本文檔機器區 > 本文檔人工區。機器區(引言、§1、§2)由 ArchContext 從架構模型與源碼度量投影生成,手改會在下次投影被覆蓋。本文檔不記錄出處;本次投影所驗證的 commit 見 `docs/architecture/.projection-manifest.json`。

Maps code changes onto declared architecture subjects and produces candidate architecture deltas with evidence bindings.

## 1. P1:能力架構地圖

### 1.1 架構圖

> **human-action-required**: P1 semantic authority is unprovable; no diagram was generated.
- `semantic-edge-missing`: component.architecture-context.core.architecture-delta has no declared in-scope relation

### 1.2 模組職責表

- 未宣告 `source.entrypoints`,入口清單無法從架構模型推導。

### 1.3 規模信號

- 規模量級:`1–2` 個文件 / `1000–2000` 行
- 匹配前綴:`packages/core/architecture-delta/src/**`
- 推導:掃描 `source.include` 減 `source.exclude`,跳過 `.git/` 與 `node_modules/`,再按 1–2–5 階梯分桶。精確計數不入本文檔:量級足以回答「這個能力有多大」,而逐行計數會讓覆蓋範圍內任何一次源碼改動都改寫本文檔。

### 1.4 依賴邊界

出向關係:

- 無。

入向關係:

- 無。

## 2. P2:端到端數據流

> **human-action-required**: P2 flow evidence is unprovable; no sequence diagram was generated.
- `flow-missing`: no ArchitectureFlowV1 declares component.architecture-context.core.architecture-delta
<!-- END ARCHCONTEXT:generated target="projection_target.entity.component-architecture-context-core-architecture-delta" -->

## 3. P3:設計決策與不變量

## 4. 歷史決策記錄(append-only)

## Optimization Backlog
