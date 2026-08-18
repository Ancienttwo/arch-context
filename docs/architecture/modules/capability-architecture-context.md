# Architecture Context 架構文檔

<!-- BEGIN ARCHCONTEXT:generated target="projection_target.entity.capability-architecture-context" sourceDigest="sha256:0d5abd439c7ed63e2b0c4ccdb55bf09937598c880c70f3624b647d61e3ed3c15" rendererVersion="archcontext.docs-renderer/v4" outputDigest="sha256:acbfad5813dfe6378a0e693e95c437aa5e9df1d1844a6f78ff2bfa2a92ee419c" -->
> **狀態**:`active`
> **Capability ID**:`capability.architecture-context`(kind `capability`)
> **Matched Prefixes**:`packages/**/src/**`
> **Local Contracts**:未宣告(`extensions.localContracts` 缺失)
> **事實優先級**:倉庫當前狀態 > 本文檔機器區 > 本文檔人工區。機器區(引言、§1、§2)由 ArchContext 從架構模型與源碼度量投影生成,手改會在下次投影被覆蓋。本文檔不記錄出處;本次投影所驗證的 commit 見 `docs/architecture/.projection-manifest.json`。

Keeps product and architecture intent available to coding agents.

## 1. P1:能力架構地圖

### 1.1 架構圖

```mermaid
flowchart LR
  p1_capability_architecture_context_19e55d58["Architecture Context"]:::component
  p1_component_architecture_context_projection_renderer_53dbb119["Architecture Documentation Renderer"]:::component
  p1_capability_architecture_context_19e55d58 -->|"Project the accepted architecture model into documentation"| p1_component_architecture_context_projection_renderer_53dbb119
  classDef actor fill:#111827,color:#ffffff,stroke:#f9fafb,stroke-width:2px
  classDef component fill:#075985,color:#ffffff,stroke:#bae6fd,stroke-width:2px
  classDef datastore fill:#3f6212,color:#ffffff,stroke:#d9f99d,stroke-width:2px
  classDef external fill:#7c2d12,color:#ffffff,stroke:#fed7aa,stroke-width:2px
```

- Proof: `proven` (`sha256:0e5cec93979df1540b487ecf353b22e79d7ef91572629389070854899892d73a`).
- Semantic nodes: `2`; declared relations: `1`.

### 1.2 模組職責表

| 宣告入口 | 錨點 | 職責 |
| --- | --- | --- |
| `entrypoint.architecture-context.cli` | `packages/surfaces/cli/src/main.ts#buildArchitectureDocsProjection` | `sink.architecture-context.render` → `packages/core/projection-engine/src/index.ts#renderArchitectureDocumentationProjection` |
| `entrypoint.architecture-context.daemon` | `packages/local-runtime/runtime-daemon/src/index.ts#completeTaskProjectionDrift` | `sink.architecture-context.render-daemon` → `packages/core/projection-engine/src/index.ts#renderArchitectureDocumentationProjection` |

### 1.3 規模信號

- 規模量級:`50–100` 個文件 / `50k–100k` 行
- 匹配前綴:`packages/**/src/**`
- 排除前綴:`packages/**/test/**`
- 推導:掃描 `source.include` 減 `source.exclude`,跳過 `.git/` 與 `node_modules/`,再按 1–2–5 階梯分桶。精確計數不入本文檔:量級足以回答「這個能力有多大」,而逐行計數會讓覆蓋範圍內任何一次源碼改動都改寫本文檔。

### 1.4 依賴邊界

出向關係:

- `calls` → `component.architecture-context.projection-renderer` — Project the accepted architecture model into documentation

入向關係:

- 無。

## 2. P2:端到端數據流

> **Proof**: `proven` (`sha256:0e5cec93979df1540b487ecf353b22e79d7ef91572629389070854899892d73a`); selectors `1/1`.

```mermaid
%%{init: {"theme":"base","themeVariables":{"background":"#0d1117","actorBkg":"#312e81","actorBorder":"#c4b5fd","actorTextColor":"#ffffff","signalColor":"#e5e7eb","signalTextColor":"#e5e7eb","labelBoxBkgColor":"#4c1d95","labelBoxBorderColor":"#c4b5fd","labelTextColor":"#ffffff","noteBkgColor":"#78350f","noteBorderColor":"#fcd34d","noteTextColor":"#ffffff","sequenceNumberColor":"#ffffff"}}}%%
sequenceDiagram
  autonumber
  participant p2_trigger_9140ba4a as Architecture Context
  participant p2_renderer_178bc931 as Architecture Documentation Renderer
  p2_trigger_9140ba4a->>p2_renderer_178bc931: Render the projection for an operator-run docs command
  alt The projection plan is renderable
  p2_trigger_9140ba4a->>p2_renderer_178bc931: Emit the projection plan and its per-target stamps
    Note over p2_trigger_9140ba4a: Return the projection plan
  else A declared footprint has no measured scale signal
  p2_trigger_9140ba4a->>p2_renderer_178bc931: Refuse to project rather than print an unmeasured guess
    Note over p2_trigger_9140ba4a: Return a typed projection failure
  end
```
<!-- END ARCHCONTEXT:generated target="projection_target.entity.capability-architecture-context" -->
