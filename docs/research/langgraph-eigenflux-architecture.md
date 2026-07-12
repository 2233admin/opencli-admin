# LangGraph 与 EigenFlux 架构研究

> 调研日期：2026-07-12。结论只依据官方文档、官方源码仓库和项目官网；产品数字与路线图按“官方自述”处理，不作为独立验证事实。

## 结论

不建议把 LangGraph 接成平台的总工作流引擎。它最适合作为一种可选的 **Agent Runtime / Node Provider**：某个节点内部需要长时间、多轮、可中断的 Agent 推理时，可以由 LangGraph 执行；平台仍以既有的 Workflow Version、Run、Gate、Inbox、Worker Connection 和 Data Feed 为事实源。否则会形成两套运行、审批、版本和恢复语义。

EigenFlux 值得借鉴的不是其整套微服务，而是一个独立的 **Agent Signal Network**：结构化广播、自然语言订阅、异步 enrichment、相关性匹配、去重、信誉/反馈，以及广播后点对点通信。它可以建立在本项目 Data Feed 与 Data Subscription 之上，不应取代采集、证据、新鲜度或 Coverage Policy。

## LangGraph 的实际职责

LangGraph 官方将其定义为构建长时间、有状态 Agent 的低层编排框架，而不是通用分布式采集、数据总线或集群调度系统。其核心开源仓库采用 MIT 许可证；部署、Studio 与托管运行属于更大的 LangSmith 产品面。[官方仓库](https://github.com/langchain-ai/langgraph) · [部署文档](https://docs.langchain.com/langsmith/deployment-quickstart)

| 能力 | 官方机制 | 与本项目的关系 |
|---|---|---|
| Durable execution | 在节点边界保存 checkpoint；失败或长时间暂停后按 thread 恢复。节点内恢复可能重放，因此中断前副作用必须幂等。 | 与 **Run 的持久状态、恢复、重试**高度重叠。可借鉴 checkpoint namespace、幂等重放规则；不另建第二套顶层 Run。 |
| Persistence | Checkpointer 保存单个 thread 的图状态；Store 保存跨 thread 的应用数据。官方明确区分 thread-scoped 短期状态和跨 thread 长期数据。 | Checkpointer 近似 **Agent Session + Run checkpoint**；Store 与平台数据层部分重叠。平台的 Artifact/Data Feed/证据不能退化成 LangGraph Store 黑盒。 |
| Interrupts | `interrupt()` 持久化当前状态并无限期等待；使用同一 `thread_id` 和 `Command(resume=...)` 恢复；payload 要可序列化。 | 与 **Gate Request/Decision + Inbox read model + Run resume**几乎同构。LangGraph interrupt 只能做节点内部暂停信号，必须映射到平台 Gate，不能自己成为审批事实源。 |
| Human-in-the-loop | 对工具调用按策略 approve/edit/reject；底层依赖 interrupt 与 checkpointer。 | 与平台统一 Control Action、风险策略、Gate、Inbox 重叠。可借鉴 edit/reject feedback 和流式 interrupt payload，不采用独立 HITL UI/状态库。 |
| Subgraphs | 图可作为父图节点；支持 schema 映射、按 invocation/thread 的持久模式，适合多 Agent 或复用节点集合。 | 与 **封装节点、组合模板、子工作流**重叠。可借鉴明确 I/O schema、checkpoint namespace、per-invocation 默认隔离。平台封装节点不必因此依赖 LangGraph。 |
| Deployment | LangSmith Deployment 提供 CLI/UI 部署、API、后台 runs、threads、流式结果与 Studio 状态检查/回放。 | 与 **Workflow Version/Deployment Revision、Worker scheduling、Run、Live Canvas**重叠最深。若接入，只部署为受平台管理的 Runtime Package，由 Worker 调用；不能让 LangSmith deployment 成为平台部署事实源。 |

来源：[Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)、[Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)、[Human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)、[Subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs)、[Fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance)、[LangSmith Deployment](https://docs.langchain.com/langsmith/deployment-quickstart)。

### 推荐的最小接入边界

1. 定义一个 `LangGraph Agent` 集成包/节点，而不是引入新的平台级编排抽象。
2. `Workflow Version` 固定 graph/package/config 版本；`Run` 保存外层状态，LangGraph `thread_id/checkpoint_id` 只作为该节点的执行引用。
3. LangGraph interrupt 转换为平台 Gate Request；Gate Decision 恢复原 Run，并幂等地向 LangGraph 发送 resume command。
4. 节点输出、原始证据、模型/工具调用 provenance 进入 Artifact/Derived Representation/Data Feed；不可只留在 checkpoint。
5. Worker Connection 仍负责能力报告、租约、心跳与结果返回。LangGraph 不负责跨设备 Worker 调度。
6. 只有出现真实的“多轮、有状态、需要暂停恢复的 Agent 节点”后再实现适配器；普通确定性节点与模板不需要 LangGraph。

## EigenFlux 的实际产品、架构与开源情况

EigenFlux 官网称其为 Agent 广播网络：Agent 可广播信息、需求或能力，以自然语言声明订阅兴趣，由 AI engine 结构化、匹配和投递，并支持收到广播后直接联系广播者。官网同时标注为 **Research Preview**；“1000+ sources”“94% token savings”等是官方营销口径，不能仅凭官网视为独立验证结果。[EigenFlux 官网](https://www.eigenflux.ai/)

官方仓库公开了其生产代码，并支持自建 Hub。README 将能力概括为：异步 LLM enrichment、基于 profile 的个性化 feed、Elasticsearch 向量检索、Bloom Filter 去重、反馈/里程碑、多级缓存；CLI 可独立运行，并有 OpenClaw 与 Claude Code 插件。仓库许可证是“Apache 2.0 加商标限制”的修改版：可使用和修改，但独立网络/产品不得使用 EigenFlux 名称或造成官方关联混淆。[官方仓库 README](https://github.com/phronesis-io/eigenflux/blob/main/README.md) · [LICENSE](https://github.com/phronesis-io/eigenflux/blob/main/LICENSE)

其当前实现是 Go + CloudWeGo 微服务：Hertz API Gateway，Kitex RPC，etcd 服务发现，PostgreSQL，Redis Streams/缓存，Elasticsearch 搜索与向量，独立异步 pipeline。发布路径是“原始 item 入库 → Redis Stream → LLM 提取摘要/关键词/领域/广播类型/质量 → embedding → PostgreSQL/Elasticsearch”；读取路径是“agent profile → ES 候选与排序 → Bloom Filter 去重 → feed”。Redis consumer group 提供 at-least-once 处理和横向扩展。[架构总览](https://github.com/phronesis-io/eigenflux/blob/main/docs/architecture_overview.md) · [Item Pipeline](https://github.com/phronesis-io/eigenflux/blob/main/docs/item_pipeline_design.md) · [Sort Service](https://github.com/phronesis-io/eigenflux/blob/main/docs/sort_service_design.md)

### 与本项目的映射

| EigenFlux | 本项目已有概念 | 判断 |
|---|---|---|
| Broadcast / processed item | Data Feed record + Derived Representation | 高度重叠，扩展 record schema 即可。 |
| Natural-language subscribe / personalized feed | Data Subscription + Agent profile filter | 可借鉴语义订阅与动态 profile，不另建 feed 系统。 |
| Async enrichment pipeline | Workflow Run + processing Nodes | 高度重叠，应由现有 Workflow 执行。 |
| Redis Streams consumer group | Worker lease / Data Subscription cursor | 语义相近但层级不同；可借鉴 at-least-once、ACK、pending recovery，不绑死 Redis。 |
| AI matching / vector ranking | Query/processing node + index provider | 可作为可替换节点；不能把相似度当作覆盖度或真实性。 |
| Bloom-filter dedup | Feed/Subscription 去重 | 值得借鉴为高吞吐近似预过滤，但权威幂等仍需稳定 record/event ID。 |
| Feedback / reputation | Finding、用户反馈、source/agent trust metadata | 值得引入，但信誉必须可解释并保留来源证据。 |
| Agent-to-agent DM | 新的 Agent Communication/Conversation surface | 本项目现有清单没有完全等价物，是最明显的新增能力。 |
| Hub service discovery | Worker Connection / control plane | 不应照搬。EigenFlux 的 etcd 是服务发现，不等于设备认证、能力证明、任务租约。 |

## 建议借鉴的 Agent 大规模通信模型

在现有 Data Feed 上增加最小的 Signal 协议，而非复制 EigenFlux 微服务：

- `Signal`: 稳定 ID、类型（information/need/capability/alert）、publisher、时间、过期时间、主题/地域/语言、证据引用、可信度声明、visibility。
- `Signal Subscription`: Agent/Project 的自然语言意图，加结构化约束、新鲜度和 Coverage Policy；编译成可审计的过滤/匹配计划。
- `Delivery`: subscription cursor、match reason、score components、dedup key、ack/feedback；相关性分数与来源可信度分开保存。
- `Reply/Contact`: 从 Signal 建立有权限、有限时、可审计的 Agent Conversation；任何外发和副作用仍经过 Control Action/Gate。
- `Federation` 后置：先完成单 Workspace/单 Hub 的发布、订阅、回放、限流和审计。只有出现跨组织互联需求时，再定义 hub identity、签名、反滥用、信任域和协议版本。

关键区别是：**广播网络负责“谁应该看到什么”，采集与 Coverage Policy 负责“我们是否真的查够了”**。EigenFlux 的语义匹配有助于打破固定订阅形成的信息茧房，但若没有来源多样性、覆盖缺口、原始证据和新鲜度，它本身也可能形成新的推荐茧房。

## 决策建议

- **现在不把 LangGraph 设为必选基础设施。** 保留 Runtime Provider 插槽，先把平台自己的 Run/Gate/Inbox/Worker/Data Feed 语义做完整。
- **现在可以定义 Signal/Signal Subscription 领域模型草案。** 它直接复用 Data Feed，能支撑 AI 新闻网、量化消息面、Agent 能力发现和集群广播。
- **不复制 EigenFlux 的服务拆分。** PostgreSQL、Redis、Elasticsearch、etcd 的组合是其实现选择，不是协议要求；本项目按现有控制面和 Worker 架构实现最小闭环。
- **优先借鉴语义订阅、match reason、反馈信誉和 Agent 联系。** 同时强制保留 provenance、freshness、coverage gaps、visibility 与 Gate，避免“高相关”被误当成“完整且真实”。
