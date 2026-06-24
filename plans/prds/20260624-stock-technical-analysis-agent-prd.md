# 股票技术分析 Agent PRD

**产品暂名：** Technical Chart Analyst
**版本：** v0.1
**状态：** Draft
**日期：** 2026-06-24
**主要形态：** 对话式 Agent / Skill + 后端行情与技术分析工具

---

## 1. 产品摘要

本产品允许用户通过两种方式获得股票、ETF、指数、期货或加密资产的技术分析：

1. **视觉模式**：用户上传图表截图，Agent 根据图中可见的价格结构、成交量、RSI、MACD、均线等内容进行分析。
2. **数据验证模式**：用户连接自己的行情数据 API。系统在分析时按需获取缺失的 OHLCV，写入该用户专属的数据空间，使用确定性计算引擎计算指标和识别形态，再由 Agent 解释结果。

产品不预先同步整个市场，而采用：

> **按需回填 + 增量更新 + 用户级缓存**

当某个用户第一次查询某标的及周期时，系统拉取满足分析所需的历史窗口；后续查询复用本地数据，并只补充缺失区间。

### 1.1 核心产品决策

- 没有数据 API 时，产品仍可完成截图视觉分析。
- 有用户数据 API 时，优先使用 OHLCV 做指标和形态验证。
- LLM 不直接计算 RSI、MACD 或形态几何条件；确定性引擎负责计算，LLM 负责解释。
- 用户 API 密钥永远不进入模型上下文、Skill 文件、日志或分析结果。
- 用户 API 获取的原始行情默认按租户隔离，不跨用户共享或合并成公共行情池。
- 自定义数据接入优先支持“统一 OHLCV 网关协议”，而不是首版支持任意 URL、任意分页和任意 JSON 映射。
- 所有技术结论都区分“视觉观察”“数据计算”“推断”，并展示数据来源、时间、周期、复权和完整性。

---

## 2. 背景与问题

用户经常以截图形式询问：

- 这个图是不是双顶？
- RSI 背离是否成立？
- 这是放量突破还是假突破？
- 当前是上升趋势还是区间震荡？
- 支撑、阻力和失效位置在哪里？

纯视觉方案上线快、单次成本低，但存在以下问题：

- 小字号坐标、指标参数和时间轴可能无法准确读取。
- 两个价格高点与两个 RSI 高点的对应关系容易出现视觉误差。
- 视觉模型可能把“候选形态”说成“已确认形态”。
- 截图无法提供完整历史窗口，可能遗漏形态前置结构。
- 不同图表平台的复权、交易时段和数据源可能不同。

另一方面，直接购买覆盖所有市场的行情许可成本高，且用户可能已经拥有自己的数据订阅。因此，本产品通过 BYO Data API 让用户使用自己的数据权限，同时以机会式同步逐渐建立其专属 OHLCV 数据缓存。

---

## 3. 产品目标

### 3.1 目标

1. 用户只上传截图，也能快速获得结构化技术分析。
2. 用户连接数据 API 后，可以获得可验证、可重复的指标和形态结果。
3. 系统按查询需求逐步积累用户专属 OHLCV，而不是预先同步全市场。
4. 同一份 OHLCV 可以重复用于多个指标、形态和后续问题，降低模型调用成本。
5. 每个结论包含证据、确认条件、失效条件、置信度和数据来源。
6. 用户能够控制 API 凭证、数据保存策略、删除和断开连接。
7. 系统能够持续评估视觉识别、工具调用、指标计算和形态判断的准确度。

### 3.2 非目标

MVP 不包括：

- 个性化买卖指令或收益保证。
- 自动下单、券商交易和资产托管。
- Level 2 订单簿、Footprint、逐笔订单流分析。
- 基本面估值、新闻情绪和组合优化。
- 全市场实时行情基础设施。
- 任意第三方 REST API 的无约束执行。
- 将某个用户 API 获取的数据提供给其他用户。
- 对图表形态进行未来收益承诺。

---

## 4. 用户角色

### 4.1 截图型用户

没有行情 API，只希望上传 TradingView、券商或交易软件截图，快速获得技术面解读。

### 4.2 数据型高级用户

拥有行情提供商 API，希望产品使用其 API 获取 OHLCV、保存历史数据并进行更精确的技术分析。

### 4.3 自建数据用户

拥有自己的数据库或行情聚合服务，希望通过统一接口把数据提供给 Agent，而不把上游供应商密钥交给平台。

### 4.4 平台管理员或开发者

负责新增数据提供商适配器、监控数据质量、控制算法版本、排查工具调用和安全事件。

---

## 5. 关键用户故事

### US-01：截图分析

作为用户，我上传一张股票图表截图并提问，系统应识别可见的趋势、支撑阻力、成交量和指标，并清楚标注不确定内容。

### US-02：连接数据 API

作为高级用户，我可以选择数据提供商、输入 API 凭证并测试连接。连接成功后，凭证不可再次明文显示。

### US-03：按需同步

作为高级用户，当我查询某标的时，系统应先检查本地 OHLCV 覆盖范围，只拉取缺失区间并写入我的数据空间。

### US-04：数据验证

作为用户，我希望看到某个形态是“视觉候选”“数据确认”“已失效”还是“信息不足”，而不是只有主观描述。

### US-05：直接查询标的

作为用户，我可以不上传截图，直接输入“分析 AAPL 日线 RSI、MACD 和关键位”，系统使用已连接数据源完成分析。

### US-06：来源透明

作为用户，我可以看到数据提供商、feed、截止时间、延迟、复权方式、交易时段、最后一根 K 线是否收盘。

### US-07：控制保存

作为用户，我可以选择不保存、会话缓存、滚动保存或长期保存；也可以删除某个标的、整个连接的数据或全部数据。

### US-08：自建网关

作为自建数据用户，我可以提供一个符合平台规范的 OHLCV 网关地址和访问令牌，让平台调用我的服务，而不是直接保存上游供应商密钥。

### US-09：错误回退

作为用户，当 API 限流、数据缺失或连接失效时，系统应回退为视觉分析或基于已有缓存分析，并明确说明局限。

---

## 6. 产品模式

### 6.1 Visual Only

输入：截图 + 用户问题。
输出：仅基于截图的技术分析。

必须显示：

- `analysis_mode = visual_only`
- 可见内容和不可见内容
- 是否能确认 symbol、timeframe、时间范围
- 所有数值是否只是视觉估计
- 低置信度原因

### 6.2 Data Verified

输入：symbol、timeframe、时间范围、用户数据连接。
输出：完全基于 OHLCV 和计算结果的技术分析。

必须显示：

- `analysis_mode = data_verified`
- 数据来源和最新时间
- 指标参数
- 形态算法版本
- 数据质量和覆盖率

### 6.3 Hybrid

输入：截图 + 用户数据连接。
处理：视觉识别用户正在看的标的、周期、区域和画线；OHLCV 引擎验证指标和形态。
输出：将视觉证据与数值证据分开呈现。

必须显示：

- `analysis_mode = hybrid`
- 图中观察到的内容
- 数据引擎计算出的内容
- 二者是否一致
- 若不一致，可能原因：周期、复权、盘前盘后、数据源、指标参数或截图截止时间不同

---

## 7. 核心流程

### 7.1 截图分析流程

1. 用户上传截图并提问。
2. 视觉模型提取结构化图表元数据：
   - symbol / exchange
   - timeframe
   - 截图截止时间
   - 可见指标
   - 指标参数是否可读
   - 图表平台和主题
   - 用户画线、框选或箭头
   - 候选技术形态
3. 路由器判断能否匹配用户的数据连接。
4. 若无法匹配，则进入 Visual Only。
5. 若可匹配，则检查本地 OHLCV 覆盖范围。
6. 数据网关向用户 API 拉取缺失区间。
7. 标准化、校验并写入数据库。
8. 指标引擎和形态引擎生成 Evidence JSON。
9. Agent 根据截图和 Evidence JSON 输出用户可读结论。

### 7.2 直接标的查询流程

1. 用户输入 symbol、timeframe 和问题。
2. 系统解析标的，处理同名 ticker 和交易所歧义。
3. 计算所需 lookback。
4. 查询本地覆盖范围。
5. 拉取缺失区间并写入。
6. 计算指标、结构和形态。
7. 输出分析。

### 7.3 API 连接流程

1. 用户进入“数据源”页面。
2. 选择：
   - 已支持的数据提供商
   - 自建 OHLCV 网关
3. 选择认证方式：API Key、Bearer Token 或 OAuth。
4. 输入凭证、域名和必要配置。
5. 系统执行连接测试：
   - 认证是否有效
   - 是否能查询示例 symbol
   - 返回字段是否符合规范
   - 时间戳、时区和分页是否正确
6. 用户确认数据保存政策及其拥有相应存储和分析权限。
7. 密钥写入 Secrets Manager；业务数据库只保存 `secret_ref`。
8. 连接状态变为 `active`。

---

## 8. 推荐的 BYO Data API 设计

### 8.1 接入层级

#### 方案 A：内置 Provider Adapter

平台为常见数据提供商编写适配器，用户只提交密钥。

优点：

- 用户体验最好。
- 字段、分页、限流和错误处理可控。
- 易于设置提供商特定的保存政策。

缺点：

- 每个提供商都需要维护。
- 上游 API 变更需要适配。

#### 方案 B：用户自建标准 OHLCV Gateway

用户提供一个符合平台协议的接口。上游密钥可以留在用户自己的服务器中，平台只持有访问该 Gateway 的令牌。

这是首版支持任意数据源时的推荐方案。

优点：

- 平台不需要理解每家供应商的原始响应。
- 用户可以在自己的网关内完成授权、字段映射和许可控制。
- 显著降低平台持有第三方主密钥的风险。

缺点：

- 用户需要具备一定开发能力。
- 仍需验证用户有权让平台处理和保存相关数据。

#### 方案 C：任意 REST API Mapping

用户输入 Base URL、Endpoint Template、认证规则、JSONPath、分页和字段映射。

不建议放入 MVP，原因包括：

- SSRF 风险高。
- URL、重定向、DNS 和私网访问验证复杂。
- 每家 API 的分页、限流、时间格式和错误语义不同。
- 映射错误会产生静默错误行情。
- 支持成本高。

### 8.2 标准 OHLCV Gateway 协议

#### 搜索标的

```http
GET /v1/instruments/search?q=AAPL&asset_type=equity
Authorization: Bearer <token>
```

示例响应：

```json
{
  "schema_version": "1.0",
  "instruments": [
    {
      "symbol": "AAPL",
      "exchange": "XNAS",
      "name": "Apple Inc.",
      "asset_type": "equity",
      "currency": "USD",
      "timezone": "America/New_York"
    }
  ]
}
```

#### 获取 K 线

```http
GET /v1/bars?symbol=AAPL&exchange=XNAS&timeframe=1d&start=2025-01-01T00:00:00Z&end=2026-06-24T00:00:00Z&adjustment=split&session=regular
Authorization: Bearer <token>
```

示例响应：

```json
{
  "schema_version": "1.0",
  "request_id": "req_123",
  "instrument": {
    "symbol": "AAPL",
    "exchange": "XNAS",
    "asset_type": "equity",
    "currency": "USD",
    "timezone": "America/New_York"
  },
  "timeframe": "1d",
  "adjustment": "split",
  "session": "regular",
  "bars": [
    {
      "timestamp": "2026-06-23T20:00:00Z",
      "open": 100.0,
      "high": 104.2,
      "low": 99.4,
      "close": 103.8,
      "volume": 54123000,
      "is_final": true
    }
  ],
  "next_cursor": null,
  "source": {
    "provider": "user_gateway",
    "feed": "configured_by_user",
    "delayed_seconds": 900
  }
}
```

### 8.3 Gateway 强制要求

- 只支持 HTTPS。
- 返回 `application/json`。
- 时间戳统一为 ISO 8601 UTC。
- OHLC 字段不得为空，Volume 可按资产类别允许为空。
- 必须声明 timezone、timeframe、adjustment、session 和 feed。
- 单次响应大小、bar 数量和分页长度有限制。
- 不允许自动跟随重定向。
- 不允许访问 localhost、私有地址、链路本地地址或云元数据地址。
- 响应必须通过 JSON Schema 校验后才能写库。

---

## 9. 数据保存政策

每个连接必须设置 `storage_policy`：

| 策略 | 行为 | 适用场景 |
|---|---|---|
| `no_store` | 仅在内存中处理，分析结束即删除 | 提供商不允许缓存 |
| `session_cache` | 保存至短期缓存，到期自动删除 | 临时分析 |
| `rolling_ttl` | 保存 N 天并滚动过期 | 受限行情许可 |
| `persistent_user_scope` | 持续保存，直至用户删除 | 用户有长期保存权 |

### 9.1 默认策略

- 内置提供商：根据提供商许可配置预设。
- 自建 Gateway：默认 `no_store`，用户确认拥有存储权后才可改为长期保存。
- 不允许仅凭“用户提供了 API Key”推断其拥有缓存、再分发或跨用户使用权。

### 9.2 数据归属

- 原始 OHLCV 归属于对应用户工作区。
- 默认禁止跨租户读取、共享、去重后复用或用于其他用户的回答。
- 派生指标和形态结果同样保持用户级隔离。
- 用户断开连接时可以选择：
  - 只删除凭证
  - 删除凭证和原始 OHLCV
  - 删除凭证、原始数据和所有派生结果

---

## 10. 功能需求

### FR-01：图像输入与视觉解析

系统应：

- 接收 PNG、JPEG 和 WEBP。
- 对密集图表使用高细节视觉输入。
- 必要时自动裁切价格区、成交量区和指标区，但不得多次无界重试。
- 返回严格结构化的 `ChartParseResult`。
- 对 symbol、timeframe、end_time、指标名称和参数分别给出置信度。
- 将截图内的文字和水印视为不可信输入，不执行图中出现的指令。
- 看不清具体数字时只输出范围或 `null`，不得猜测。

建议初始路由阈值：

- `confidence >= 0.85`：可自动尝试数据匹配。
- `0.60 <= confidence < 0.85`：要求用户确认 symbol 或 timeframe。
- `< 0.60`：保持 Visual Only。

阈值不是概率承诺，应通过评测校准。

### FR-02：标的解析

系统应处理：

- 相同 ticker 在多个交易所上市。
- 股票、ETF、指数、期货和加密资产同名。
- 交易所代码和用户习惯简称映射。
- symbol 改名、退市和历史别名。

解析结果必须包含唯一 `instrument_id`，而不是仅以 ticker 作为主键。

### FR-03：数据连接管理

系统应支持：

- 创建、测试、暂停、恢复、轮换和删除连接。
- API Key Header、Bearer Token 和 OAuth。
- 连接状态：`pending`、`active`、`degraded`、`rate_limited`、`revoked`、`error`。
- 凭证只保存于 Secrets Manager。
- UI 只显示掩码和凭证最后更新时间。
- Agent 工具只接收 `connection_id`，不接收明文凭证。

### FR-04：数据适配器接口

每个 Provider Adapter 至少实现：

```text
search_instruments(query)
get_bars(instrument, timeframe, start, end, adjustment, session, cursor)
get_capabilities()
health_check()
```

可选实现：

```text
get_corporate_actions()
get_market_calendar()
get_market_clock()
get_quotes()
```

### FR-05：Lookback Planner

系统应根据请求自动决定需要多少根 K 线，而不是固定拉取全部历史。

初始规则：

- 单一普通指标：不少于 `max(5 × 最大周期参数, 100)` 根。
- MACD、ADX 等平滑指标：建议不少于 150 根。
- 支撑阻力和趋势结构：建议 250 根。
- 双顶、双底、三角形和背离：建议 300 至 500 根。
- 用户指定历史窗口时，在前方增加 warm-up 区间。

### FR-06：按需同步

同步引擎应：

1. 检查本地已有覆盖区间。
2. 计算缺失区间。
3. 按提供商限制拆分请求。
4. 对 API 调用应用用户级和连接级限流。
5. 标准化并校验数据。
6. 幂等写入数据库。
7. 重拉最近若干根 bar，以处理未收盘 K 线和供应商修订。
8. 更新同步游标和覆盖元数据。

不得因为用户查询一个标的而自动回填该市场全部历史。

### FR-07：OHLCV 标准化

统一字段：

```text
tenant_id
connection_id
instrument_id
symbol
exchange
asset_type
timeframe
timestamp_utc
open
high
low
close
volume
trade_count 可选
vwap 可选
source
feed
adjustment
session
is_final
fetched_at
provider_revision 可选
```

必须执行数据质量检查：

- `high >= max(open, close, low)`
- `low <= min(open, close, high)`
- 价格非负且在合理范围内
- volume 非负
- 时间戳顺序正确
- 同一唯一键不能出现未处理的重复 bar
- 检测异常缺口、重复、乱序和周期不一致
- 无效数据进入隔离区，不能直接参与分析

### FR-08：复权与交易时段

系统必须记录并展示：

- `raw`、`split`、`dividend` 或 `all` 等复权方式。
- `regular`、`extended` 或 `all` 交易时段。
- 数据源所在交易所时区。
- 最后一根 K 线是否收盘。

禁止把不同复权方式、不同 session 或不同 feed 的 bar 拼成同一连续序列。

### FR-09：指标引擎

MVP 指标：

- SMA / EMA
- RSI
- MACD
- Bollinger Bands
- ATR / NATR
- ADX
- Stochastic
- OBV
- MFI
- VWAP：仅在数据粒度与 session 允许时

要求：

- 确定性计算。
- 指标参数可版本化。
- 数据不足时返回 `insufficient_history`，不得填充虚假数值。
- 输出 value、signal、parameters、timestamp、validity 和 algorithm_version。
- 与图中可见指标对比时，若参数或数据口径不同，必须说明不可直接比较。

### FR-10：结构与形态引擎

MVP 支持：

- 趋势：uptrend、downtrend、range、transition
- swing high / swing low
- higher high / higher low / lower high / lower low
- 支撑和阻力区域
- 突破和假突破
- 双顶和双底
- 上升、下降和对称三角形
- RSI 顶背离和底背离
- 成交量确认或不确认

形态状态统一为：

```text
candidate
confirmed
invalidated
insufficient_evidence
```

每个形态必须输出：

```json
{
  "name": "double_top",
  "direction": "bearish",
  "status": "candidate",
  "start_time": "...",
  "end_time": "...",
  "anchor_points": [],
  "confirmation_level": null,
  "invalidation_level": null,
  "confidence_score": 0.72,
  "evidence": [],
  "missing_confirmation": [],
  "algorithm_version": "pattern-engine-0.1"
}
```

`confidence_score` 是内部规则评分，不应向用户描述为真实发生概率，除非经过统计校准。

### FR-11：Agent 输出

用户可读结果至少包括：

1. 一句话结论
2. 当前趋势和市场结构
3. 可见指标与数据计算指标
4. 候选或确认形态
5. 支撑、阻力和关键确认位
6. 偏多和偏空情景
7. 失效条件
8. 数据来源与更新时间
9. 局限与置信度
10. 非投资建议声明

禁止：

- 把候选形态说成已确认。
- 在无精确数据时给出精确 RSI 或价格数值。
- 隐藏数据延迟、缺口或最后一根 K 线未收盘。
- 使用“必涨”“必跌”“稳赚”等确定性语言。

### FR-12：数据管理界面

用户可以查看：

- 已连接的数据源。
- 连接健康状态和最近错误。
- 已缓存的标的、周期、起止时间和占用量。
- 每个数据集的来源、复权、session 和 feed。
- 删除、重新同步和修改保存政策操作。

---

## 11. Agent 与 Skill 设计

### 11.1 Skill 目录

```text
stock-technical-analysis/
├── SKILL.md
└── references/
    ├── analysis-policy.md
    ├── pattern-definitions.md
    ├── tool-contracts.md
    └── output-schema.md
```

测试素材不应作为每次请求的运行时上下文：

```text
evals/
├── screenshots/
├── ohlcv-fixtures/
├── labels.jsonl
└── graders/
```

### 11.2 Skill 职责

Skill 负责：

- 何时进入视觉、数据验证或混合模式。
- 如何处理看不清的 symbol、周期和数值。
- 何时调用技术分析工具。
- 如何区分候选、确认、失效和信息不足。
- 输出顺序、语言和风险表述。

Skill 不负责：

- 保存或读取明文 API Key。
- 直接向任意 URL 发请求。
- 在模型上下文内运行指标公式。
- 自行决定跨租户共享数据。

### 11.3 推荐工具面

不要向模型暴露大量底层数据工具。推荐提供一个高层、幂等的分析工具：

```text
analyze_technical_market(
  connection_id,
  instrument_hint,
  timeframe,
  end_time,
  requested_indicators,
  requested_patterns,
  chart_parse_result
)
```

后端工具内部完成：

- 标的解析
- coverage 检查
- 缺失数据拉取
- 标准化与写库
- 指标和形态计算
- provenance 生成

辅助只读工具：

```text
get_data_source_status(connection_id)
get_analysis_provenance(analysis_id)
```

连接创建、删除、凭证轮换建议主要通过受控 UI 完成；若通过 Agent 操作，应使用工具级校验和明确确认。

### 11.4 结构化输出

模型必须先生成符合 JSON Schema 的结果，再由 UI 渲染。核心字段建议：

```json
{
  "analysis_mode": "hybrid",
  "chart_identity": {},
  "data_provenance": {},
  "market_structure": {},
  "indicators": [],
  "patterns": [],
  "levels": [],
  "bullish_scenario": {},
  "bearish_scenario": {},
  "limitations": [],
  "confidence": "medium",
  "user_summary": ""
}
```

---

## 12. 系统架构

```text
┌──────────────────────────────────────────────┐
│ Client / Chat UI / ChatGPT Skill            │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ Agent Orchestrator                           │
│ - mode routing                               │
│ - strict tool schema                         │
│ - output schema                              │
└───────────────┬──────────────────┬───────────┘
                │                  │
                ▼                  ▼
┌──────────────────────┐  ┌──────────────────────┐
│ Vision Parser        │  │ Technical Analysis   │
│ - chart metadata     │  │ Composite Tool       │
│ - visual candidates  │  └──────────┬───────────┘
└──────────────────────┘             │
                                     ▼
                         ┌────────────────────────┐
                         │ Market Data Gateway    │
                         │ - tenant authorization │
                         │ - rate limiting        │
                         │ - provider routing     │
                         └───────┬────────┬───────┘
                                 │        │
                                 ▼        ▼
                        ┌────────────┐ ┌──────────────┐
                        │ Secret     │ │ Provider /   │
                        │ Broker     │ │ User Gateway │
                        └────────────┘ └──────┬───────┘
                                             │
                                             ▼
                              ┌────────────────────────┐
                              │ Normalizer + DQ        │
                              └──────────┬─────────────┘
                                         │
                                         ▼
                              ┌────────────────────────┐
                              │ Time-series Database   │
                              └────────┬─────────┬─────┘
                                       │         │
                                       ▼         ▼
                              ┌────────────┐ ┌────────────┐
                              │ Indicator  │ │ Pattern    │
                              │ Engine     │ │ Engine     │
                              └──────┬─────┘ └─────┬──────┘
                                     └──────┬──────┘
                                            ▼
                               ┌───────────────────────┐
                               │ Evidence JSON         │
                               └──────────┬────────────┘
                                          ▼
                               ┌───────────────────────┐
                               │ Agent Explanation     │
                               └───────────────────────┘
```

### 12.1 推荐技术栈

- 服务端：Python + FastAPI，便于指标计算和数据处理。
- 时序数据库：PostgreSQL + TimescaleDB。
- 队列与限流：Redis 或托管消息队列。
- 冷数据：对象存储 + Parquet，后续按规模引入。
- Secrets：云 Secrets Manager 或 Vault。
- 技术指标：TA-Lib 或经过验证的内部实现。
- 形态识别：自定义、版本化规则引擎。
- Agent：视觉输入 + Function Calling + Structured Outputs。
- 观测：结构化日志、指标、分布式 trace 和分析 run replay。

---

## 13. 数据模型

### 13.1 `data_connections`

```text
id
tenant_id
provider_type
auth_type
secret_ref
base_domain
storage_policy
retention_days
capabilities_json
status
terms_attested_at
terms_version
created_at
updated_at
last_health_check_at
```

### 13.2 `instruments`

```text
id
canonical_symbol
exchange
asset_type
name
currency
timezone
active_from
active_to
metadata_json
```

### 13.3 `instrument_aliases`

```text
instrument_id
provider_type
provider_symbol
provider_exchange
valid_from
valid_to
```

### 13.4 `market_bars`

```text
tenant_id
connection_id
instrument_id
timeframe
timestamp_utc
open
high
low
close
volume
trade_count
vwap
source
feed
adjustment
session
is_final
fetched_at
quality_status
```

推荐唯一键：

```text
(
  tenant_id,
  connection_id,
  instrument_id,
  timeframe,
  timestamp_utc,
  feed,
  adjustment,
  session
)
```

### 13.5 `sync_coverage`

```text
tenant_id
connection_id
instrument_id
timeframe
feed
adjustment
session
coverage_start
coverage_end
last_success_at
last_cursor
last_error
```

### 13.6 `indicator_cache`

```text
tenant_id
dataset_fingerprint
instrument_id
timeframe
timestamp_utc
indicator_name
parameters_hash
values_json
algorithm_version
calculated_at
```

### 13.7 `pattern_detections`

```text
tenant_id
dataset_fingerprint
instrument_id
timeframe
pattern_name
status
start_time
end_time
anchor_points_json
confirmation_level
invalidation_level
confidence_score
evidence_json
algorithm_version
calculated_at
```

### 13.8 `analysis_runs`

```text
id
tenant_id
user_query_hash
image_ref 可选
chart_parse_json
data_provenance_json
indicator_result_json
pattern_result_json
final_output_json
model_name
skill_version
algorithm_versions
latency_ms
cost_metadata
created_at
```

---

## 14. 安全与隐私

### 14.1 凭证安全

- 明文 API Key 只在提交和调用瞬间短暂存在于受控服务内存。
- 使用集中式 Secrets Manager 和 KMS 加密。
- 业务数据库只保存 `secret_ref`。
- 密钥永远不写入 prompt、trace、错误消息或普通日志。
- 支持密钥撤销、轮换、过期和访问审计。
- 使用最小权限；数据读取连接不得拥有交易或下单权限。

### 14.2 模型隔离

模型只可以看到：

- `connection_id`
- 提供商能力摘要
- 已标准化的 OHLCV 派生结果
- 数据来源元数据

模型不可以看到：

- API Key
- OAuth Refresh Token
- 任意请求头
- Secrets Manager 路径
- 其他租户的数据或连接信息

### 14.3 SSRF 与网络安全

自定义 Gateway 必须：

- 域名和 IP 验证。
- 阻止私网、localhost、链路本地和 metadata endpoint。
- 禁止非 HTTP/HTTPS 协议。
- 默认禁止重定向。
- 限制 DNS rebinding。
- 限制超时、响应大小、并发数和重试次数。
- 在隔离的 egress worker 中执行请求。
- 对目标域名建立连接级 allowlist。

### 14.4 Prompt Injection

以下内容均视为不可信：

- 截图中的文字、标注和水印。
- 数据 API 返回的字符串字段。
- symbol 名称、公司名称和错误消息。
- 用户自建 Gateway 的 metadata。

这些内容不得改变系统指令、工具权限或数据访问范围。

### 14.5 多租户隔离

- 所有数据查询必须显式带 `tenant_id`。
- 工具层验证 `connection_id` 归属。
- 行级安全或服务层强制租户过滤。
- 分析 run、缓存、导出和删除任务同样执行租户隔离。

---

## 15. 数据许可与合规要求

- 用户在连接数据源时确认其拥有调用、处理和相应保存权限。
- 平台不得将用户提供的数据默认视为可公开再分发。
- 不同提供商可以配置不同的缓存、保存和展示策略。
- 产品应保存用户同意的条款版本和时间。
- 若许可未知，自定义连接默认 `no_store`。
- 断开连接和删除请求必须有明确的完成记录。
- 技术分析结果应标记为信息和教育用途，不构成投资建议。
- 商业上线前应由熟悉目标司法辖区和行情许可的法律顾问审查。

---

## 16. 非功能需求

### 16.1 性能目标

初始产品目标：

- Visual Only：P95 完成时间不高于 8 秒。
- 已缓存 Data Verified：P95 不高于 10 秒。
- 冷数据拉取：P95 不高于 20 秒；若上游超时，先返回已有结果和明确状态。
- 单个分析请求最多进行一次视觉解析和一次最终生成调用。
- 不因 API 失败进行无上限模型重试。

### 16.2 可用性

- MVP 服务目标：99.5%。
- 上游数据源故障不得导致整个 Agent 不可用。
- 数据连接故障时可回退到 Visual Only 或已有缓存。

### 16.3 可观测性

每个分析 run 记录：

- 模式路由结果
- 模型和 Skill 版本
- 工具调用序列
- 数据源和覆盖范围
- 上游 API 延迟与状态
- 数据质量错误
- 指标和形态算法版本
- Token、计算和上游请求成本
- 用户反馈

---

## 17. 指标体系

### 17.1 产品指标

- 首次截图分析完成率
- 数据源连接成功率
- 连接后首次 Data Verified 转化率
- 数据验证模式占比
- 7 日和 30 日重复使用率
- 用户反馈有帮助比例

### 17.2 数据指标

- 本地 OHLCV cache hit rate
- 每次分析平均上游 API 请求数
- 每个连接的限流率和失败率
- 缺失 bar、重复 bar、异常 bar 比率
- 数据源与截图数值不一致率

### 17.3 模型与算法指标

- symbol 识别准确率
- timeframe 识别准确率
- 可见指标识别准确率
- 无依据精确数字率
- pattern precision / recall / F1
- candidate 被错误描述为 confirmed 的比例
- 工具选择正确率
- 最终输出 Schema 合规率

### 17.4 安全指标

- API Key 明文日志事件：必须为 0
- 跨租户访问事件：必须为 0
- 非允许域名网络请求：必须为 0
- 被拒绝的 SSRF 请求数量
- 密钥轮换和撤销成功率

---

## 18. 评测方案

### 18.1 视觉测试集

至少覆盖：

- 明暗主题
- 多种图表平台
- 日线、小时和分钟周期
- 高分辨率、模糊、裁剪和压缩截图
- 中英文图表文字
- 多个指标面板
- 用户画线、箭头和框选
- symbol 或 timeframe 缺失
- 价格轴或时间轴缺失

### 18.2 OHLCV Fixture

使用人工构造和真实历史片段建立可重复测试：

- RSI、MACD、ATR 等指标参考值
- 趋势和摆动点
- 双顶/双底正例、反例和边界例
- 有效突破、影线突破和假突破
- RSI 背离与伪背离
- 数据缺口、拆股和未收盘 K 线

### 18.3 双通道一致性评测

对同一标的同时提供截图和 OHLCV，检查：

- symbol、周期和时间范围是否对齐
- 视觉候选与数值验证是否一致
- 不一致时是否正确解释复权、session、参数或数据源差异

### 18.4 Launch Gate 建议

- 图中 symbol 清晰时识别准确率 ≥ 95%。
- 图中 timeframe 清晰时识别准确率 ≥ 90%。
- 确定性指标与参考实现误差在定义容差内。
- `confirmed` 形态 precision ≥ 90%。
- 无依据的精确数值输出率 < 1%。
- 输出 Schema 合规率 ≥ 99.5%。
- API Key 明文泄露测试通过率 100%。

这些阈值应根据实际测试集难度调整。

---

## 19. MVP 范围

### 19.1 包含

- 截图 Visual Only。
- Hybrid 分析。
- 两个以内置 Provider Adapter，具体取决于目标市场。
- 标准 OHLCV Gateway。
- 1D、1H、15m 三种周期。
- SMA、EMA、RSI、MACD、Bollinger、ATR、ADX、Stochastic、OBV。
- 趋势、区间、支撑阻力、突破、假突破、双顶、双底、三角形、RSI 背离和成交量确认。
- 按需回填和增量更新。
- 用户级数据保存和删除。
- 数据来源与分析证据展示。
- 离线截图和 OHLCV 评测集。

### 19.2 不包含

- 任意 REST JSON Mapping。
- 定时全市场同步。
- Level 2、逐笔和订单流。
- 自动交易。
- 回测和策略优化。
- 跨用户共享原始行情。
- 用户自定义 Python 指标代码。

---

## 20. 后续阶段

### Phase 0：离线验证

- 完成指标引擎和形态定义。
- 构建截图与 OHLCV 测试集。
- 验证视觉元数据提取和结构化输出。

### Phase 1：MVP

- 上线 Visual Only。
- 上线内置 Provider Adapter。
- 上线标准 OHLCV Gateway。
- 上线按需同步和用户数据管理。

### Phase 2：增强

- 定时增量同步。
- 更多市场和周期。
- 自定义 REST Mapping，但仅在完整 SSRF 防护后开放。
- 跨数据源一致性检查。
- 用户自定义指标参数和形态阈值。

### Phase 3：专业功能

- 回测和信号统计。
- 价格提醒和形态状态变化提醒。
- Level 1 / Level 2 数据扩展。
- 期权链和波动率分析。
- 仅在评测证明有必要时进行视觉微调。

---

## 21. 验收标准示例

### AC-01：首次按需同步

给定：用户连接有效数据源，数据库没有 AAPL 日线。
当：用户请求 AAPL 日线 RSI、MACD 和双顶分析。
则：

- 系统计算所需 lookback。
- 拉取相应 OHLCV。
- 完成数据校验和写库。
- 计算指标和形态。
- 显示来源、截止时间和复权方式。

### AC-02：缓存复用

给定：AAPL 日线已有完整覆盖。
当：用户再次查询。
则：系统只补充缺失的新 bar，不重复下载全部历史。

### AC-03：API 限流

给定：用户 API 返回 429。
则：

- 连接状态变为 `rate_limited`。
- 遵守 Retry-After 或退避策略。
- 不进行无限重试。
- 使用已有缓存或 Visual Only 回退。
- 向用户说明数据时间。

### AC-04：密钥安全

给定：用户保存 API Key。
则：

- 业务数据库、模型请求、trace 和日志中不存在明文 Key。
- UI 仅显示掩码。
- 用户可以撤销和替换 Key。

### AC-05：不确定截图

给定：截图无法读出 symbol 或 timeframe。
则：

- 不自动查询错误标的。
- 进入 Visual Only 或要求用户确认。
- 不输出虚构数值。

### AC-06：数据口径不一致

给定：截图使用扩展交易时段，数据 API 仅返回 regular session。
则：输出明确说明二者不可完全对齐，不将差异误判为技术信号。

### AC-07：删除

给定：用户选择删除连接和全部数据。
则：

- 凭证立即撤销。
- 相关 OHLCV、指标、形态缓存和分析记录按政策删除或匿名化。
- 生成审计记录。

---

## 22. 主要风险与缓解

| 风险 | 影响 | 缓解方案 |
|---|---|---|
| 截图 symbol/周期识别错误 | 查询错误行情 | 置信度阈值、用户确认、来源对比 |
| 用户 API 条款不允许保存 | 合规风险 | 保存策略、用户声明、Provider 预设、法律审查 |
| 任意 URL 导致 SSRF | 严重安全风险 | 标准 Gateway、域名 allowlist、隔离 egress、禁止私网和重定向 |
| API Key 泄露 | 用户资产和账户风险 | Secrets Manager、最小权限、掩码、轮换、永不进模型 |
| 多租户数据泄露 | 严重隐私风险 | tenant 强制过滤、RLS、连接归属校验、审计 |
| 数据源、复权或 session 混用 | 技术结论错误 | provenance 主键、禁止拼接、输出口径 |
| 形态过度识别 | 用户信任下降 | candidate/confirmed 状态、反例评测、precision launch gate |
| 供应商限流 | 分析失败和延迟 | cache、请求合并、退避、已有数据回退 |
| 未收盘 K 线变化 | 信号频繁翻转 | `is_final`、近期 overlap 更新、明确提示 |
| 模型编造精确数值 | 错误信息 | Structured Output、数值仅来自工具、输出校验 |

---

## 23. 待确认的产品决策

1. 首发目标市场：美股、A 股、港股、加密货币，还是多市场？
2. 首发支持哪两个内置数据提供商？
3. 用户数据默认保存策略是什么？
4. 日线默认采用 raw、split-adjusted 还是 total-return 口径？
5. 是否允许未登录用户使用 Visual Only？
6. 是否把数据连接管理放在独立 Web UI，而不是聊天内？
7. 是否允许用户只保存派生指标、不保存原始 OHLCV？
8. 用户删除后，分析审计记录保留何种匿名信息？
9. 产品面向教育信息，还是未来计划提供受监管的投资服务？
10. 是否需要在首版支持用户自建 Gateway 的 OAuth？

---

## 24. 最终推荐

第一版应采用以下组合：

```text
截图视觉识别
    +
用户自带数据源
    +
按需 OHLCV 回填
    +
用户级隔离缓存
    +
确定性指标与形态引擎
    +
Agent 解释和情景分析
```

数据接入优先级：

```text
内置 Provider Adapter
    > 标准 OHLCV Gateway
    > 任意 REST Mapping
```

Agent 工具优先级：

```text
一个高层复合分析工具
    > 多个由模型自行编排的底层数据工具
```

数据保存优先级：

```text
原始 OHLCV 是事实层
    > 指标和形态是可重算缓存
```

最重要的边界是：

> 用户自带 API 解决的是“数据获取权和成本”，并不自动授予平台“跨用户共享、长期保存或再分发”的权利。因此，MVP 必须把凭证、数据和派生结果都设计为用户级隔离，并提供明确保存策略。
