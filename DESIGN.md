# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-07-23
- Primary product surfaces: 概览、任务与通知、项目、工作流编排、项目数据工作台、逻辑与证据、插件中心、自动化与 Agent、成果与数据、执行资源、模型与连接。
- Authority order:
  1. 本文档定义产品体验、信息架构和交互决策。
  2. `docs/DESIGN_SYSTEM.md` 定义锁定的视觉 token、组件纪律和动效约束。
  3. `docs/adr/0015-*`、`0017-*`、`0018-*`、`0019-*` 定义插件、工作流节点和可展开包的领域边界。
  4. 当前 Next.js `frontend/app/` 与 `frontend/components/` 是实现事实；旧 `frontend/src/`、Vite 和 Topology Lab 描述不再作为新设计依据。
- Evidence reviewed:
  - `README.md`
  - `docs/DESIGN_SYSTEM.md`
  - `docs/design-audit-2026-07-02.md`
  - `docs/adr/0002-use-accessible-operator-ui-foundations.md`
  - `docs/adr/0015-plugin-ui-is-declarative-and-platform-rendered.md`
  - `docs/adr/0017-only-executable-flow-steps-are-workflow-nodes.md`
  - `docs/adr/0018-expandable-business-nodes-without-a-fixed-depth-hierarchy.md`
  - `docs/adr/0019-locked-plugin-node-definitions-and-project-owned-derivatives.md`
  - `frontend/app/globals.css`
  - `frontend/lib/navigation.ts`
  - `frontend/components/shell/app-shell.tsx`
  - `frontend/components/shell/app-sidebar.tsx`
  - `frontend/components/flow/workflow-editor.tsx`
  - `frontend/components/flow/nodes/workflow-node.tsx`
  - `frontend/components/flow/command-palette.tsx`
  - `frontend/components/flow/inspector.tsx`
  - `frontend/lib/workflow/node-catalog.ts`
  - `frontend/lib/workflow/node-contracts.ts`
  - Browser evidence for `/studio/workflow` at 1398 × 1288, including Normalize Items, Dedupe Items, Record Acceptance Gate, Record Sink, and Webhook Notify.

## Brand

- Personality: 冷静、精确、技术可信、面向执行者；像任务控制台，不像营销型 SaaS。
- Trust signals: 真实运行状态、明确端口和数据类型、可追溯来源、可见的锁定/版本关系、动作后果可预期、失败不伪装成成功。
- Avoid: 装饰性渐变、无意义光效、过度圆润的大卡片、模糊的“AI 已完成”文案、颜色单独承载状态、把尚未接线的能力展示为可运行。

## Product goals

- Goals:
  - 让用户从业务目标出发组装可运行的数据与 Agent 工作流，而不是先理解内部脚本细节。
  - 将高频、同质、顺序稳定的节点链封装为可复用业务包，同时保留原子节点供高级用户单独编排。
  - 保持插件、节点定义、节点实例、运行资源和运行结果之间的边界清晰。
  - 让每个节点的能力状态、配置要求、输入输出、运行证据和恢复动作在一个可检查路径内闭环。
  - 让 Agent 提议与人工编辑共享同一套节点契约、权限和版本规则。
  - 保留 OpenCLI 已形成的项目、工作流、节点状态和 Dark Ops Console 外壳，在项目内部以可替换适配器承接成熟的数据探索、文件处理、运行追踪与证据图能力。
- Non-goals:
  - 插件中心不是第二个工作流画布，也不承载任意插件自定义前端。
  - 工作流画布不是项目、连接、凭证、Agent 部署、执行资源或数据记录的通用对象图。
  - 不要求所有节点都具有固定四层内部结构；只有复杂或复用价值明确的节点才展开内部图。
  - 不在节点卡片上展示完整参数表、日志或所有运行工件。
  - 不通过复制三个脚本来实现“打包”；包应复用同一运行能力和稳定契约。
- Success signals:
  - 新用户能在节点选择器中直接找到“记录清洗与准入”，无需手动拼接三个节点。
  - 用户能在父级画布识别包的业务目的、运行状态和稳定输出，并可在需要时进入内部图诊断。
  - 原子节点与包共享一致的参数名、状态语义和运行证据，不出现两套行为。
  - BLOCKED、缺少连接或缺少权限时，界面能指出具体原因和可执行恢复动作。
  - 用户能分清“安装插件”“添加节点”“配置实例”“运行工作流”四种动作。

## Personas and jobs

- Primary personas:
  - 业务编排者：用业务节点快速搭建采集、清洗、审核、存储和通知流程。
  - 高级工作流工程师：检查端口、内部图、参数绑定、版本和运行 trace，必要时派生自定义节点。
  - 平台管理员：安装和升级插件，管理连接、模型、凭证、Agent 与执行资源。
  - 审核/运营人员：处理人工复核、失败恢复、结果交付和通知。
  - AI Agent：根据同一份节点目录和契约提出可审阅的图变更，而不是绕过治理直接执行。
- User jobs:
  - 找到一个能完成业务任务的节点或包，并判断它是否真的可运行。
  - 配置公开参数，不必理解包内每一步实现。
  - 进入包内部解释失败、查看数据如何被处理，或显式派生自定义版本。
  - 从运行事件定位输入、输出、拒绝原因、指标和外部副作用。
  - 在插件中心完成能力安装、连接和健康检查，然后回到画布使用能力。
- Key contexts of use: 桌面优先的长时运行控制台；中英文业务术语并存；人类和 Agent 共同编辑；可能存在慢网络、远端执行节点和部分能力不可用。

## Information architecture

- Primary navigation:
  - 工作台：概览、任务与通知。
  - 构建：项目、插件中心、自动化与 Agent。
  - 运行与数据：成果与数据、执行资源。
  - 管理：模型与连接。
- Core routes/screens:
  - `/studio`: 项目与工作流入口，管理业务上下文和版本生命周期。
  - `/studio/workflow`: 可执行数据流/控制流编排；默认展示业务级 Operator/Package 节点。
  - `/studio/projects/[projectId]/data`: 项目数据工作台；以数据集、字段剖析和文件处理三个渐进视图检查工作流真实产物。
  - `/studio/projects/[projectId]/evidence`: 逻辑与证据；以运行轨迹、决策图和证据关系三个视图解释项目结果与来源链路。
  - `/plugins`: 能力发现、安装、升级、权限、连接、健康和可用节点说明。
  - `/sources`、`/schedules`、`/agents`、`/skills`: 自动化资源与 Agent 配置，不作为画布节点本体。
  - `/inbox`、`/tasks`、`/notifications`: 待处理工作、运行异常和通知。
  - `/records`: 被准入并持久化的成果数据。
  - `/nodes`、`/workers`: 执行资源与容量。
  - `/providers`、`/control/actions`: 模型、连接、权限与审计。
- Content hierarchy:
  - Workflow header: 项目身份与工作流切换 > 编辑/运行/发布生命周期 > 次级工具。
  - Canvas: 可执行业务流 > 选中节点 > 连接和端口 > 辅助网格与控件。
  - Node card: 业务名称 > 能力/执行状态 > 一行关键摘要 > 输入输出。
  - Inspector: 配置 > Prompt（适用时）> 本次运行结果 > Trace/契约；高级内部细节默认折叠。
  - Plugin center: 能力价值与状态 > 安装/连接动作 > 注册的节点和工具 > 权限、版本与诊断。

## Design principles

- Principle 1 — Business first, implementation on demand: 父级画布首先回答“这一步做什么”，内部节点和 primitives 只在诊断或自定义时出现。
- Principle 2 — Truth before polish: REAL、BLOCKED、SIM、NEXT 等状态必须由能力投影和运行事实驱动；不以静态前端标签假装可用。
- Principle 3 — Stable boundary, inspectable interior: 可展开包对父图提供稳定端口和版本，内部图可检查；普通参数修改不改变包结构。
- Principle 4 — One capability, multiple compositions: 原子节点和组合包调用同一能力实现与契约，避免复制脚本和行为漂移。
- Principle 5 — Progressive disclosure: 画布保持低噪声，参数进 Inspector，运行事件进 Trace，管理对象留在各自管理页面。
- Principle 6 — Recovery is part of the state: BLOCKED 和错误态必须同时给出原因、缺失对象和下一步动作。
- Principle 7 — OpenCLI shell, replaceable engines: 导航、权限、项目上下文、视觉 token 与状态语义由 OpenCLI 统一；Perspective、DuckDB、OpenTelemetry、Langfuse、OpenLineage 等成熟能力只通过适配器进入，不把第三方产品外壳直接复制进来。
- Tradeoffs:
  - 为提高信息密度可使用紧凑节点，但关键状态和正文不得牺牲可读性。
  - 包降低主画布复杂度，但必须保留进入内部图、查看版本与派生自定义节点的路径。
  - 默认隐藏高级实现细节，但不隐藏会改变数据、权限或外部副作用的事实。

## Workflow node model

- Product model: 工作流只使用三种显式语义角色；角色由节点定义声明，不由画布下钻深度推断。
  - L1 业务节点（What）：父级工作流中的业务任务与稳定契约。它说明要完成什么，暴露业务输入输出、公开参数、能力状态和运行状态；简单业务节点可以在本层结束，不要求存在内部图。
  - L2 实现节点（How）：实现某个业务节点的可复用、可版本化能力或节点包。它声明插件/项目来源、版本、运行模式、公开参数与所有权状态，并可展开为执行图。
  - L3 执行节点（Do / 原子能力）：真正由 runtime 调用的最小步骤，必须具有可解析的 runtime binding，不允许继续包含内部节点。
- Composition rules:
  - 复杂 Native 节点遵循 `L1 business -> L2 implementation -> L3 execution`；简单 L1 节点可以直接绑定隐藏实现而不制造空的内部层。
  - L1 只能包含 L2；L2 可以组合其他 L2 能力或 L3 执行节点；L3 必须是叶子。
  - 父级外部端口在查看内部图、参数修改、插件升级比较和项目派生前后保持稳定。
  - 画布 breadcrumb 表示当前 scope，不承担节点角色推断；`networkStack.length` 只描述导航深度。
- Contract exposure and aggregation:
  - 节点功能采用声明式软编码：下级节点定义自己的 typed ports、公开参数、可调用动作、运行状态和 trace artifacts；上级节点只能从这些已声明能力中选择、组合、重命名和收窄，不能凭空写死或扩大能力。
  - 能力沿 `L3 -> L2 -> L1` 自下而上提升；业务意图、策略覆盖和参数值沿 `L1 -> L2 -> L3` 自上而下绑定。数据流与控制流仍按图的边方向运行，不与能力暴露方向混为一谈。
  - L2/L1 通过声明式 exposure map 选择需要公开的子节点端口、参数和动作。未显式暴露的内部能力保持私有，不因子节点存在而自动泄漏到父级。
  - 父级公共契约由 compiler 根据 pinned 子节点定义和 exposure map 投影生成；UI、Agent Builder、校验器和 runtime 使用同一份投影结果，不维护各自的静态节点功能表。
  - 派生结果必须版本固定：软编码不等于运行时随意漂移。子定义升级后先产生 contract diff；只有通过兼容性校验并发布新父定义版本，实例才采用新接口。
  - 暴露映射失效、类型不兼容或引用的子能力消失时，compile 必须返回明确 Capability Gap，不能静默删除端口、回退为 mock 或伪造父级能力。
  - 参数提升复用现有 `parameterInterface.binding` 思路；端口、动作、状态和 trace 采用同样的可追踪绑定模型，最终统一为一个版本化 public contract projection。
- Classification rules:
  - Package 是节点定义的分发与组合形式，不是独立层级。一个 Package 可以提供 L1 业务定义、L2 实现定义和内部 L3 执行图。
  - Plugin、project-native、plugin-locked、project-derived 描述来源与所有权，不是层级。
  - Experiment 描述能力用途或 L2 实现的生命周期，例如 baseline、candidate、verified、released，不是固定的“实验节点层”。Prompt 实验作为业务步骤时仍是 L1，其候选实现和实验运行分别落在 L2/L3。
  - 现有“组件节点”和“原子节点”合并为 L3 执行节点；组件只作为目录分组或实现术语，不再形成第四种用户心智。
- Current compatibility boundary:
  - 当前 `WorkflowProject.internals`、compiler、runtime node path 和回归测试仍允许最多四段物理嵌套，这是旧图兼容上限，不是产品层级定义。
  - 新节点和新 UI 不再根据 L1-L4 深度硬贴角色标签；迁移期间旧四层图可读、可运行，但新建 Native 图应收敛到上述三种语义角色。
  - Managed 外部执行包可以由 L2 自身作为运行权威；Native L2 包以内含的 L3 执行节点作为运行权威。

## Visual language

- Color:
  - 遵循 `docs/DESIGN_SYSTEM.md` 的 Dark Ops Console：页面底、面板、悬浮三级表面；zinc 灰阶；单一 primary 蓝用于焦点和选中。
  - success/warning/danger/info/agent 使用角色型 signal token；状态必须同时带文字或图标。
  - 高密度关系图中的标签不得直接以无承托白字覆盖关系线；普通标签使用半透明深色底保证轮廓，当前节点使用其对象语义色同时高亮文字和边框。检查器标题与当前证据步骤沿用同一对象色，其他正文保持灰阶层级。
  - 当前 `globals.css` 与锁定 token 文档存在漂移；新功能不得新增第四套色值，迁移应集中完成。
- Typography:
  - 中文 UI 使用现有 `Noto Sans SC`/UI 字体，标识符、端口、参数、数值和 trace 使用 `IBM Plex Mono`/`font-mono`。
  - 10px 仅用于非关键遥测注记；状态、按钮、错误和操作说明不低于 11px。
  - 英文大写用于短类型码和状态码，不用于长句。
- Spacing/layout rhythm: 4px 网格；画布节点、检查器分组和工具栏保持紧凑但有稳定分区；避免通过额外卡片套层制造层级。
- Shape/radius/elevation: 控件 2px、面板/节点 6px、弹层 8px；优先边框和表面差异，阴影只用于面板、overlay 和拖拽层级。
- Motion: 通用 transition 使用 120/160/200/300ms 档；70/180/320ms 仅对应 press/response/spatial 物理反馈 token。动效只表达按压、空间切换、面板进入和节点状态变化；不得用持续动画代表静态状态。
- Imagery/iconography: 使用 Lucide 和现有节点 glyph；图标解释对象类型或动作，不作为装饰。Package 通过 `PACKAGE/LOCKED` 语义和微型内部图标识，不引入独立艳色。

## Components

- Existing components to reuse:
  - `frontend/components/ui/*` 的 Button、Badge、Dialog、Tabs、Select、Tooltip、Card、Table、ScrollArea 等原语。
  - `frontend/components/shell/*` 的 AppShell、AppSidebar、AppHeader、CommandPalette 和数据状态组件。
  - `frontend/components/flow/*` 的 WorkflowCanvasSurface、WorkflowNode、CommandPalette、Inspector、RunTracePanel、PanelShell、SectionCaption。
- New/changed components:
  - Canvas context action menu：右键不再直接展开节点全集，也不在菜单内嵌 DOP/primitive 多级目录。空白画布和节点都先提供短动作菜单：`添加节点`、`添加注释`、`测试运行`、`导入应用`；节点右键再以“当前节点”分组提供进入内部网络、选择流程分支、参数与节点信息。
  - Node picker：由原来的“⌘K + 所有操作/节点混排”改为渐进式目录，顶部固定 `节点 / 工具 / 开始` 三个入口和当前入口专属搜索。`节点` 按业务/逻辑/数据/输出等真实 catalog 分类展示，`工具` 聚合 OpenCLI、插件与运行工具并提供来源筛选，`开始` 承载 AI 生成、导入应用和画布起始动作；目录项仍只消费后端能力投影与现有节点定义。
  - Context-to-picker placement：右键位置只决定新节点落点；选择器自身保持居中、可滚动且不随画布边缘裁切。通过顶部“添加节点”打开时，落点为当前视口中心。
  - Annotation action：`添加注释` 直接创建现有 `note` palette item，不再要求用户先进入完整节点目录；流程图形与分组容器仍留在节点选择器的辅助分类。
  - Import action：`导入应用` 复用现有 Dify / n8n / canonical JSON / Mermaid 导入链路，不引入第二套解析逻辑。
  - Record Hygiene & Acceptance（“记录清洗与准入”）：L1 显示一个业务节点；L2 显示版本化 Record Hygiene 实现；其安装的 Node Definition 默认声明 Normalize → Dedupe → Record Acceptance Gate 三个 L3 执行节点，而不是由页面或模板硬编码内部功能。
  - Record Hygiene public contract：L3 分别声明自身端口与参数；L2 通过 exposure map 聚合为清洗管线；L1 只提升业务需要的 `items[] -> record[]`、公开策略参数和运行状态。`rejected`、`metrics`、duplicate evidence 与 lineage 只提升为 trace artifacts。
  - Package node summary：展示 `items[] → record[]`、REAL/BLOCKED、LOCKED/DERIVED、内部步骤数；不把 `rejected` 和 `metrics` 伪装成可连线端口。
  - Package inspector：首屏只暴露 language metadata、preserve source refs、dedupe key/window、acceptance mode/schema/lineage/quality 等公共参数；内部绑定和 trace 放到高级区。
  - Package scope header：进入内部图后显示面包屑、来源插件/版本、锁定状态和“派生为项目节点”动作。
  - Project data workbench：固定提供 `数据集 / 字段分析 / 项目文件` 三个视图。数据集复用真实项目记录、搜索、状态过滤和详情抽屉；字段分析从当前数据计算类型、填充率、唯一值与分布；项目文件只展示真实可追溯来源和处理状态，尚未接线的上传能力必须明确标记为预览或禁用。
  - Logic and evidence workbench：固定提供 `运行轨迹 / 决策图 / 证据关系` 三个视图。运行轨迹按真实运行、记录和来源时间排序；决策图展示显式步骤、观察、证据与结果摘要，不显示或伪造模型内部原始思维链；证据关系复用项目关系图和可审计最短路径。
  - Evidence relationship inspector：桌面端与关系图并列时使用独立实色表面，按“节点摘要 → 关键指标 → 纵向证据路径 → 直接关联 → 上下文操作”排序；不使用横向自动换行的路径标签堆叠，不把所有正文都提升为同一白色权重。窄屏时该检查器转为图谱下方的完整宽度区域。
  - Canvas workbench dock：工作流画布工具条固定提供 `编排 / 数据 / 证据` 三个工作视图。`编排` 保持纯画布；`数据` 与 `证据` 在画布右侧打开节点上下文面板，直接读取当前选中节点的端口契约、批次、运行事件和上游路径，并提供进入完整项目工作台的链接。侧边工作台是观察与诊断面，不复制节点参数编辑，也不伪造尚未产生的运行数据。
- Variants and states:
  - Definition ownership: `plugin-locked`、`project-derived`、`project-native`。
  - Capability: `real/runnable`、`blocked`、`simulated`、`future/unknown`。
  - Execution: `idle`、`running`、`succeeded`、`failed`、`cancelled`；不得与 Capability 状态合并为一个徽标。
  - Package scope: collapsed、focused、inside-scope、locked、customizing。
  - Validation: valid、warning、invalid；端口不兼容和缺少必填参数应阻止发布，未必阻止草稿编辑。
- Token/component ownership:
  - 视觉 token 与文字角色集中在 `frontend/app/globals.css` 并受 `docs/DESIGN_SYSTEM.md` 管理。
  - 通用原语归 `frontend/components/ui/`，Shell 归 `frontend/components/shell/`，画布与节点交互归 `frontend/components/flow/`。
  - 节点目录、契约、国际化、内部图和运行能力分别保留在现有 `frontend/lib/workflow/*` 边界；页面不得复制这些定义。

## Accessibility

- Target standard: WCAG 2.2 AA；高密度操作台不豁免对比度、键盘操作和语义要求。
- Keyboard/focus behavior:
  - 所有按钮、链接、节点菜单、Inspector tabs、对话框和画布工具必须有可见 `:focus-visible`。
  - `Ctrl/Cmd+K` 打开全局命令，节点选择器提供键盘搜索、分组导航和 Escape 关闭。
  - 右键动作菜单使用真实 button 和 menu 语义；打开节点选择器后焦点进入搜索框，Tab 可遍历页签和目录项，Enter 选择首个搜索结果，Escape 关闭并返回画布。
  - 节点必须可被键盘选中；进入/退出内部图、打开参数和运行节点都要有非鼠标路径。
  - 焦点不能被画布缩放、抽屉或路由转场吞掉。
- Contrast/readability:
  - 关键标签和 11px 以下文字不得使用已审计失败的低对比 zinc-500/600 组合。
  - REAL/BLOCKED/LOCKED 等均使用文字；端口类型和边连接不能只靠颜色区分。
- Screen-reader semantics:
  - 节点的 accessible name 包含业务名、节点类型、能力状态、输入/输出数量。
  - 包应声明可展开状态和当前 scope；状态点设置 `aria-hidden`，由相邻文本提供语义。
  - Run Trace 使用有序事件语义，并为错误、拒绝和外部副作用提供文字摘要。
- Reduced motion and sensory considerations: 遵守全局 reduced-motion；关闭平滑滚动和非必要位移；运行中状态仍需有静态文字替代。

## Responsive behavior

- Supported breakpoints/devices: 桌面是完整编排目标；平板支持查看、选择、配置与运行；手机至少支持查看状态、处理 Inbox 和打开只读运行证据。
- Layout adaptations:
  - 桌面保留侧栏、项目头、画布、可开合 Inspector/Trace。
  - 窄屏侧栏折叠为 rail；Inspector、Trace 和节点选择器转为互斥 Sheet，不与画布并排挤压。
  - 画布节点不为适配屏宽而缩小关键文字；使用 viewport fit、平移和聚焦选中节点。
  - 表格使用自身横向滚动；Shell 不产生页面级水平滚动。
- Touch/hover differences: hover 只增强反馈；所有 hover 动作都要有点击/长按或菜单入口；触摸目标优先使用至少 36px，关键确认动作使用至少 44px。

## Interaction states

- Loading: 保留 Shell、项目头和画布 viewport；节点能力加载时使用局部 skeleton，不把已有状态清空。
- Empty: 解释第一步业务动作，例如“添加记录清洗与准入”，同时提供节点选择器入口；不解释整套产品。
- Error: 明确是配置、连接、权限、运行资源、运行逻辑还是外部交付失败，并给出对应恢复入口。
- Success: Toast 指明对象和动作，例如“工作流草稿已保存”；运行成功需要可进入 Trace/成果，不使用泛化庆祝文案。
- Disabled: 保留控件上下文，并用邻近说明或 Tooltip 解释具体前置条件。
- Offline/slow network: 保留最近一次已知状态并标记陈旧；保存与发布需要明确 pending/failed，不静默丢失编辑。
- Blocked capability: 节点仍可在草稿中查看和配置，但运行/发布入口显示缺少的插件、连接、凭证、权限或执行资源，并链接到正确管理面。
- Locked package: 可改公开参数、可进入只读内部图；结构性编辑只能通过显式“派生为项目节点”，必须展示来源和差异。
- Run trace: `records` 是可路由输出；`rejected`、`metrics`、duplicate evidence 和 lineage 是可检查 trace artifacts，不在父级画布暴露成普通输出端口。

## Content voice

- Tone: 准确、克制、面向动作；先说对象和状态，再说原因与恢复方法。
- Terminology:
  - 产品导航和任务使用中文；稳定技术标识保留英文并用中文解释。
  - 固定词汇：插件、节点定义、节点实例、节点包、内部图、项目派生、运行、运行证据、成果、执行资源、连接、准入、拒绝、来源链路。
  - `language=zh-CN` 表述为“语言元数据标注”，不得暗示会翻译内容。
  - Dedupe 当前只描述为“本次输入批次内按业务键和时间窗口去重”，不得暗示跨运行持久缓存。
- Microcopy rules:
  - 动作使用“动词 + 对象”：安装插件、添加节点、进入内部图、派生节点、保存草稿、试运行、发布版本。
  - 状态与动作分离：`BLOCKED` 是状态，“配置连接”是恢复动作。
  - 不使用“智能完成”“一键搞定”等无法由运行证据证明的表达。
  - 包名称面向业务；内部节点名称可以保持标准工程术语。

## Implementation constraints

- Framework/styling system: Next.js App Router、React 19、TypeScript、Tailwind CSS v4、shadcn/Base UI、XYFlow/Zustand；沿用现有组件和依赖。
- OSS integration boundary: 首个可见版本用现有项目 API、Table、关系图和图表组件验证信息架构；后续将 Perspective/DuckDB-Wasm、Uppy/PDF.js、OpenTelemetry/Langfuse/OpenLineage 等能力接入独立 adapter，不以页面硬编码替代真实引擎。
- Design-token constraints:
  - `docs/DESIGN_SYSTEM.md` 的锁定 token 是目标；禁止页面级新增硬编码近黑色、任意字号、任意圆角或平行动效曲线。
  - 先修复/复用共享 token 和组件，再调整页面；不得用局部颜色补丁解决语义状态。
- Domain constraints:
  - 只有可执行数据流或控制流步骤是 Workflow 节点。
  - 插件只声明 schema、能力、权限、状态和本地化元数据，由平台渲染 UI；不加载任意插件前端。
  - Plugin Node Definition 默认锁定；结构修改创建带来源与差异的 Project Node Definition。
  - Expandable Node 对父图保持稳定外部端口；内部图通过独立、带面包屑的 scope 打开。
  - 节点语义角色固定为 business、implementation、execution；不得再用物理深度、Package 类别或 Experiment 状态替代节点角色。
  - 上层节点能力必须来自已固定下级定义的声明式暴露与聚合；禁止在页面、模板、目录适配器或 compiler 分支中按节点 ID 硬编码父级功能。
  - Record Hygiene package 的父级输出仅为 `record[]`；拒绝项和指标属于 trace artifact。
  - 真实业务验收不得以 compile/run 状态、事件数或 EvidenceBatch 数量替代产物验收；采集结果必须落入项目数据工作台，可按来源、批次、运行与准入状态检查，并能从记录回到对应 Run Trace。
- Performance constraints:
  - 画布平移、缩放、拖拽和流式运行事件不得导致无关节点重挂载。
  - 节点卡片只渲染摘要；大型 JSON、事件和工件按需在 Inspector/Trace 加载。
  - 命令面板和目录搜索应在本地索引可用时即时响应，远端能力状态增量合并。
- Compatibility constraints:
  - 保留现有 WorkflowProject、节点目录、运行能力投影、端口契约和四段物理嵌套兼容校验，直到完成旧图迁移；产品文案和新图只使用三种显式语义角色。
  - 中英文混排需保持布局稳定；新增用户可见文本必须进入现有工作流 i18n 边界或明确记录迁移债务。
- Test/screenshot expectations:
  - 交互修改先运行对应 `frontend/scripts/check-*.mjs`，再运行 TypeScript 与 ESLint。
  - 节点包改动至少覆盖：目录可发现、添加为单一父节点、内部顺序、锁定行为、参数提升、端口/动作/状态暴露聚合、父级输出契约、版本差异和 Trace artifacts。
  - 真实业务工作流只有同时满足“非 fixture 数据运行、数据工作台可见实际记录、至少一条记录可检查来源/血缘、修改节点参数后可重跑并对比前后批次”才算业务跑通；缺少任一项只能算 runtime smoke。
  - 浏览器 smoke 覆盖 `/plugins` 与 `/studio/workflow`；桌面基线使用约 1398 × 1288，并额外检查窄屏 Sheet/rail 行为。
  - 视觉改动应保存前后截图或自动化证据；当前仓库尚无完整 Playwright/Cypress 视觉回归基线，这是已知验证缺口。

## Open questions

- [ ] Workflow migration / 何时为 Node Definition 增加可校验的 `nodeRole: business | implementation | execution` 与声明式 exposure contract，并自动迁移只有一个 implementation child 的旧 Operator 包装和静态 Package 契约？影响 schema、compiler、runtime path 和回归测试。
- [ ] Product / 是否将“记录清洗与准入”作为新工作流的默认推荐包，还是仅在节点选择器中优先展示？影响空状态和模板。
- [ ] Product / 插件中心的安装范围是平台级、工作区级还是两者兼有？影响权限、版本和可见性文案。
- [ ] Workflow / “派生为项目节点”首版是否开放结构编辑，还是先只提供只读内部图与复制 JSON？影响锁定包交互。
- [ ] Runtime / 去重何时引入跨运行持久索引？当前设计和文案明确限定为本次输入批次。
- [ ] Accessibility / 画布键盘连线与节点重排采用何种完整交互模型？影响 WCAG 2.2 AA 验收范围。
- [ ] Responsive / 手机端是否正式支持编辑工作流，还是定义为只读与运行处置？在确定前不得通过缩小字号强行塞入完整画布。
- [ ] Design system / `frontend/app/globals.css` 的 shadcn 语义色与 `docs/DESIGN_SYSTEM.md` 的 ops/primary/signal token 何时单轨化？新工作不得扩大现有漂移。
- [ ] i18n / 导航与 Studio 的中文硬编码何时迁移到统一语言资源？影响英文界面和插件本地化验收。
- [ ] Workbench engines / Perspective + DuckDB-Wasm 与 OpenTelemetry + Langfuse 的首个生产适配器边界、数据量阈值和许可证复核何时进入 ADR？当前页面只验证 OpenCLI 内的信息架构与真实数据交互。
