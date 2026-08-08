# Architecture Context 架構文檔

<!-- BEGIN ARCHCONTEXT:generated target="projection_target.entity.capability-architecture-context" sourceDigest="sha256:64d357f43251d115006bd6c6ac3b10c6e2d8c6cc1c75cb5de549eb821669581d" rendererVersion="archcontext.docs-renderer/v1" outputDigest="sha256:f5fa942b7557201becfce915ec6b46fd2806db551bd66e5f141cb0ced1af1188" verifiedAgainst="codex/archctx-capability-docs-projection@74153295e9bbcd5a5145829f8392d018327565c1@2026-07-14T12:32:10+08:00" -->
> **狀態**:`active`
> **Verified against**:`codex/archctx-capability-docs-projection@74153295e9bbcd5a5145829f8392d018327565c1`(2026-07-14)
> **Capability ID**:`capability.architecture-context`(kind `capability`)
> **Matched Prefixes**:`packages/**/src/**`
> **Local Contracts**:未宣告(`extensions.localContracts` 缺失)
> **事實優先級**:倉庫當前狀態 > 本文檔機器區 > 本文檔人工區。機器區(引言、§1、§2)由 ArchContext 從架構模型與 Git 狀態投影生成,手改會在下次投影被覆蓋。

Keeps product and architecture intent available to coding agents.

## 1. P1:能力架構地圖

### 1.1 架構圖

```mermaid
flowchart TD
  cap_packages_core_architecture_domain_src_cee52747["packages/core/architecture-domain/src"]
  cap_packages_core_architecture_ledger_src_adc7ab4e["packages/core/architecture-ledger/src"]
  cap_packages_core_changeset_engine_src_efeb2134["packages/core/changeset-engine/src"]
  cap_packages_core_projection_engine_src_1ba363b9["packages/core/projection-engine/src"]
  cap_packages_core_reconcile_engine_src_5cba0ef6["packages/core/reconcile-engine/src"]
  cap_packages_local_runtime_local_store_sqlite_src_3f0b7e73["packages/local-runtime/local-store-sqlite/src"]
  cap_schemas_runtime_2b8e9723[["schemas/runtime"]]
  cap_packages_local_runtime_runtime_daemon_src_d922395a(["packages/local-runtime/runtime-daemon/src"])
  cap_packages_surfaces_cli_src_bed7d142(["packages/surfaces/cli/src"])
  cap_packages_core_architecture_ledger_src_adc7ab4e --> cap_packages_core_architecture_domain_src_cee52747
  cap_packages_core_architecture_ledger_src_adc7ab4e --> cap_packages_core_changeset_engine_src_efeb2134
  cap_packages_core_projection_engine_src_1ba363b9 --> cap_packages_core_architecture_domain_src_cee52747
  cap_packages_core_reconcile_engine_src_5cba0ef6 --> cap_packages_core_architecture_ledger_src_adc7ab4e
  cap_packages_local_runtime_local_store_sqlite_src_3f0b7e73 --> cap_schemas_runtime_2b8e9723
```

- 圖例:`([...])` 宣告入口所在目錄、`[...]` 能力範圍內目錄、`[[...]]` 能力範圍外的匯入目標目錄。
- 邊:倉庫匯入邊索引解析到真實檔案的 `import` 邊,按目錄聚合去重後 `5` 條(檔案級原始邊 `19` 條);同目錄內部的匯入不畫。
- 節點:僅含參與上述邊的目錄與宣告入口所在目錄;能力範圍共 `63` 個檔案。
- 不含呼叫關係:呼叫索引的軌跡混入型別引用,不作為 P1 邊來源。

### 1.2 模組職責表

| 宣告入口 | 錨點 | 職責 |
| --- | --- | --- |
| `packages/local-runtime/runtime-daemon/src/index.ts` | `packages/local-runtime/runtime-daemon/src/index.ts` | 尚未生成(需符號索引提供行錨點) |
| `packages/surfaces/cli/src/main.ts` | `packages/surfaces/cli/src/main.ts` | 尚未生成(需符號索引提供行錨點) |

### 1.3 規模信號

- 文件數:`63`
- 總行數:`50689`
- 匹配前綴:`packages/**/src/**`
- 排除前綴:`packages/**/test/**`
- 復算:`archctx docs plan --json`(掃描 `source.include` 減 `source.exclude`,跳過 `.git/` 與 `node_modules/`)

### 1.4 依賴邊界

出向關係:

- 無。

入向關係:

- 無。

## 2. P2:端到端數據流

> **半自動生成的候選圖**:participant 名稱直接取機器可得的檔案路徑,本版無語義命名覆寫機制;呼叫索引的呼叫軌跡混入型別引用,可能多列或漏列。修訂意見寫在 §3,本區每次投影都會被覆寫。

```mermaid
sequenceDiagram
  autonumber
  participant seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e as packages/local-runtime/runtime-daemon/src/index.ts
  participant seq_packages_contracts_src_ports_ts_03ef8650 as packages/contracts/src/ports.ts
  participant seq_packages_local_runtime_local_store_sqlite_src_index_ts_a3e10207 as packages/local-runtime/local-store-sqlite/src/index.ts
  participant seq_packages_surfaces_cli_src_main_ts_189d43d7 as packages/surfaces/cli/src/main.ts
  participant seq_packages_contracts_src_schema_ts_578682f9 as packages/contracts/src/schema.ts
  participant seq_packages_core_architecture_domain_src_index_ts_99774adc as packages/core/architecture-domain/src/index.ts
  seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e->>seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e: resolveDaemonIdleTimeoutMs → DEFAULT_DAEMON_IDLE_TIMEOUT_MS()
  seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e->>seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e: resolveDaemonIdleTimeoutMs → DAEMON_IDLE_TIMEOUT_ENV()
  seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e->>seq_packages_contracts_src_ports_ts_03ef8650: constructor → ModelStorePort()
  seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e->>seq_packages_local_runtime_local_store_sqlite_src_index_ts_a3e10207: constructor → RuntimeLocalStore()
  seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e->>seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e: constructor → RuntimeArchitectureLedgerModes()
  seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e->>seq_packages_contracts_src_ports_ts_03ef8650: loadManifest → WorkspaceRef()
  seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e->>seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e: loadModel → loadLedgerModel()
  seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e->>seq_packages_contracts_src_ports_ts_03ef8650: loadModel → WorkspaceRef()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_surfaces_cli_src_main_ts_189d43d7: constructor → runtimeVersionUnsupportedMessage()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e: constructor → RuntimeRpcCompatibilityIssue()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_surfaces_cli_src_main_ts_189d43d7: runCli → runCliUnchecked()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_contracts_src_schema_ts_578682f9: runCli → errorEnvelope()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_surfaces_cli_src_main_ts_189d43d7: runCli → CliRuntimeDeps()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_contracts_src_schema_ts_578682f9: runRuntimeStateCommand → errorEnvelope()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_local_runtime_local_store_sqlite_src_index_ts_a3e10207: runRuntimeStateCommand → runtimeStateRecoveryWorktreeDigest()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_local_runtime_local_store_sqlite_src_index_ts_a3e10207: runRuntimeStateCommand → inspectRuntimeStateRecovery()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_contracts_src_schema_ts_578682f9: runRuntimeStateCommand → okEnvelope()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_surfaces_cli_src_main_ts_189d43d7: runRuntimeStateCommand → readFlag()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_local_runtime_local_store_sqlite_src_index_ts_a3e10207: runRuntimeStateCommand → recoverRuntimeStateTarget()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_core_architecture_domain_src_index_ts_99774adc: runRuntimeStateCommand → computeWorktreeDigest()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e: runRuntimeStateCommand → ledgerRebuild()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_surfaces_cli_src_main_ts_189d43d7: runLedgerCommand → requiredLedgerRuntime()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e: runLedgerCommand → ledgerState()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e: runLedgerCommand → ledgerDrift()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_contracts_src_schema_ts_578682f9: runLedgerCommand → errorEnvelope()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_surfaces_cli_src_main_ts_189d43d7: runLedgerCommand → readFlag()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_surfaces_cli_src_main_ts_189d43d7: runLedgerCommand → normalizeLedgerPromotionTargetMode()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_surfaces_cli_src_main_ts_189d43d7: runLedgerCommand → runLedgerPromotionPreflight()
  seq_packages_surfaces_cli_src_main_ts_189d43d7->>seq_packages_local_runtime_runtime_daemon_src_index_ts_1617897e: runLedgerCommand → ledgerProject()
```

- 入口 `packages/local-runtime/runtime-daemon/src/index.ts`:種子符號 `resolveDaemonIdleTimeoutMs`(:144)、`auditGithubIssuesEnabledInManifestText`(:198)、`constructor`(:801)、`loadManifest`(:807)、`loadModel`(:811);另有頂層函式超出種子預算未列入
- 入口 `packages/surfaces/cli/src/main.ts`:種子符號 `constructor`(:65)、`runCli`(:192)、`runCliUnchecked`(:203)、`runRuntimeStateCommand`(:488)、`runLedgerCommand`(:566);另有頂層函式超出種子預算未列入
- 訊息:`29` 條,全部來自呼叫索引對種子符號回報的呼叫軌跡。
- 錯誤路徑:呼叫索引未提供 throw/error 分支資訊,本圖不列錯誤分支,也不編造。
- 注意:`runRuntimeStateCommand`、`runLedgerCommand` 的呼叫軌跡被索引截斷,訊息可能不完整。
<!-- END ARCHCONTEXT:generated target="projection_target.entity.capability-architecture-context" -->
