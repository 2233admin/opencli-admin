# OpenCLI Admin 后端能力前端整合 PRD

> 状态：执行基线 v1.0  
> 类型：总 Epic + 8 个功能 Epic  
> 证据复核日期：2026-07-22  
> 实施方式：分批交付，每个子任务控制在 1–3 个工程日，完成一个闭环再进入下一个闭环。

## 1. 背景与问题

OpenCLI Admin 的后端并不缺功能。当前 OpenAPI 有 **121 个路径、150 个操作**，前端 `frontend/lib/api/endpoints.ts` 已导出 **115 个 API wrapper**。静态引用审计显示其中 **57 个 wrapper 没有被 `frontend/app`、`frontend/components`、`frontend/hooks` 或其他前端模块使用**。

问题不是简单的“少了几个页面”，而是后端能力、前端信息架构和产品操作闭环没有形成统一契约：

- 数据源、调度、通知、Agent、技能、节点、Worker 等页面多数只展示列表，已完成的创建、编辑、测试、诊断、回滚和删除能力没有入口。
- 一部分能力应当进入现有资源页，一部分应当进入 Studio 工作流，一部分只适合设置/状态页或机器调用；当前没有统一分类，容易把内部端点误做成人工按钮。
- 手写前端类型和后端 schema 已出现漂移。例如前端允许 `browser_act` 数据源，但 `backend/schemas/source.py:8` 的 `ChannelType` 尚未包含它。
- 工作流能力投影与真实入口也有漂移。`backend/api/v1/workflows.py:194` 已有工作流 webhook ingress，但 `backend/workflow/capability_projection.py:819` 仍把 `trigger.webhook` 标为 blocked。
- Plan IR、Preset、BrowserAct Pack 和 Workflow 同时存在，但没有清晰的用户模型。继续给每个后端对象加独立页面会制造第二套编排产品。

这会造成三类成本：

1. 操作员必须借助 API、脚本或数据库才能完成日常管理。
2. 已开发并测试的后端价值无法转化为产品价值。
3. 新功能继续沿用“先写端点和 wrapper，最后再考虑 UI”的路径，孤儿能力持续增加。

## 2. 目标用户与价值

### 2.1 主要用户

- **运营人员**：创建采集来源、配置调度、查看通知和处理异常。
- **自动化构建者**：在 Studio 中使用真实可运行的来源、Preset、Agent 和执行资源。
- **平台管理员**：管理 Agent、浏览器资源、Worker、控制面和安全开关。
- **审计/排障人员**：查看技能纠错证据、通知交付日志、节点事件、运行健康和控制动作。

### 2.2 用户价值

用户可以只通过现有 OpenCLI Admin 前端完成后端已经支持的日常操作，并能清楚区分：

- 我可以在这里直接操作什么；
- 哪些能力需要在 Studio 中绑定后才能运行；
- 哪些是系统设置或状态；
- 哪些是外部系统回调或节点注册入口，不是人工按钮；
- 哪些旧能力已经被 Workflow 吸收或明确退役。

## 3. 产品目标与成功指标

### 3.1 目标

1. 完成本文定义的 8 个功能 Epic，不新增第二套运行时或第二套顶层信息架构。
2. 建立“后端能力归宿台账”，让每个后端操作都有明确的产品归属和生命周期状态。
3. 优先复用现有路由、Tab、API wrapper、React Query hooks 和 UI 组件。
4. 所有写操作具备校验、确认、成功反馈、错误反馈、缓存失效和回归测试。
5. 将 Plan IR、Preset 和 BrowserAct Pack 收敛到数据源创建与 Workflow Studio，而不是再建一个 Plan 产品区。

### 3.2 可量化成功指标

1. 150 个 OpenAPI 操作全部进入能力归宿台账，且每项只能属于以下一种状态：`operator_ui`、`studio_binding`、`setup_status`、`machine_ingress`、`internal_only`、`retire`。
2. 当前 57 个静态未使用 wrapper 降为 **0 个无解释项**。允许 wrapper 保留，但必须在台账中标注其机器入口、内部用途或退役计划。
3. 本 PRD 的 8 个 Epic 都有至少 1 条浏览器级主路径测试和对应的 API/契约测试。
4. 所有新增写操作在成功后刷新正确的 query key，并在失败时展示后端错误，不出现静默失败。
5. 凭据值、Webhook secret、Provider secret 不出现在列表响应、前端缓存、Toast、日志或 URL 中。
6. 不新增顶层侧栏项目。能力进入现有“自动化、Agent 团队、执行资源、治理与设置、工作区”入口。
7. Workflow 能力状态与实际运行入口一致，不能再出现“入口已存在但投影仍 blocked”或“UI 显示可运行但后端只能预览”的情况。

## 4. 已验证现状

### 4.1 规模与结构证据

| 指标 | 当前值 | 证据/说明 |
| --- | ---: | --- |
| OpenAPI 路径 | 121 | 2026-07-22 从 `backend.main.app.openapi()` 生成 |
| OpenAPI 操作 | 150 | GET/POST/PUT/PATCH/DELETE 等操作合计 |
| 前端 API wrapper | 115 | `frontend/lib/api/endpoints.ts` 的 `export const` |
| 静态未引用 wrapper | 57 | 排除 wrapper 定义文件后，对前端源码做符号引用扫描 |
| Workflow 能力 | 171 | catalog 32、primitives 107、channels 8、notifiers 5、triggers 2、resources 17 |
| Workflow 能力状态 | 28 runnable / 1 preview / 39 blocked / 103 design-only | `build_workflow_capabilities()` 当前输出 |
| Sentrux 扫描文件 | 1,261 | 当前本地扫描；923 个纳入 governed source scope |
| Sentrux 图边 | 1,982 import / 5,790 call / 90 inherit | 当前本地扫描 |
| 后端完整测试基线 | 1,749 passed / 6 skipped | 本轮盘点时执行，API token 环境变量清空 |

Sentrux 当前没有 baseline，因此不能宣称“无结构回归”。本 PRD 只使用它定位风险，不保存 baseline 来掩盖现状。

### 4.2 结构风险

| 模块 | Risk | Coupling | Blast radius | 当前工作区变更文件 | 说明 |
| --- | ---: | ---: | ---: | ---: | --- |
| `backend/models` | 60 | 54 | 146 | 0 | 数据模型是最高耦合轴，避免为 UI 再建平行模型 |
| `backend/workflow` | 56 | 18 | 110 | 11 | 正在活跃变更，Plan/Workflow 收敛必须分批 |
| `backend/schemas` | 48 | 26 | 118 | 1 | 前后端契约漂移需先解决 |
| `backend/api` | 41 | 24 | 34 | 1 | 适合复用，不应为了 UI 重写 API 层 |
| `frontend/lib` | 36 | 0* | 0* | 8 | 87 个源文件，静态图无法解析 TS path alias，需以引用审计补充 |
| `backend/plan_ir` | 34 | 11 | 103 | 1 | 不能与 Workflow 同时作为用户主模型 |

`*` 为 Sentrux 当前 TypeScript alias 解析限制，不能解释为真实零耦合。

### 4.3 8 类功能缺口

| Epic | 后端已存在 | 前端现状 | 核心缺口 |
| --- | --- | --- | --- |
| 1. 数据源全生命周期 | 创建、发现 Feed、OPML 导入、详情、编辑、删除、连通性测试、凭据、目标、控制状态、测量 | 列表仅启停和触发；详情只读 | 没有创建、配置、凭据、测试和删除闭环 |
| 2. 调度与自动化 | 5 个 Schedule CRUD 操作 | `/schedules` 只读列表 | 无创建、编辑、启停、删除和 Cron 校验体验 |
| 3. 通知规则与交付证据 | Rule CRUD、日志、HMAC ACK | `/notifications` 只读规则 | 无规则维护和日志诊断；ACK 边界容易误解 |
| 4. 技能生命周期 | 详情、dismiss、rollback、redistill、record start/stop、distill | `/skills` 只读列表，只显示待复核标记 | 人审纠错和录制蒸馏闭环没有入口 |
| 5. Agent 管理 | 5 个 Agent CRUD 操作 | `/agents` 只读卡片 | 无创建、模型/Provider/Prompt 配置、启停和删除 |
| 6. 执行资源 | Node 事件/统计/删除/安装，Browser binding/instance，Chrome pool/mode，Celery stats | Node/Worker 只读列表 | 无资源详情、诊断、绑定和受控运维 |
| 7. 控制与治理 | ODP state、advisory、outcome evaluate、kill switch、system config、action ledger | 只有 `/control/actions` 只读台账 | 安全状态和关键开关没有管理界面 |
| 8. Plan/Preset/Workflow 收敛 | Plan CRUD/run/health、Preset、BrowserAct Pack、Workflow runtime/capabilities | wrapper 存在，缺少稳定产品入口 | 用户模型重叠，能力目录与真实运行状态漂移 |

## 5. 产品与架构原则

### 5.1 不是所有端点都做成按钮

每个后端操作必须归入一个且仅一个类别：

| 类别 | 含义 | 示例 |
| --- | --- | --- |
| `operator_ui` | 人工日常操作，放入现有资源页 | 创建数据源、编辑 Schedule、回滚技能 |
| `studio_binding` | 由 Workflow Studio 编排或绑定 | Preset、Plan IR 兼容执行、Workflow webhook trigger |
| `setup_status` | 管理设置、安装说明、状态和复制入口 | Agent 安装脚本、Celery stats、collection mode |
| `machine_ingress` | 外部系统或 Agent 调用，不提供普通人工按钮 | Notification HMAC ACK、节点注册、Webhook ingress |
| `internal_only` | 运行时内部契约，有测试但无产品入口 | 健康探针、内部 geo acquisition |
| `retire` | 已被替代，先迁移调用方再删除 | 无后端对应的旧 workspace operation wrapper |

### 5.2 复用现有信息架构

`frontend/lib/navigation.ts:31` 已定义稳定的单层导航。新能力必须进入以下既有位置：

| 现有入口 | 承载内容 |
| --- | --- |
| 自动化 `/sources` + `/schedules` | 数据源、凭据、Preset、调度 |
| Agent 团队 `/agents` + `/skills` | Agent 管理、技能录制/纠错 |
| 工作项 `/tasks` + `/notifications` | 运行通知和交付日志 |
| 执行资源 `/nodes` + `/workers` | 节点、浏览器实例、绑定、池和 Worker 诊断 |
| 治理与设置 `/providers` + `/control/actions` | ODP、控制建议、Kill Switch、系统模式 |
| 工作区 `/studio` | Workflow、Preset/Pack 选择、Plan IR 兼容导入和运行健康 |

### 5.3 Canvas 只做投影和编排

遵守 `docs/opencli-admin-backend-system-map.md` 的守则：Canvas 不创建第二套 Source、Scheduler、Worker、Notifier 或 Runtime。UI 只调用已有后端轴，并明确显示 `runnable`、`preview_only`、`blocked`、`design_only`。

### 5.4 用户主模型只有 Workflow

- `WorkflowProject` / Workflow Studio 是面向用户的编排与运行入口。
- Plan IR 保留为内部执行 IR、兼容导入格式或迁移边界，不新建 `/plans` 顶层产品区。
- Preset 和 BrowserAct Pack 进入“创建数据源”和 Studio 节点/模板选择器。
- Plan health 转换为 Workflow 运行健康或兼容执行详情，不继续制造独立健康模型。

## 6. Phase 0：共同基础（所有 Epic 的前置）

### 6.1 能力归宿台账

新增一份机器可读台账，建议路径：`docs/backend-capability-exposure-matrix.yaml`。每项至少包含：

```yaml
- operation_id: create_source
  method: POST
  path: /api/v1/sources
  domain: sources
  exposure: operator_ui
  route: /sources
  owner: epic-1
  status: planned
  destructive: false
  secret_bearing: false
  test: tests/integration/test_sources_api.py
```

CI 校验：OpenAPI 中新增操作若未进入台账则失败；`retire` 项必须有迁移说明；`machine_ingress` 和 `internal_only` 不要求前端引用。

### 6.2 契约修复

1. 将 `browser_act` 纳入后端 `ChannelType`，或从前端删除该选项。鉴于渠道注册表和 Pack API 已存在，本 PRD 选择前者。
2. 将已真实存在的 Workflow webhook ingress 与 capability projection 对齐，并继续区分 inbound trigger、outbound notifier 和 respond-to-webhook。
3. 对 57 个静态未引用 wrapper 分类：接入、内部、机器入口或退役；不允许“先留着以后再说”。
4. 没有后端路由的 `/settings`、`/auth/me`、workspace operations 等前端幽灵契约必须映射到真实模型或删除。`/auth/me` 若仍是认证必需项，需单独补真实后端契约，不能静默 mock。

### 6.3 共享交互组件

复用现有组件并补齐以下通用能力，不引入新 UI 依赖：

- Resource create/edit sheet 或 dialog；
- JSON/键值配置编辑器及 schema 校验错误锚点；
- Secret 输入和“已配置 key 名称”列表；
- 高风险确认、二次输入确认和不可逆说明；
- Detail drawer/page、事件/日志时间线；
- mutation 成功/失败 Toast、query invalidation、乐观更新回滚；
- 权限/运行状态/blocked reason 展示。

### 6.4 Phase 0 验收

1. 150 个 OpenAPI 操作全部在台账中。
2. `browser_act` 前后端类型一致，创建 API 契约测试通过。
3. Workflow webhook 的真实入口和能力投影一致。
4. 57 个静态未引用 wrapper 均有分类，且 CI 能发现新孤儿 wrapper。
5. 不修改现有后端运行轴，不新增依赖。

计划工作量：**4–6 工程日**。

## 7. Epic 1：数据源全生命周期

### 7.1 用户结果

运营人员可在“自动化 → 数据源”完成发现、创建、配置、凭据、测试、目标、启停和删除，不再需要直接调用 API。

### 7.2 范围

- 在 `/sources` 增加“新建数据源”，支持普通创建、Feed 发现、OPML 导入和 BrowserAct Pack 入口。
- 通过 `channel_type` 渲染渠道专用配置表单；高级字段提供 JSON 模式，但不得成为默认路径。
- 在 `/sources/[id]` 增加基本信息、渠道配置、AI 配置、凭据、控制目标、连通性、测量和危险操作区。
- 凭据列表只显示 key 名，写入后清空表单；永不回显 secret value。
- 删除前展示关联 Schedule、Task 或 Workflow binding；若后端目前无法返回依赖，Phase 1 先阻止盲删并补依赖检查接口或明确 409。

### 7.3 请求形状

```ts
type DataSourceCreate = {
  name: string
  description?: string
  channel_type: 'opencli' | 'web_scraper' | 'api' | 'rss' | 'cli' | 'skill' | 'crawl4ai' | 'browser_act'
  channel_config: Record<string, unknown>
  ai_config?: Record<string, unknown>
  enabled: boolean
  tags: string[]
}
```

凭据操作继续使用 `{ key_name, secret }` 写入，读取只返回 `{ key_name }[]`。

当前 Source API 还缺少若干支撑上述体验的返回契约，作为 Epic 1 后端子任务补齐：

- `POST /sources/{id}/test` 返回 `tested_at`（UTC）、`connected` 和结构化 errors；
- OPML 文件级解析失败继续返回 400，条目级失败返回 `failed[]`，每项包含输入标识与错误原因；
- Source 删除前执行依赖检查，有 Schedule、Task 或 Workflow binding 时返回 409 和 `dependencies[]`，不做级联盲删。

### 7.4 验收标准

1. 可从空列表或页面主操作创建 8 种受支持渠道的数据源。
2. RSS/Feed 发现和 OPML 导入有预览、重复项反馈和部分失败反馈。
3. 连通性测试明确显示成功、失败原因和测试时间。
4. 凭据值不出现在 DOM、React Query cache 快照、日志和网络响应读取接口中。
5. Objective 可设置、更新和清空，详情页同时区分 raw override 与 resolved objective。
6. 删除受确认保护；有关联对象时返回可操作的阻塞说明。
7. 现有启停和立即触发能力不回归。

### 7.5 子任务与工作量

| 子任务 | 工作量 |
| --- | ---: |
| 类型契约与依赖检查 | 1–2 日 |
| 创建/导入流程 | 2–3 日 |
| 详情、凭据、Objective、测试 | 2–3 日 |
| 集成与 E2E | 1–2 日 |

合计：**6–10 工程日**。

## 8. Epic 2：调度与自动化

### 8.1 用户结果

运营人员可为已有 Source 创建和维护 Cron 调度，能在保存前理解下一次运行时间和无效表达式。

### 8.2 范围

- `/schedules` 增加创建、编辑、启停、删除。
- 表单字段严格对应 `CronScheduleCreate`：`source_id`、`name`、`cron_expression`、`timezone`、`parameters`、`enabled`、`is_one_time`、`agent_id`。
- Source 和 Agent 使用选择器，不要求用户输入 ID。
- Cron 表达式必须由后端做最终校验；前端提供人类可读预览。
- 一次性调度和周期调度有明确差异；过期的一次性调度不可被误认为仍会运行。

### 8.3 验收标准

1. 创建、编辑、启停和删除均可从 `/schedules` 完成。
2. 无效 Cron、无效 timezone、已删除 Source/Agent 均显示后端校验错误。
3. 保存前后显示一致的 next run 时间，时区转换有自动化测试。
4. 删除需确认，成功后列表和关联 Source 详情同步刷新。
5. Schedule API 的 5 个操作都有集成测试，主路径有 E2E。

工作量：**4–6 工程日**。

## 9. Epic 3：通知规则与交付证据

### 9.1 用户结果

运营人员可配置通知规则，并从同一页面判断通知是否发送、失败、等待 ACK 或已确认。

### 9.2 范围

- `/notifications` 增加规则创建、编辑、启停和删除。
- `trigger_event` 当前只允许 `on_new_record`，UI 不渲染自由文本事件输入。
- 通知类型按后端 registry 展示配置字段，secret 字段遮蔽。
- 增加通知日志 Tab/详情，显示 rule、record、发送状态、错误、ack 状态、响应摘要和时间。
- `POST /notifications/logs/{id}/ack` 是带 HMAC 的下游机器回调，分类为 `machine_ingress`。普通 UI 不提供“人工 ACK”按钮。
- 若产品后续需要人工确认，必须设计独立的人工确认语义和鉴权端点，不能复用 HMAC ACK。
- 新增 `GET /notifications/notifiers` schema 端点，按 notifier registry 返回支持类型、字段、类型、必填项和 `secret` 标记；创建/更新必须在服务端按该 schema 校验，不能继续接受任意 type/config。
- Secret-bearing 字段从 `notifier_config` JSON 拆到加密凭据存储。Rule 读取只返回非敏感配置和 `configured_secret_keys[]`；更新时未提交 secret 表示保留现值，`clear_secret_keys[]` 才表示显式删除。
- 对现有明文 notifier config 提供一次性迁移，迁移成功后清除原 JSON secret；迁移可重复执行并有回滚备份/校验报告。

### 9.3 验收标准

1. 规则 CRUD 和启停在 UI 可完成。
2. UI 只能创建后端真实 producer 支持的事件。
3. 日志可按 rule 过滤，并能定位对应 record。
4. 错误信息和 ACK 状态可诊断，但 secret/完整敏感响应默认折叠或脱敏。
5. 普通用户无法从 UI 调用 HMAC ACK。
6. 通知发送失败不会被展示为业务完成。
7. Rule 列表/详情响应、浏览器缓存和日志中均不出现 notifier secret；旧数据迁移后仍能发送。

工作量：**6–9 工程日**，其中 schema/secret migration 2–3 日，规则与日志 UI 2–3 日，测试与迁移验证 2–3 日。

## 10. Epic 4：技能录制、蒸馏与纠错闭环

### 10.1 用户结果

技能管理员可查看完整技能证据，处理纠错提案，按需重新蒸馏或回滚，并从浏览器演示创建新技能。

### 10.2 范围

- 新增 `/skills/[id]` 详情，展示版本、scope、`skill_md`、elements、evidence、last failing trace 和 open proposal。
- 提供 dismiss correction、redistill、rollback，均展示动作影响和最新版本。
- 新增录制向导：选择 Browser endpoint → `record/start` → 明确录制中状态 → `record/stop` → 审核 trace → `distill`。
- 录制 session 是内存态且单用户/本地语义。页面刷新、浏览器断开或 stale session 必须明确恢复/终止行为，不能假装持久化。
- Redistill 只由人触发；失败次数不能自动触发蒸馏。

### 10.3 验收标准

1. 列表中的“待复核”可进入具体提案和证据。
2. Dismiss 不修改 skill body/version；Redistill 成功后 version +1；Rollback 恢复上一版本。
3. Trace 缺失、Provider 失败、并发蒸馏冲突均有明确错误。
4. 录制中离开页面会警告；停止后必须先审核 trace 才能创建 Skill v1。
5. 每个高风险动作都有确认和审计反馈。
6. 详情、纠错和录制主路径各有 E2E。

工作量：**6–9 工程日**。

## 11. Epic 5：Agent 管理

### 11.1 用户结果

平台管理员可创建、配置、测试和维护用于数据处理的 Agent，而不必编辑数据库或手写请求。

### 11.2 范围

- `/agents` 增加创建和卡片操作菜单；新增 Agent 详情/编辑面。
- 字段对应后端契约：name、description、processor_type、provider_id、model、prompt_template、processor_config、enabled。
- Provider 和 model 复用已有 Provider/Model API，避免自由文本优先。
- Processor config 使用类型化常用字段 + 高级 JSON；Prompt 提供变量说明，但不新建 Prompt 管理子系统。
- 删除前显示被 Source、Schedule 或 Workflow 使用情况；有引用时阻止或要求先解绑。
- 后端必须补 Provider/model 兼容校验和删除引用检查。当前 `backend/api/v1/agents.py` 只做 CRUD，前端校验不能替代服务端约束；有引用时统一返回 409 和引用摘要。

### 11.3 验收标准

1. Agent CRUD、启停均可从前端完成。
2. Provider/model 组合不兼容时在保存前或保存时得到明确错误。
3. Prompt 和 processor config 可编辑，后端返回值能无损回填。
4. 删除不会留下无效 Schedule 或 Workflow binding。
5. Agent list 不返回或展示 Provider secret。

工作量：**4–6 工程日**。

## 12. Epic 6：Node、Worker 与浏览器资源运维

### 12.1 用户结果

管理员可判断执行资源是否健康、为何失败、绑定了什么站点，并能执行有限、可审计的运维动作。

### 12.2 范围

- `/nodes/[id]`：基本信息、事件、采集统计、安装说明和删除。
- `/workers`：Worker 列表 + Celery live stats。当前 `backend/api/v1/workers.py` 会把 inspect 异常折叠为空集合，必须先改为可区分的 unavailable/error 契约，不把故障伪装成“0 个任务”。
- 执行资源下增加 Browser resources：binding、instance、Chrome pool、bridge/cdp mode。
- 安装脚本以“复制命令/下载说明”呈现，节点注册 API 仍是 `machine_ingress`。
- `restartApi`、删除节点/实例、切换连接模式属于高风险操作，必须确认并显示影响范围。
- WebSocket agent status 是诊断状态，不单独建导航。
- 当前节点安装脚本路径会注入长期 API token、NetBird setup key 等部署 secret。Epic 6 的固定方案是：`GET /nodes/install/agent.sh` 只返回通用脚本和环境变量占位符，不嵌入任何 secret；管理员在目标主机通过受控环境变量/secret manager 注入。一次性 bootstrap token 不在本 Epic 偷做，若未来需要则单独设计 mint/redeem/TTL/revoke 契约。
- Node 删除、API 重启、Browser instance 删除和 mode 切换必须写入统一审计事件；前端 Toast 不能充当审计证据。

### 12.3 验收标准

1. 节点事件和统计可从节点详情查看。
2. Celery unavailable 与“正常但空闲”有不同 UI 状态。
3. Browser binding 可增删；凭据/会话内容不被当作普通资源字段展示。
4. Mode 切换更新后端和持久化 BrowserInstance，刷新后保持一致。
5. 删除/重启/切换模式均有确认、错误反馈和审计记录或事件证据。
6. 安装入口不暴露 bearer token；必需 token 与 key 只允许由管理员通过目标主机的受控环境变量或 secret manager 注入。
7. 安装脚本响应对长期 API token、NetBird setup key 和其他 secret 的扫描结果为 0；脚本缺少外部注入的必需变量时 fail closed。

工作量：**7–10 工程日**。

## 13. Epic 7：控制面与治理

### 13.1 用户结果

管理员能在“治理与设置”看到系统当前是否安全、控制器建议了什么、Kill Switch 是否生效，以及系统使用本地还是 Agent 执行模式。

### 13.2 范围

- 在 `/control/actions` 上方或治理页增加 ODP state、Advisory report、Kill Switch、system config 卡片。
- `outcomes/evaluate` 是主动重新计算，不作为普通“修复”按钮；触发后展示评估计数。当前 Advisory GET 会顺带执行并持久化 outcome evaluation，实施时必须拆开：GET 只读，POST `/outcomes/evaluate` 才允许写入。
- Kill Switch 显示配置值、运行时 override、重启后行为和当前有效值。
- System config 当前只允许修改 `collection_mode`；`task_executor` 和 `image_tag` 只读。
- `PATCH /system/config` 会写 `.env` 并更新进程环境，UI 必须把它标为部署级设置，说明重启/多实例一致性限制。
- `ConfigPatch` 必须拒绝额外字段（Pydantic `extra='forbid'` 或等价约束），不能对未知配置返回静默 200。

### 13.3 验收标准

1. ODP state、advisory、kill switch 和 system config 均可在治理入口查看。
2. Kill Switch 开启/关闭需要明确确认；操作后立即显示 effective state。
3. 非允许字段不能由 UI 或 API patch。
4. 多实例部署下若状态仅为当前实例，UI 必须明确标注，不能宣称全局生效。
5. Advisory 读取和 outcome evaluate 的副作用边界有测试。
6. 控制动作台账现有列表不回归。

工作量：**4–6 工程日**。

## 14. Epic 8：Plan IR、Preset、BrowserAct Pack 与 Workflow 收敛

### 14.1 用户结果

自动化构建者在 Studio 中只面对一个 Workflow 产品模型，同时能使用已有 Preset、BrowserAct Pack、Plan 执行能力和运行健康数据。

### 14.2 固定决策

1. 不新增 `/plans` 顶层页面。
2. Workflow 是用户主模型；Plan IR 是兼容/执行 IR。
3. Preset 和 BrowserAct Pack 是创建入口，不是独立资源中心。
4. 已有 Plan 记录需要迁移/导入到 Workflow，或在兼容详情中只读展示并提供“转换为 Workflow”。
5. 未完成迁移前保留 Plan API 和 wrapper；完成迁移并确认无调用后再决定退役。
6. 转换目标必须是一个已存在的 Studio workspace/project；本 PRD 不根据 Plan 名称自动创建归属。
7. v1 actor 与现有 Studio 写接口一致，由服务端使用 `LOCAL_USER_ID`，请求体不得伪造 actor；Studio 接入真实认证后统一迁移为 authenticated user。
8. 不迁移历史 Plan run/health 到 Workflow，也不伪造共享 run identity。历史记录保持只读；cutover 后的新运行只走 Workflow。

### 14.3 范围

- Studio 模板/命令面板接入 `/presets` 与 `/browser-act/packs`。
- Source 创建可从 Pack 生成 channel config，但 Pack 不携带 credential/API key。
- 增加版本化 Plan → Workflow 转换器：`convert_plan_graph_to_workflow(plan_graph, conversion_version)` 是无数据库副作用的纯转换，返回 Workflow graph 和逐节点 `ConversionReport`；不支持的节点必须失败，不能静默丢弃。
- 新增 `POST /workspaces/{workspace_id}/projects/{project_id}/workflows/import-plan`，请求体固定为 `{ plan_id, expected_plan_version, name, idempotency_key }`。服务端校验 workspace/project 归属、Plan version 和转换报告，再以单事务创建 Workflow + Draft revision 1 + migration link。
- 新增 `PlanWorkflowMigration`（或等价名称）持久关联，至少包含 `plan_id`、`plan_version`、`target_project_id`、`workflow_id`、`conversion_version`、`source_graph_hash`、`status`、`created_by_user_id` 和时间字段；唯一约束为 `(plan_id, plan_version, target_project_id)`。
- 重名不自动覆盖：返回 409 和建议名称。重复 idempotency key 或相同唯一键返回同一个转换结果，不创建第二个 Workflow。
- Migration 状态机固定为 `draft_created → validated → cutover`，或在 cutover 前进入 `rolled_back`。Cutover 时若存在正在运行的 Plan run 则返回 409；成功后 Plan run API 对该版本返回 409 和目标 `workflow_id`，禁止双运行。
- `rolled_back` 只允许在 cutover 前，动作是归档新 Workflow 并保留 Plan；一旦 Workflow 已发布或产生 Run，不提供假回滚，只能创建新的修订/迁移。
- `draft`、`runnable` 不直接复制为 Workflow 字段。转换报告记录原值，Workflow compiler/validation 重新计算可运行性；Plan `version` 记录在 migration link，Workflow draft 从 revision 1 开始。
- 历史 Plan run/health 只在“Legacy Plan 历史”兼容面板读取，永不回填成 Workflow run。Cutover 后只有 Workflow 产生新 run/health；对账标准是同一 migration 在 cutover 后 Plan 新增 run 数为 0。
- 修复 webhook trigger capability 状态漂移。
- 能力目录继续诚实显示 28 runnable、1 preview、39 blocked、103 design-only 的真实状态；每次变更后重新生成并做契约断言。

### 14.4 验收标准

1. 用户可从 Studio 选择 Preset/Pack 并得到可验证的 Workflow draft。
2. Pack 生成的配置不包含 secret，缺少凭据时进入统一 Setup/Source credential 流程。
3. 已有 Plan 可转换或明确保持只读兼容；graph 的每个 node/edge/port 都出现在转换结果或明确的阻塞错误中，Plan version/draft/runnable 进入 migration 审计而不是被误写为 Workflow 字段。
4. Cutover 前在途 Plan run 必须完成或取消；cutover 后 Plan run API 返回 409，且不会产生新的 PlanHealth。历史记录仍可只读查看。
5. Webhook ingress 存在时 trigger capability 不再错误标 blocked；outbound/respond-to-webhook 仍按真实缺口保持 blocked。
6. Capability projection 每个 runnable 项都有真实后端 binding 和至少一条契约测试。

### 14.5 子任务与工作量

| 子任务 | 工作量 |
| --- | ---: |
| Webhook truth、Preset/Pack 接线 | 3–4 日 |
| 版本化纯转换器与 ConversionReport | 3–5 日 |
| Migration schema、幂等导入 API、归属/重名处理 | 4–6 日 |
| Cutover 状态机、Plan run guard、Legacy 历史面板 | 3–5 日 |
| 对账、迁移、回滚边界与 E2E/regression | 3–5 日 |

合计：**16–25 工程日**。

## 15. 依赖图与实施顺序

```text
Phase 0 契约与台账
  ├── Epic 1 数据源 ──> Epic 2 调度
  │          └────────> Epic 8 Workflow 收敛
  ├── Epic 3 通知 ────> Epic 8 Workflow 输出能力
  ├── Epic 4 技能 ────> Epic 8 Workflow 技能节点
  ├── Epic 5 Agent ───> Epic 8 Workflow Agent 节点
  ├── Epic 6 执行资源 ─> Epic 8 Runtime binding
  └── Epic 7 控制治理（可与 1–6 并行）
```

推荐交付顺序：

1. **Phase 0**：没有台账和契约修复，后续仍会制造新孤儿。
2. **Epic 1 数据源**：是采集、Schedule、Preset 和 Workflow 的共同基础。
3. **Epic 2 调度 + Epic 3 通知**：先闭合最常用的“采集 → 定时 → 通知”运营链。
4. **Epic 4 技能 + Epic 5 Agent**：补齐能力生产和 AI 处理管理。
5. **Epic 6 + Epic 7**：补齐资源运维和安全治理，可按风险并行。
6. **Epic 8**：依赖前面对象的稳定契约，最后做模型收敛，避免把临时形状固化进 Studio。

按本文拆分顺序执行的总工程量估算为 **57–87 工程日**，这是任务量估算，不是日历承诺。建议按三个可独立验收的里程碑推进：

| 里程碑 | 范围 | 退出条件 |
| --- | --- | --- |
| M1 运营闭环 | Phase 0 + Epic 1–3 | 用户可完成 Source → Schedule → Run → Notification；能力台账开始阻止新孤儿 |
| M2 能力与治理 | Epic 4–7 | Skill、Agent、资源和控制面都有真实操作与诊断闭环 |
| M3 模型收敛 | Epic 8 | Workflow 成为唯一用户主编排模型，Plan/Preset/Pack 无悬空产品入口 |

## 16. 测试策略

| 层级 | 内容 | 每个 Epic 最低要求 |
| --- | --- | ---: |
| Schema/Unit | 表单映射、类型转换、secret redaction、状态计算、query invalidation | 3–8 条 |
| API Integration | CRUD、422/404/409、鉴权、幂等/并发、机器入口边界 | 3–10 条 |
| Contract | OpenAPI ↔ wrapper ↔ frontend type；capability ↔ runtime binding | 2–5 条 |
| Frontend Component | 空态、加载、错误、确认、编辑回填、危险操作 | 3–8 条 |
| Browser E2E | 用户主路径和 1 条失败恢复路径 | 至少 2 条 |
| Regression | 现有后端全量、前端 typecheck/lint/build、workflow regression | 每个 PR 必跑相关集；每个 Epic 结束全跑 |

统一验证命令以仓库现有脚本为准。每个子 PR 先跑目标测试，再跑 typecheck/lint/build；Epic 结束时跑后端全量和浏览器 smoke。

## 17. 发布、灰度与回滚

### 17.1 发布策略

- 每个 Epic 使用独立 feature flag 或路由内渐进开放，不把 8 个 Epic 合并成一次大发布。
- 先发布只读详情和诊断，再开放低风险写操作，最后开放删除、回滚、Kill Switch、重启等高风险操作。
- 新旧入口短期并存时只允许一个写入权威路径，避免双写。

### 17.2 回滚

- 纯前端接线：关闭 feature flag 或回滚对应 PR，后端保持兼容。
- Schema 收紧：先验证数据库存量和客户端调用，再发布；必要时保留兼容读取，拒绝新增非法值。
- Plan → Workflow 迁移：只做可重复、可审计的复制/转换；验证完成前不删除 Plan 原记录。
- System config/Kill Switch：保留明确的运行时恢复方式，不通过数据库迁移回滚运行态。

## 18. 不在本 PRD 范围

- 不实现 ADR 中尚未存在的完整 Project、Connection Binding、Execution Grant、Delivery Business Outcome 或 Recovery Case 平台。
- 不把内部 geo acquisition、健康探针、节点注册、Webhook ingress、HMAC ACK 做成普通人工按钮。
- 不新增第二套 Canvas、Scheduler、Notifier、Worker 或 Agent runtime。
- 不新增顶层导航或独立 Plan 产品区。
- 不为了表单方便引入新的 UI 框架、状态库或 API client。
- 不顺手重构 8 个 Epic 之外的 1,698 个 Ruff 存量问题；只修触达文件及阻塞项。

## 19. 做得好的部分（不要破坏）

- 后端 API 已有较完整的 CRUD、状态和测试基础，优先接线而不是重写。
- `frontend/lib/navigation.ts:31` 的单层工作导向 IA 已能承载这些能力。
- `frontend/components/shell/route-tabs.tsx:56` 的运行、能力和资源 Tab 已提供合适归属。
- Source credential 读取只返回 key name，保持这一安全边界。
- Skill redistill 是人工触发，dismiss、redistill、rollback 语义已分开。
- Notification ACK 已有 HMAC 机器回调边界，不应偷换成人工确认。
- Workflow capability projection 已能表达 runnable/preview/blocked/design-only，应修正真实性而不是删除状态层。
- `docs/opencli-admin-backend-system-map.md` 已明确 Canvas 复用现有后端轴。

## 20. Definition of Done

本总 PRD 只有在以下条件全部满足时完成：

1. 8 个 Epic 的验收标准全部通过并有可追溯测试证据。
2. 150 个 OpenAPI 操作全部有能力归宿，0 个无解释操作。
3. 115 个 wrapper 均被使用、标记为机器/内部能力，或已安全退役；0 个无解释 wrapper。
4. 用户可通过前端完成 Source → Schedule → Run → Notification 的基本运营闭环。
5. 用户可完成 Agent 管理、Skill 纠错/录制、执行资源诊断和控制面操作。
6. Workflow 是唯一用户主编排模型，Plan IR/Presets/Packs 有明确归属且无双运行时。
7. 后端全量测试、前端 typecheck/lint/build、目标 E2E 和 Workflow regression 全部通过。
8. Secret、机器入口和高风险操作的安全边界通过独立审查。

## 21. 关键文件索引

| 文件 | 用途 |
| --- | --- |
| `frontend/lib/navigation.ts:31` | 顶层信息架构，不新增一级导航 |
| `frontend/components/shell/route-tabs.tsx:56` | 运行/能力/资源 Tab |
| `frontend/lib/api/endpoints.ts:200` | 现有 API wrapper 主入口 |
| `frontend/app/(app)/sources/page.tsx:40` | 当前数据源列表和仅有写操作 |
| `frontend/app/(app)/schedules/page.tsx:19` | 当前只读 Schedule 页 |
| `frontend/app/(app)/notifications/page.tsx:27` | 当前只读通知规则页 |
| `frontend/app/(app)/skills/page.tsx:20` | 当前只读技能页 |
| `frontend/app/(app)/agents/page.tsx:22` | 当前只读 Agent 页 |
| `frontend/app/(app)/nodes/page.tsx:20` | 当前只读节点页 |
| `frontend/app/(app)/workers/page.tsx:19` | 当前只读 Worker 页 |
| `frontend/app/(app)/control/actions/page.tsx:18` | 当前控制动作台账 |
| `backend/api/v1/sources.py:38` | Source 全生命周期 API |
| `backend/api/v1/schedules.py:14` | Schedule CRUD |
| `backend/api/v1/notifications.py:33` | 通知规则、日志和 ACK |
| `backend/api/v1/skills.py:109` | Skill 详情和纠错动作 |
| `backend/api/v1/skill_record.py:62` | Skill 录制/蒸馏 |
| `backend/api/v1/agents.py:17` | Agent CRUD |
| `backend/api/v1/workers.py:69` | Chrome pool、mode、Celery stats |
| `backend/api/v1/browsers.py:23` | Browser binding/instance |
| `backend/api/v1/control.py:57` | ODP、advisory、outcome、kill switch |
| `backend/api/v1/system.py:48` | System config |
| `backend/api/v1/plans.py:31` | Plan 兼容 CRUD/run/health |
| `backend/api/v1/presets.py:127` | Preset 与 opinion monitor quickstart |
| `backend/api/v1/workflows.py:194` | Workflow webhook ingress |
| `backend/workflow/capability_projection.py:819` | 当前 webhook trigger 状态漂移 |
| `docs/opencli-admin-backend-system-map.md` | 防止重复运行时的架构守则 |
| `docs/WIRING_GAP_LEDGER.md` | 已有 designed-but-unwired 证据账本 |

## 22. Code Intel 证据说明

本 PRD 使用了 Code Intel Pipeline 的 installer、doctor、Sentrux scan/health/test-gaps/DSM，以及 2026-07-13 最近一次完整产物的 `summary.md`、`hospital.md`、`understanding.md`。

2026-07-22 的 normal 流水线未能生成新的完整 artifact，原因是当前仓库为 shallow clone，流水线按设计拒绝缺失提交谱系的影响快照；尝试从 `origin` 解除 shallow 时，GitHub 443 连接失败。因此：

- 当前文件、API、引用和结构指标来自本地实时扫描；
- 提交年龄、完整 churn、bus factor 和跨历史影响没有在本轮刷新；
- 这不阻塞本 PRD 的功能归宿与 UI 接线决策，但正式开始 Epic 8 前应在网络恢复后重新运行 normal pipeline。
