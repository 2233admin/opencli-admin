# OpenCLI Houdini 式节点基板前后端联动 PRD

## 1. 目标

在现有 OpenCLI Studio、Canvas、Workflow Draft、编译器和运行系统之上，补齐一套可实际保存、编译、运行和追踪的 Houdini 式节点操作逻辑。

本阶段只服务当前 OpenCLI 系统。它不是独立 SDK、独立仓库或跨项目抽包任务，也不为未来复用增加额外抽象。

完成后，用户可以在 Canvas 中：

1. 进入和退出 Package 内部网络；
2. 将内部参数提升到 Package 外部；
3. 对节点执行 bypass、disable、lock；
4. 在当前 Workflow Draft 中创建局部覆盖；
5. 保存、验证、编译、运行、发布并重新打开同一图；
6. 在 UI 中明确看到加载、保存、编译、运行和发布状态，以及定位到节点的错误。

## 2. 非目标

- 不拆分节点内核或建立通用节点 SDK。
- 不实现跨项目复用协议；只有明确“提升为工作区 Custom Node”时才进入后续需求。
- 不复刻 Houdini 的完整 SOP/DOP/CHOP 体系、表达式语言或任意深度 UI。
- 不把前端模拟执行包装成真实 Worker 执行。
- 不在本阶段新增 Connection、Source Group 或 Automation 的完整产品模型。

## 3. 产品原则

- Workflow 是用户工作的主容器，Package 是 Workflow 内可递归组合的节点。
- 普通编辑建议不超过 4 层；编译硬限制 16 层，禁止循环包含。
- 已发布 Workflow Version 不可变，并固定 Package 与传递依赖的精确版本。
- Draft 可编辑；任何图或节点操作变更都会使上一轮验证失效。
- UI 使用“打包节点 / Package”，HDA 只作为内部设计类比。
- 节点运行语义由后端编译器和运行时裁决；前端只负责编辑和状态投影。

## 4. 现状与能力边界

### 4.1 已完成

- Workspace → Project → Workflow Draft → Workflow Version 的持久化 API。
- Dify YAML/JSON、n8n JSON 导入并转换为 canonical `WorkflowProject`。
- 导入时选择现有 Project 或显式创建 Project。
- Package `internals.nodes/edges` 递归编译，使用 `parent::child` 作用域 ID。
- 完整 `package_path`、直接 `package_parent_id` 和内部节点运行投影。
- Package 最大 16 层、循环引用、内部边端点、类型边及依赖版本校验。
- `parameterInterface` 将 Package 外部字段绑定到内部节点的 `params`、`adapter` 或 `data`。
- Package `locked` 可影响编译结果中的 `editable`。
- Draft 保存、Validation Run、发布门禁、Version 列表和按 Version 发起 Run。
- Canvas 已有 Package 面包屑、进入/退出网络基础交互、Inspector 参数面板、运行错误投影。
- Run 面板已有 idle/running/ready/blocked/error 状态和节点级错误展示。

### 4.2 Cloud 已交付后端能力

- 递归 Package 编译与深度/循环校验。
- Dify/n8n 兼容节点的 tracer 事件与确定性结果投影。
- imported/compat Draft 的 Validation Run 发布门禁。
- Workflow Version 列表和发布后不可变快照。

### 4.3 必须明确的限制

当前 Dify/n8n compatibility runtime 是兼容链路模拟，不是原生 Dify/n8n Worker：

- 有 `fixtureOutputs` / `fixtureOutput` 时返回固定结果；
- 否则执行输入 passthrough；
- 会生成 `compat_dispatch_started` / `compat_dispatch_completed` 事件和 lineage；
- 不会启动真实 Dify 或 n8n 执行器，也不保证第三方节点的真实副作用。

UI 必须将其标记为“兼容验证”或“模拟”，不能显示为“生产执行成功”。只有接入真实 Worker adapter 并通过能力探测后，才能升级为 runnable/live。

## 5. 最小节点状态模型

在 `WorkflowProjectNode` 上增加一个可选、可持久化的执行控制对象；不另建数据库表：

```json
{
  "execution": {
    "mode": "enabled | bypass | disabled",
    "locked": false
  }
}
```

语义：

| 操作 | 编辑 | 编译 | 运行 | 输出 |
| --- | --- | --- | --- | --- |
| enabled | 允许 | 正常参与 | 正常执行 | 节点结果 |
| bypass | 允许 | 保留节点与追踪 | 不调用执行器 | 单输入透传到单输出 |
| disabled | 允许 | 保留节点与诊断 | 不执行 | 无输出；下游按缺失输入规则 blocked/skipped |
| locked | 禁止修改节点参数、连线、删除和内部网络 | 不改变执行 | 不改变执行 | 不改变 |

约束：

- bypass 第一版只允许“一个数据输入 → 一个数据输出”的节点；其他端口结构返回 `bypass_contract_unsupported`，不猜测映射。
- lock 是编辑权限，不是安全权限，也不能绕过 Workspace RBAC。
- Package 的 `internals.locked` 继续控制内部网络；节点 `execution.locked` 控制节点本体。任一为真时，对应编辑面只读。
- 旧图未包含 `execution` 时等同 `{ mode: "enabled", locked: false }`。

## 6. 节点操作交互

### 6.1 统一入口

节点右键菜单和 Inspector 顶部使用同一组命令：

- 进入 Package
- 退出当前 Package（面包屑同时保留）
- Bypass / 恢复
- Disable / 启用
- Lock / Unlock
- 创建 Workflow 局部覆盖
- 提升参数
- 打包所选节点

命令只调用现有 Canvas state mutation 和 Draft 自动保存，不建立第二套状态。

### 6.2 Package 进入与退出

- 双击 Package 或选择“进入 Package”后，Canvas 只显示该 Package 的直接内部节点和边。
- 面包屑显示从 Workflow 根到当前 Package 的路径；点击任一级直接返回。
- 进入第 5 层时提示“普通工作建议保持在 4 层以内”，但允许继续。
- 达到第 16 层后禁止继续打包，并展示编译器返回的 `package_depth_exceeded`。
- 刷新页面后，通过 URL 查询参数或本地视图状态恢复当前网络；不存在的路径回退到根图，不破坏 Draft。

### 6.3 参数提升

- 用户在内部节点参数上选择“提升到 Package”。
- 前端写入 Package 的 `parameterInterface.groups/fields`，binding 指向内部 `nodeId + source + fieldId`。
- Inspector 在 Package 外层显示提升后的字段；修改外层字段后，保存的是 Package 字段值。
- 编译阶段将字段值绑定到内部节点；binding 不存在、目标节点不存在或字段来源不支持时返回节点定位错误。
- 删除内部字段时，必须先删除提升绑定或显式确认一并删除；禁止留下静默失效绑定。

### 6.4 Workflow 局部覆盖

第一版局部覆盖不引入独立资源模型：

- 从已安装 Package 创建覆盖时，将其当前定义复制进该 Workflow Draft 的节点 `internals`。
- 在 `ui` 元数据记录 `originPackage`、`originVersion` 和 `overrideScope: "workflow"`，用于 UI 标识与差异提示。
- 覆盖只影响当前 Draft；发布后随 Workflow Version 固化。
- 上游 Package 更新不会自动修改覆盖；UI 只提示“存在新版本”，由用户显式比较和升级。
- “提升为 Workspace Custom Node”不在本期实现，仅保留不可点击入口或完全不展示。

## 7. 前后端主流程

```text
Studio 导入/新建
  → POST Workflow（创建 Draft）
  → Canvas GET Draft
  → 节点操作修改 canonical WorkflowProject
  → PUT Draft（revision +1，旧验证失效）
  → POST Validation Run
      → compile
      → compatibility tracer 或真实已注册 runtime
      → Run/Node events
  → POST Version（发布门禁）
  → GET Version / GET Draft 重新打开
```

前端只提交完整 canonical Draft。当前图规模下沿用整图 PUT，暂不增加节点级 PATCH、协同编辑或事件溯源；出现真实并发覆盖或超大图保存瓶颈后再评估。

## 8. API 契约

沿用现有资源路径：

| 用途 | 方法与路径 | 结果 |
| --- | --- | --- |
| 创建 Workflow 与 Draft | `POST /workspaces/{workspaceId}/projects/{projectId}/workflows` | Workflow + 初始 Draft |
| 列出 Workflow | `GET /workspaces/{workspaceId}/projects/{projectId}/workflows` | Studio 高密度列表 |
| 打开 Draft | `GET /workspaces/{workspaceId}/projects/{projectId}/workflows/{workflowId}/draft` | graph + revision |
| 保存节点操作 | `PUT /workspaces/{workspaceId}/projects/{projectId}/workflows/{workflowId}/draft` | 新 revision |
| 验证 Draft | `POST /workspaces/{workspaceId}/projects/{projectId}/workflows/{workflowId}/draft/validation-runs` | Run projection |
| 发布 Version | `POST /workspaces/{workspaceId}/projects/{projectId}/workflows/{workflowId}/versions` | immutable Version |
| 版本列表 | `GET /workspaces/{workspaceId}/projects/{projectId}/workflows/{workflowId}/versions` | Version summaries |
| 版本详情 | `GET /workspaces/{workspaceId}/projects/{projectId}/workflows/{workflowId}/versions/{version}` | graph snapshot |
| 运行 Version | `POST /workspaces/{workspaceId}/projects/{projectId}/workflows/{workflowId}/versions/{version}/runs` | Run projection |
| 读取 Run | `GET .../versions/{version}/runs/{runId}` | Run + node states |
| 补充异步 Source 输出 | `POST .../versions/{version}/runs/{runId}/source-outputs` | 更新后的 Run |

保存冲突的最小补充：`PUT Draft` 请求携带客户端读取到的 `revision`；不匹配时返回 `409 draft_revision_conflict` 和最新 revision，前端停止自动保存并提示重新加载。该校验必须在上线局部节点操作前完成，避免多个浏览器静默覆盖。

错误响应保持结构化：

```json
{
  "code": "package_depth_exceeded",
  "message": "...",
  "node_id": "outer::inner",
  "edge_id": null,
  "path": ["nodes", "outer", "internals"]
}
```

前端优先定位 `node_id`，内部节点错误映射到可见 Package，并允许一键进入对应 `package_path`。

## 9. 加载、保存与错误状态

Canvas 顶部只保留一个文档状态，不用多个互相冲突的 Toast：

- `正在加载`：显示骨架画布，禁止编辑。
- `已保存`：展示最近 revision。
- `正在保存`：允许继续编辑，串行合并下一次保存。
- `保存失败`：保留本地图，提供重试；不得丢弃用户修改。
- `版本冲突`：停止自动保存，提供重新加载；第一版不做自动合并。
- `正在验证` / `验证通过` / `验证阻塞`。
- `正在发布` / `已发布 vN`。

节点状态叠加优先级：运行失败 > blocked > disabled > bypass > running > completed > idle。lock 作为独立角标，不覆盖运行状态。

组件/能力目录加载失败时：

- Canvas 已存在的节点仍可打开和保存；
- 节点库显示错误与“重试”，不显示永久 loading；
- 依赖未加载的节点标记 `capability_unavailable`，Validation Run 阻止发布；
- 错误需区分网络失败、401/403、后端 5xx 和空目录。

## 10. 编译与运行规则

- 编译器是所有执行路径的唯一前置校验，不允许前端直接绕过。
- 编译展开递归 Package，但保留 `package_parent_id`、`package_path`、版本 pin 和操作状态。
- bypass 由统一运行调度层处理，不调用具体 adapter；产生 started/completed 事件并标记 `bypassed: true`。
- disabled 不调度 Worker；产生 skipped/blocked 诊断，行为由下游输入是否可选决定。
- locked 不影响编译结果和运行，仅影响 Draft 编辑。
- imported/compat Draft 必须完成当前 revision 的 Validation Run 才能发布。
- 真实运行必须绑定已验证 capability/Worker；模拟兼容运行不得满足“生产可运行”能力标记。

## 11. 验收标准

### 前后端闭环

1. 用户打开已持久化 Workflow，进入两层 Package，刷新后图不损坏且可回到根图。
2. 提升一个内部参数，在外层修改、保存、重新打开后值保持；编译后的内部节点得到该值。
3. 对支持的单入单出节点启用 bypass，Validation Run 不调用 adapter，结果透传且 Run 事件可见。
4. Disable 节点后不调度执行器，下游显示明确 blocked/skipped 原因。
5. Lock 节点后前端禁止参数、连线、删除和内部编辑；Unlock 后恢复。
6. 创建 Workflow 局部覆盖后只修改当前 Draft，另一个 Workflow 和已发布 Version 不变化。
7. 任一操作保存后 revision 增加，之前的 Validation Run 不再允许发布。
8. 两个页面编辑同一 Draft 时，旧 revision 保存得到 409，不静默覆盖。
9. 编译错误可从 Run 面板跳转到对应 Package 路径和内部节点。
10. 组件目录请求失败后 5 秒内结束 loading，Canvas 可继续打开已有图，并提供重试。

### 兼容边界

11. 导入 Dify/n8n 图后，UI 明确显示“兼容验证（模拟）”。
12. fixture/passthrough 产生可追踪结果，但发布页不得把它描述为真实第三方执行成功。
13. 未安装真实 runtime 的第三方副作用节点显示 blocked/preview-only。

### 回归

14. 旧 Workflow 未包含 `execution` 字段时能正常加载、保存和运行。
15. 16 层以内递归 Package 可编译；第 17 层及循环包含稳定失败并定位路径。
16. 已发布 Version 在 Draft 后续修改、Package 更新或局部覆盖后保持不变。

## 12. 分期

### P0：让现有组件真正加载并可保存

- 修通 capabilities / node catalog 的前后端请求、鉴权和错误状态。
- 为 Draft PUT 增加 revision 乐观锁。
- 统一 Canvas 加载、保存、冲突和目录失败状态。
- 用浏览器跑通 Studio → Canvas → 保存 → 重新打开。

停止条件：已有节点组件不再无限 loading，用户修改不会静默丢失。

### P1：核心 Houdini 操作闭环

- 持久化 `execution.mode/locked`。
- 完成 Package 进入/退出、面包屑和路径恢复。
- 完成参数提升的创建、编辑、删除和编译绑定。
- 实现 bypass/disable/lock 的编译、运行事件和 UI 状态。
- 实现 Workflow 局部覆盖的 Draft 内复制语义。

停止条件：第 11 节前 10 项在真实前后端环境通过。

### P2：发布与可观测性收口

- 将节点操作状态、覆盖来源和精确依赖 pin 固化进 Version。
- 错误跳转到内部 Package 路径。
- 版本列表展示验证类型、runtime 类型和模拟/真实标识。
- 补齐节点级 Run 状态与事件回放。

停止条件：发布、重新打开、运行历史和不可变性验收通过。

### P3：真实兼容 Worker（独立后续）

- 定义并接入 Dify/n8n 实际 runtime adapter。
- 能力探测、凭据引用、超时、取消、重试和副作用审计。
- 用真实执行结果替换 fixture/passthrough，并保留模拟模式用于测试。

停止条件：至少一个 Dify 和一个 n8n 有副作用的样例由真实 Worker 执行并留有 Run 证据。

## 13. 协同开发切分

- Cloud / 后端：P0 revision 冲突；P1 execution schema、编译与运行语义；P2 Version/Run 投影；P3 runtime adapter。
- 当前前端：组件目录加载修复、节点命令、Package 导航、参数提升 UI、状态与错误跳转。
- 联调共同责任：每个阶段使用同一个 canonical fixture，从 API 创建 Draft，不允许只用前端本地示例证明完成。

下一步先执行 P0。P1 不应在组件目录仍加载失败、Draft 仍可能被覆盖时并行铺开，否则节点操作无法形成可信闭环。
