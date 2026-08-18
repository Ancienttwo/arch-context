# component/architecture-context/projection-renderer 架構文檔

<!-- BEGIN ARCHCONTEXT:generated target="projection_target.entity.component-architecture-context-projection-renderer" sourceDigest="sha256:ed1ab2e6e3071685b795958e30506279c135db0943272fcdb5a9a4fc883aae49" rendererVersion="archcontext.docs-renderer/v4" outputDigest="sha256:e7164cebc433e3eb16c2d1d61332f85bc0afc9cd7bafbedb64a7c99b443f3123" -->
> **狀態**:`active`
> **Capability ID**:`component.architecture-context.projection-renderer`(kind `component`)
> **Matched Prefixes**:未宣告(`source.include` 缺失)
> **Local Contracts**:未宣告(`extensions.localContracts` 缺失)
> **事實優先級**:倉庫當前狀態 > 本文檔機器區 > 本文檔人工區。機器區(引言、§1、§2)由 ArchContext 從架構模型與源碼度量投影生成,手改會在下次投影被覆蓋。本文檔不記錄出處;本次投影所驗證的 commit 見 `docs/architecture/.projection-manifest.json`。

Renders the accepted architecture model into documentation projections and decides each target's provenance stamp.

## 1. P1:能力架構地圖

### 1.1 架構圖

> **human-action-required**: P1 semantic authority is unprovable; no diagram was generated.
- `semantic-edge-missing`: component.architecture-context.projection-renderer has no declared in-scope relation

### 1.2 模組職責表

- 未宣告 `source.entrypoints`,入口清單無法從架構模型推導。

### 1.3 規模信號

- 未宣告 `source.include`,規模信號無法推導。

### 1.4 依賴邊界

出向關係:

- 無。

入向關係:

- `calls` ← `capability.architecture-context` — Project the accepted architecture model into documentation

## 2. P2:端到端數據流

> **human-action-required**: P2 flow evidence is unprovable; no sequence diagram was generated.
- `flow-missing`: no ArchitectureFlowV1 declares component.architecture-context.projection-renderer
<!-- END ARCHCONTEXT:generated target="projection_target.entity.component-architecture-context-projection-renderer" -->

## 3. P3:設計決策與不變量

## 4. 歷史決策記錄(append-only)

## Optimization Backlog
