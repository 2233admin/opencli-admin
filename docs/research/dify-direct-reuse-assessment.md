# Dify 可直接复用能力评估

日期：2026-07-21

## 结论

OpenCLI Admin 不应复制一套 Dify 产品，也不应再建一套并行工作流。最有价值的做法是保留现有 `WorkflowProject`、能力治理、资源绑定、采集记录和证据模型，在它们下面接入 Dify 已拆出的 Apache-2.0 基础组件：

1. 用 **Graphon** 补齐通用工作流执行器和 Dify DSL 运行能力。
2. 用 **Dify Plugin SDK 的 Manifest 与能力 Schema** 作为一种可导入插件格式，再翻译为 OpenCLI 的能力清单。
3. 用 **Dify Sandbox** 作为 `Code` 节点的 Linux 隔离执行 Sidecar。
4. 从 **Dify Official Plugins** 选择性适配模型、工具、数据源、触发器和 Agent Strategy，而不是照单全收。

Dify 主仓的完整前端、租户/Workspace、Marketplace、知识库和应用发布体系不适合直接复制；其中主仓采用带附加条件的 Dify Open Source License，前端还受 Logo/版权保留条件和交互设计权利声明约束。[Dify 主仓许可证](https://github.com/langgenius/dify/blob/main/LICENSE)

## 三类复用边界

### A. 可以直接引入为依赖或 Sidecar

| 能力 | 官方实现 | 可拿程度 | OpenCLI 中的落点 | 主要条件 |
|---|---|---|---|---|
| 图执行引擎与通用节点 | [Graphon](https://github.com/langgenius/graphon) | 高 | 作为 `WorkflowProject` 下层执行器适配器 | Graphon 当前要求 Python 3.12/3.13；本项目仍以 Python 3.11 为基线，应先用独立运行时/Sidecar 或升级运行基线，而不是直接替换现有运行时 |
| Dify DSL 执行 | [Graphon DSL loader](https://github.com/langgenius/graphon) | 高 | `Dify YAML -> Graphon -> OpenCLI Run/Event/Artifact` | 需要把 OpenCLI 的模型、HTTP、文件、工具和凭据实现成 Graphon protocol；默认 DSL 支持仍有文件请求等边界 |
| Code 节点隔离执行 | [Dify Sandbox](https://github.com/langgenius/dify-sandbox) | 高 | `workflow.block.code` 的独立执行资源 | 仅支持 Linux，适合作为 NAS/Server Docker Sidecar；不能在当前 Windows 开发机上当作同进程库 |
| 插件 Schema/SDK | [Dify Plugin SDK](https://github.com/langgenius/dify-plugin-sdks) | 中高 | 新增 `dify-plugin` 兼容导入器，转换为 OpenCLI manifest/capability | SDK 与 OpenCLI 的运行会话协议不同；适合兼容格式与适配执行，不等于现有 `.difypkg` 可无条件原样运行 |
| 官方插件实现 | [Dify Official Plugins](https://github.com/langgenius/dify-official-plugins) | 中 | 选择性导入模型、工具、数据源、触发器、Agent Strategy | 官方插件库是 Apache-2.0，但插件代码常依赖 Dify SDK/session；需薄适配层与权限映射 |

Graphon 官方说明包含队列式 `GraphEngine`、运行时状态、变量池、事件、通用节点和 Dify DSL 加载。当前默认 DSL 导入覆盖 `start`、`end`、`answer`、`if-else`、`template-transform`、`code`、`llm`、`tool`、`http-request`、`variable-aggregator`、`assigner`、`list-operator`、`question-classifier`、`parameter-extractor` 等节点。[Graphon README](https://github.com/langgenius/graphon)

Dify Sandbox 是独立 Go 服务，限制不可信代码可访问的资源和系统调用，官方仓库为 Apache-2.0，当前面向 Linux/Docker。[Dify Sandbox](https://github.com/langgenius/dify-sandbox)

### B. 应复用协议和数据结构，但不能直接套运行时

| 能力 | 建议 |
|---|---|
| Plugin Manifest | 兼容其名称、版本、架构、运行器、资源申请、权限和扩展声明，然后投影为 OpenCLI 自己的插件安装、能力注册、凭据和运行资源。官方 Manifest 明确描述 runtime、resource、permission 以及 tools/models/endpoints/agent strategies。[Manifest 官方文档](https://docs.dify.ai/en/develop-plugin/features-and-specs/plugin-types/plugin-info-by-manifest) |
| Tool 插件 | 转换成 OpenCLI 可调用工具节点；输出统一进入 Record/Evidence/Artifact，而不是保留 Dify 私有消息类型。Dify Tool 本身面向 Agent 和 Workflow 的可调用动作。[Tool Plugin 官方文档](https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/tool-plugin) |
| Model Provider | 复用 provider/model/credential/capability schema 思路，映射到现有 `ModelProvider` 和远端算力资源；不重做一套模型设置页。Dify 模型插件覆盖 LLM、Embedding、Rerank、STT、TTS 和 Moderation。[Model API 官方文档](https://docs.dify.ai/en/develop-plugin/features-and-specs/plugin-types/model-schema) |
| Datasource 插件 | 只作为“向知识管线提供文档”的一种连接器协议，不能取代 OpenCLI 的 RSS/API/OpenCLI/网页采集节点。Dify 官方把 Datasource 限定为 web crawler、online document、online drive 三类，并作为 Knowledge Pipeline 起点。[Datasource Plugin 官方文档](https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/datasource-plugin) |
| Trigger 插件 | 将 Subscription/Event/output schema 映射为 OpenCLI 的触发器节点和运行输入；保留定时计划、Webhook、第三方事件的独立语义。[Trigger Plugin 官方文档](https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/trigger-plugin) |
| MCP/OpenAPI | 作为工具接入协议，而不是独立工作流系统。Dify Plugin SDK 已把 MCP 纳入 Tool Provider 类型；OpenAPI 工具以 operation id 映射为工具名。[Plugin SDK](https://github.com/langgenius/dify-plugin-sdks)、[Tool Reverse Invocation](https://docs.dify.ai/en/develop-plugin/features-and-specs/advanced-development/reverse-invocation-tool) |
| DSL 导入导出 | 兼容 Dify 的 `kind/app/workflow/graph/dependencies`，但导入后必须经过 OpenCLI 的能力、资源、权限和运行校验。Dify 官方导入服务会做版本兼容、依赖分析和敏感凭据过滤。[Dify App DSL Service](https://github.com/langgenius/dify/blob/main/api/services/app_dsl_service.py) |

Dify 官方把插件分为 Tool、Model、Agent Strategy、Extension、Datasource 和 Trigger。这个分类可以作为 OpenCLI 插件能力声明的兼容层，但 OpenCLI 的产品语义仍要保持“只有可执行的数据流/控制流步骤才是节点”。[Choose a Plugin Type](https://docs.dify.ai/en/develop-plugin/getting-started/choose-plugin-type)

### C. 不建议直接复制

| 能力 | 原因 | OpenCLI 应保留的做法 |
|---|---|---|
| Dify `web/` 前端和 Marketplace 页面 | 主仓许可证要求多租户场景另行商业许可，Dify 前端不得移除/修改 Logo 与版权信息，且声明交互设计受外观专利保护 | 对齐功能分组和交互原则，不复制源码、页面结构或视觉像素 |
| 完整 Dify API/Workspace/租户体系 | 会与现有 OpenCLI 项目、连接、运行资源、Agent、记录和权限模型形成第二套权威数据 | 只接插件/执行能力，OpenCLI 继续做控制面 |
| 完整知识库/RAG 子系统 | 包含文档、Chunk、索引、Embedding、Rerank、元数据、向量数据库和检索配置，是独立数据产品，不是一个节点 | 先把采集记录与证据投影稳定，再增加可选知识索引插件；不要让 RAG 取代采集数据模型 |
| Dify Plugin Daemon 整套直连 | Daemon 管理 local/debug/serverless 运行时，但与 Dify API、Workspace 安装状态、Redis、存储及 Python 运行环境耦合；官方还说明社区版不适合平滑多副本扩容 | 借用协议和生命周期设计；若需要兼容 `.difypkg`，先做单独 `dify-plugin-runtime` 适配服务，而不是嵌入 API 主进程。[Plugin Daemon](https://github.com/langgenius/dify-plugin-daemon) |

## 对照 OpenCLI Admin 现状

### 已经有了承接面

- `frontend/lib/workflow/dify-translator.ts` 已能识别 Dify App DSL 并保留节点、边、来源和 DSL 元数据。
- `frontend/lib/workflow/node-catalog.ts` 已建立 Dify 兼容的组件目录。
- `backend/workflow/compiler.py`、`runtime_registry.py`、`capability_projection.py` 已形成 OpenCLI 自己的编译、运行绑定和能力真相层。
- `backend/workflow/external_importer.py` 已坚持“外部图进入 OpenCLI 后转换为受治理的原生能力”，这与本评估的接入方向一致。
- 现有模型 Provider、Celery/Redis、调度、运行事件、资源与 Agent Runtime 可以承接 Dify 的协议能力，不需要再建一套控制面。

### 目前还不是“Dify 能执行”

当前 Dify 翻译器把 Dify 图封装为 `package.compat.dify-workflow`，把 LLM/Agent 映射到 `mode: "mock"`，把 Knowledge/HTTP/Tool 映射到 `mode: "fixture"`，并设置 `canFetchNetwork: false`。因此现在是“能导入、能显示、能保留语义”，不是“能原样执行 Dify 工作流”。

## 建议落地顺序

1. **Graphon 兼容运行时 Spike**：只接一条 `Dify DSL -> Graphon -> OpenCLI Run Events` 路径，先跑纯逻辑节点与 HTTP，保持现有 `WorkflowProject` 是权威项目格式。
2. **Dify Plugin Manifest 导入器**：解析 `.difypkg`/Manifest，展示插件声明的 Tool、Model、Datasource、Trigger、Agent Strategy，并把未适配能力标为 `BLOCKED`，不能假装可运行。
3. **Sandbox Sidecar**：让 `workflow.block.code` 获得真实隔离执行；输出写入 OpenCLI Artifact/Evidence。
4. **选择性官方插件适配**：优先通用 HTTP/OpenAPI/MCP、模型 Provider、Webhook Trigger；国内网站采集继续走 OpenCLI Adapter、Cookie/Profile、Worker/算力资源，不迁移到 Dify Datasource 语义。
5. **Agent Strategy 与 HITL**：在基本执行和插件能力稳定后，再把 ReAct/Function Calling/Human Input 接到现有 Agent 与审批 Gate。
6. **可选知识索引插件**：最后增加 Knowledge/RAG，不让它阻塞当前“采集 -> 规范化 -> 分析 -> 输出”的主管线。

## 验收标准

第一阶段不以“插件中心多了多少卡片”为成功标准，而应满足：

- 一份真实 Dify DSL 能导入并在 Graphon 兼容运行时执行至少 `start -> http/tool -> transform/branch -> end`。
- Dify 插件 Manifest 能被解析成 OpenCLI capability，缺失运行时、凭据或资源时明确显示 `BLOCKED`。
- Dify 插件或节点的输出进入 OpenCLI 的 Run Event、Record、Evidence 和 Artifact，不产生第二套结果系统。
- Studio 仍只有一张 OpenCLI Workflow Canvas；Dify 是兼容来源和执行适配器，不是另一个工作流产品。
- 不复制 Dify 主仓前端源码或品牌化页面；直接使用的第三方组件逐项保留许可证与 NOTICE。
