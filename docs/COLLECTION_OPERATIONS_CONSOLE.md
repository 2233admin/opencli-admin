# Collection Operations Console

状态：Draft  
最后更新：2026-06-25

## 1. 目标

Collection Operations Console 是 OpenCLI Admin 面向操作者的主工作面。

它把采集运行视为需要捕获、分拣、归属、推进状态、实时观察和关闭的工作，而不是一张被动日志表。

目标不是做更大的 dashboard，也不是做 canvas-first workflow tool。目标是让带浏览器会话的采集工作在失败、过期、阻塞、噪声过大、产出质量不确定时更容易处理。

## 2. 设计论点

工作本身有摩擦。界面应该减少阻力。

OpenCLI Admin 借鉴 Linear 作为软件系统的工作模型，而不是只借鉴视觉风格：

- capture：把失败、空结果、无 ACK、疑似站点变化转成可见工作
- triage：把需要处理的 run 和被动历史分开
- ownership：清楚显示 Data Source、node、run、责任路径
- state transition：让 run 的处理状态可推进、可关闭
- feedback loop：每个动作都立刻返回可检查结果

产品不能变成“钟表铺”：一个永远开着的 widget 墙，看起来技术完整，但不告诉操作者下一步该做什么。

## 3. 产品表面

### 3.1 Run Inbox

Run Inbox 是主工作队列，用来替代被动的 Recent Runs 表格。

Run Inbox 状态是人的处理状态，不是后端 task 执行状态：

- `running`：run 正在发生，需要可观察
- `needs_attention`：失败、空结果、超时、无 ACK、阻塞、疑似站点变化
- `ready_to_review`：有新 records，需要人工判断质量
- `resolved`：已确认完成或已处理
- `ignored`：明确忽略，让它停止打扰操作者

后端 `pending`、`running`、`completed`、`failed`、`cancelled` 仍然是执行事实。Run Inbox 状态描述的是人的处理工作。

### 3.2 Data Sources

Data Sources 是资源目录，负责配置、健康、归属和 Collection Plans 入口。

Data Source 表面回答：

- 这是什么源？
- 它是否健康？
- 它什么时候运行？
- 最近哪里出过问题？
- 现在应该看哪个 run？

它不应该永久展示所有 pipeline 细节。

### 3.3 Live Collection View

Live Collection View 绑定到一个 run。

当 run 处于 active、needs attention 或 ready to review 时，操作者可以打开它。

它只显示当前 run 类型需要的面板：

- pipeline event stream
- browser / CDP / agent render view
- records preview
- raw output
- screenshots 或 artifacts
- notification ACK state
- error diagnosis
- retry 或 node actions

默认形态是按需打开的右侧抽屉或可拆出的工作区。全屏只用于 browser render 或 artifact inspection 确实需要空间的场景。

### 3.4 Adaptive Run Surface

Adaptive Run Surface 是 Live Collection View 背后的布局行为。

它根据 run 类型和状态选择面板，而不是默认展示所有面板。

`react-grid-layout` 用于操作者需要同时比较多个 live artifacts 的场景。它不用于主页面 shell。

示例：

- opencli / CDP run：event stream + browser render + raw output + records
- RSS / API run：event stream + raw response + records
- notification issue：event stream + payload + ACK state
- failed run：event stream + error diagnosis + retry action

### 3.5 Diagnostic Canvas

Diagnostic Canvas 是次级表面，用于理解关系、排障链路和未来 workflow authoring。

FlowGram 作为 canvas / workflow authoring adapter。我们不自研 canvas infrastructure。

Diagnostic Canvas 回答：

- Data Source、Collection Plan、Run、Record、Notification、Browser Instance、Edge Node 如何关联？
- 当前 run 阻塞在哪里？
- 如果编排或修改 workflow，它会做什么？

它不作为默认操作入口。

## 4. UI 基础

### 4.1 Radix

Radix 提供交互 primitives：Dialog、Popover、Dropdown、Select、Tabs、Tooltip、focus management。

行为和 accessibility 重要的地方优先使用 Radix，不本地重造这些交互。

### 4.2 FlowGram

FlowGram 提供 workflow / canvas infrastructure，用于 Diagnostic Canvas 和未来 Workflow Authoring。

FlowGram 是 Collection Operations Console 背后的 adapter。Collection Operations 的 domain language 不能依赖 FlowGram 概念。

### 4.3 react-grid-layout

react-grid-layout 提供可调整、可重排的 Adaptive Run Surface 面板。

它用于 run 视图，不用于主页面结构。

### 4.4 OpenBB Design System

OpenBB Design System 是密集专业 workbench 的参考和候选依赖。

在确认 license 兼容前，不复制或发布 OpenBB 代码。未完成 license check 前，它只作为 design research。

### 4.5 现有 desktop / yUI 气质

现有 desktop / yUI 工具感是资产：

- 直接控制
- 状态可见
- 密集但可读的面板
- 不做装饰性叙事
- 操作者信心优先于营销感

现代化不能把这部分抹掉。

## 5. 动效

动效用于解释状态变化，不用于装饰。

使用命名 cubic-bezier tokens：

- drawer open / close
- panel attach / detach
- new event highlight
- run state transition
- error reveal

避免：

- 无限装饰循环
- 发光式 busywork
- 没有目的的机械 linear motion
- 延迟动作反馈的动画

动效要让系统更响应、更可读。

## 6. module 形状

### 6.1 Collection Operations module

Collection Operations module 拥有操作采集工作的 domain interface。

它隐藏：

- 后端 task 执行状态
- query fan-out
- run classification rules
- action availability rules
- inbox grouping
- live panel selection

它暴露：

- Run Inbox groups
- selected Data Source summary
- selected Run summary
- available actions
- Live Collection View panel plan

### 6.2 UI adapters

UI 表面都是 adapters：

- Run Inbox adapter
- Data Source directory adapter
- Live Collection View adapter
- Diagnostic Canvas adapter
- Workflow Authoring adapter

这些 adapters 可以使用 Radix、FlowGram、react-grid-layout 和现有本地组件，但不能拥有 domain rules。

## 7. 第一轮实施切片

按这个顺序实施：

1. 引入并固定基础轮子：Radix primitives、FlowGram、react-grid-layout、OpenBB UI license gate。
2. 新增前端 Run Inbox model。
3. 在不改后端 schema 的前提下，把现有 tasks / runs 分类到 Run Inbox 状态。
4. 用 Run Inbox groups 替代 Sources / Collection Operations 里的被动 Recent Runs。
5. 为 selected run 添加 Live Collection View drawer。
6. 添加 SSE-backed event stream 和 records preview 面板。
7. 仅当 run metadata 支持时，添加 browser / CDP render 面板。
8. 添加 Diagnostic Canvas 入口，并使用 FlowGram adapter。

这个顺序保持行为可逆，同时建立正确的 seam。

第一版 Run Inbox 状态采用 client-side derived。`running`、`needs_attention`、`ready_to_review` 从现有 `tasks`、`task_runs`、`records`、`notification logs` 推导；`resolved` 和 `ignored` 第一版只保存在本地 UI 状态。等产品形态验证后，再决定是否持久化到后端 schema。

部署链路第一版要能看到端到端效果，而不是只做本地静态 demo。Live Collection View 的实时事件传输采用 SSE first, WebSocket later：后端基于现有 `TaskRunEvent` 提供 selected run 的事件流，前端在 run active 时保持 SSE 连接，run 结束后关闭或切换为静态历史。Docker 和 native dev 两条路径都必须可运行，代理、CORS、重连和端口配置纳入第一轮验收。

基础轮子不能后补：Radix 已经部分存在，第一轮继续用它承载 drawer/dialog/tabs/select 等 interaction seam；FlowGram 必须以 adapter 形式进入 Diagnostic Canvas 入口；react-grid-layout 必须以 adapter 形式进入 Adaptive Run Surface；OpenBB UI 进入依赖评估 gate，license 兼容前不复制或发布其代码，但设计 token、密度、workbench pattern 的对照要在第一轮完成。

## 8. 验收标准

- 用户打开 Collection Operations 后能立刻看到哪些 runs 需要处理。
- 正在运行的 collection 可以在不离开当前操作上下文的情况下观察。
- 失败或空结果 run 可以在一个地方检查和重试。
- Data Source 配置不会被埋进 canvas。
- Diagnostic Canvas 可用，但是次级入口。
- Collection Operations domain rules 可以不渲染完整页面就测试。
- FlowGram 和 react-grid-layout 是 adapters，不是 domain dependencies。

## 9. 未决问题

- 今天能保证哪些 run artifacts：logs、records、raw output、screenshots、browser URL、notification ACK？
- ownership 第一轮指用户归属、node 归属，还是 Data Source 归属？
- OpenBB UI license 验证后，哪些部分可以直接依赖，哪些只能参考？
