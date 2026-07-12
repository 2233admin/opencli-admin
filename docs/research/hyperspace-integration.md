# Hyperspace Agent 集成研究

> 调研日期：2026-07-12。本文只使用 Hyperspace 官方网站、官方 Web 应用与官方 GitHub 仓库。官网中的节点数量、积分和收益等数字属于官方自述，未作第三方验证。

## 结论

可以支持，但不应把 Hyperspace 简化成一个“采集节点”，也不应把它接成平台的总 Agent Runtime。

最小且正确的边界是一个 **Hyperspace Integration Package**，初期暴露多个节点：本地/P2P 推理、Embedding、分布式存储、分布式 Memory、代理访问，以及状态/能力读取。Integration Package 连接本机 `hyperspace` daemon 的 REST/WebSocket 管理接口，平台的 Workflow、Run、Worker、Gate、Artifact、Data Feed 和 Signal 仍是事实源。

Hyperspace daemon 还可以作为 Worker 上的一个受管外部服务：Worker 报告其可用能力，节点按需调用。只有未来确实需要复用 Hyperspace 自带的自治脑、持久目标/日志和多步 orchestration 时，才追加一个可选 **Agent Runtime Provider**；这不是第一阶段依赖。

它不适合作为“外部消费者”作为唯一定位，因为其主要价值是向平台提供推理、Embedding、存储、Memory、代理和 P2P 网络能力。不过可以另加一个 Data Subscription，把本项目 Data Feed/Signal 中获准外发的任务或能力公告投递给 Hyperspace；该方向必须显式配置，不能默认广播采集数据。

## 产品定位与实际能力

[Hyperspace Agent 官网](https://agents.hyper.space/)将产品描述为去中心化 P2P 网络上的自治 AI Agent：用户可从浏览器或 CLI 运行节点，贡献推理和分布式机器学习研究能力并获得积分。官方 CLI README 将其进一步定义为 Hyperspace 去中心化 P2P AI inference network 的命令行 Agent，可运行本地模型并向网络提供算力。[官方 CLI README](https://github.com/hyperspaceai/aios-cli/blob/main/README.md)

官方列出的九类网络能力是：

1. Inference：向其他 peer 提供模型推理。
2. Embedding：生成文本向量，官方称 CPU-only 也可运行。
3. Storage：基于内容寻址和 DHT 的块存储。
4. Memory：带复制的分布式向量存储。
5. Relay：为 NAT 后节点提供 circuit relay。
6. Validation：参加 pulse verification。
7. Orchestration：协调多步 AI 任务及结果链。
8. Caching：缓存推理结果。
9. Proxy：向 Agent 提供代理访问。

这些能力同时列于[官方 CLI README 的 Network Capabilities](https://github.com/hyperspaceai/aios-cli#network-capabilities)和官网 Web 应用的 How It Works/Features 页面。它们表明 Hyperspace 是“分布式 AI 能力网络”，不是网页、媒体或业务数据采集产品。Proxy 可以帮助采集 Workflow 访问网络，但采集策略、浏览器自动化、原始证据、覆盖判断和数据治理仍需由本项目负责。

## 开源、仓库与许可证核验

官方公开仓库是 [`hyperspaceai/aios-cli`](https://github.com/hyperspaceai/aios-cli)。README 明确声明它是 **release-only repository**：只发布预编译二进制和自动更新资产，源代码位于私有 monorepo。因此当前不能把它视为可审计、可修改或可内嵌构建的开源 Agent 框架。[官方说明](https://github.com/hyperspaceai/aios-cli#hyperspace-cli)

截至调研日，仓库根目录只公开 `README.md`、`.gitignore` 与安装脚本目录；README 的 License 段落指向 `LICENSE`，但公开仓库并不存在该文件，GitHub 仓库元数据也未识别许可证。[官方仓库内容](https://api.github.com/repos/hyperspaceai/aios-cli/contents) · [仓库元数据](https://api.github.com/repos/hyperspaceai/aios-cli)

因此可确认的是“官方允许下载和运行其发布物”；无法从公开一手资料确认复制、修改、再分发、打包进本产品镜像或提供衍生版本的许可证授权。首期集成应采用 **用户独立安装 + localhost API 调用**，不要把二进制再分发进 Integration Package。若要自动安装、镜像分发或商业托管，必须先取得官方许可证或书面授权。

## 运行机制与协议

官方资料披露的网络栈包括：

- libp2p P2P 网络；
- GossipSub 广播；
- Kademlia DHT 发现与内容寻址；
- Circuit Relay v2 解决 NAT 连接；
- WebSocket transport、Yamux 多路复用和 Noise 加密；
- Ed25519 身份/peer ID；
- 用于能力、信誉和研究排行榜的 CRDT；
- 推理请求的 local registry → DHT lookup → gossip broadcast 三层路由。

来源：[官方 CLI Features](https://github.com/hyperspaceai/aios-cli#features)与[Hyperspace Agent 官网](https://agents.hyper.space/)的 How It Works/Features 页面。

CLI 以后台 daemon 运行，可自动发现 GPU/VRAM、选择 profile、下载 GGUF 模型、使用 CUDA/Metal 原生推理，并发现现有 Ollama。`hyperspace start` 自动选择配置；也可用 `--profile inference|embedding|relay|storage|proxy|full` 限定角色，或用 `--api-port 8080` 开启指定端口的管理 API。[Quick Start 与 Start Options](https://github.com/hyperspaceai/aios-cli#quick-start)

### API 与协议可用性

官方 README 只承诺“可配置端口上的 REST and WebSocket management API”，没有发布稳定的 OpenAPI、协议版本兼容承诺或 SDK。[Features](https://github.com/hyperspaceai/aios-cli#features)

官方 Web 应用当前通过 `http://localhost:8080` 调用该 daemon，可观察到 `/api/v1/identity`、`/api/v1/peers`、`/api/v1/gpu`、`/api/v1/state`、`/api/v1/models/status`、模型下载/加载/卸载、配置、Agent 状态/目标/日志/研究等端点，并连接 `/ws`。但这些端点来自官方前端实现，不等同于已发布、稳定、带兼容保证的公共协议。

所以首期适配器必须：

- 启动时探测版本和所需端点，而不是假定完整 API；
- 对每个能力分别做 health/capability probe；
- 将“不支持、版本不兼容、daemon 离线”明确返回为节点失败或能力不可用；
- 不直接读取 `~/.hyperspace/identity.json`，也不导出私钥；
- 把 Hyperspace peer identity 与本项目 Worker identity 分开保存；
- 将任何会消耗积分、转账、质押、代理外发或网络发布的动作置于平台 Gate/策略之下。

P2P wire protocol 没有公开规范和源码可供本项目可靠实现，因此不应自行实现 Hyperspace peer。唯一受支持的接入面应是官方 CLI/daemon 及其管理 API。

## 部署方式

官方提供 Linux、macOS 和 Windows 预编译发布物；Linux/Windows 有 x86_64，macOS 有 ARM64/x86_64，官方 releases 还可见 ARM64 Linux 资产。安装器把文件放入 `~/.hyperspace/`（Windows 为 `%LOCALAPPDATA%\Hyperspace\`），安装本地推理组件，并可安装桌面 tray app。[安装与平台支持](https://github.com/hyperspaceai/aios-cli#install) · [官方 Releases](https://github.com/hyperspaceai/aios-cli/releases)

daemon 可通过 `hyperspace install-service` 注册为 OS 服务；官方也说明 Linux 使用 systemd、macOS 使用 LaunchAgent。网络连接需要允许出站连接，README 当前写明 TCP 4002/WebSocket，官网 FAQ 同时提到 4001–4002；应以运行时健康检查为准，而不是在平台中硬编码单一端口。[System Commands](https://github.com/hyperspaceai/aios-cli#system) · [Connection issues](https://github.com/hyperspaceai/aios-cli#connection-issues)

推荐部署模型：每台需要该能力的 Worker 独立安装 daemon，绑定 loopback 管理端口，由 Worker 进行健康检查和调用。不要把本机 API 暴露到集群公网，也不要让控制面直接跨网访问每台 daemon。

## 与本项目领域模型的映射

| Hyperspace 能力/对象 | 本项目映射 | 推荐定位 |
|---|---|---|
| P2P inference / local inference | Processing node | `Hyperspace Inference` 节点；输入 prompt/model/options，输出结果、模型、local/P2P 路径、耗时与成本证据。 |
| Embedding | Processing/index node | `Hyperspace Embedding` 节点；输出 Derived Representation，不替代平台索引事实源。 |
| Proxy | Collection transport node/provider | `Hyperspace Proxy Fetch` 或采集节点的显式 transport；原始响应仍保存为 Artifact。不要把“代理成功”误当成采集覆盖完成。 |
| Storage | Artifact/Data Feed sink 或 source | 两个节点：publish block、fetch block。内容地址作为外部引用；平台仍保存 provenance、ACL 和发布状态。 |
| Memory | Processing sink/query source | 两个节点：upsert memory、semantic query。不能取代平台 Data Feed、Artifact 或权威数据库。 |
| Caching | 节点内部优化 | 初期不单独建节点；由 Integration Package 在调用结果中标记 cache hit。 |
| Relay / Validation | Worker capability/health | 主要是 Hyperspace 网络内部职责，平台只展示状态，不进入普通 Collection Canvas。 |
| Hyperspace orchestration | 可选 Agent Runtime Provider | 后置；只有需要其自治循环或多步任务时接入。平台 Run/Gate/Inbox 仍拥有外层状态。 |
| Agent brain、goal、journal、research | 外部 Agent Runtime 状态 | 默认只读观测；若作为 Runtime Provider，映射 invocation/session 并把结果写回 Artifact/Data Feed。 |
| Peer capability announcement | Signal `capability` | Worker 可将经过规范化的可用模型/能力发布为平台 Signal，带 TTL 和 health evidence。 |
| Research milestone/observation gossip | Signal `information` | 仅在用户授权后桥接；必须附来源和 Hyperspace peer/protocol provenance。 |
| P2P task request/result | Workflow node invocation | 由节点适配器发起；结果不绕过 Run、重试、审计和 Coverage Policy。 |

## 为什么应是“多个节点的 Integration Package”

单个 `Hyperspace` 万能节点会混合不同风险和数据契约：推理、Embedding 是处理；Proxy 是采集传输；Storage/Memory 是外部读写；自治 Agent 是长时运行；质押和钱包则是资金副作用。将它们塞进一个节点会让权限、输入输出、重试和 Gate 无法准确表达。

最小包不需要复制九个网络服务。首期只暴露有明确 Workflow 价值的五类节点：

1. `Hyperspace Inference`
2. `Hyperspace Embedding`
3. `Hyperspace Proxy Fetch`
4. `Hyperspace Storage Put/Get`
5. `Hyperspace Memory Upsert/Query`

Relay、Validation、Caching 作为 daemon 状态或内部优化；Orchestration/Agent Brain 后置为可选 Runtime Provider；Wallet/Staking 不进入通用数据 Workflow。

## 数据、Signal 与安全边界

Hyperspace 是外部 P2P 网络。凡是通过 P2P inference、Storage、Memory、Proxy、gossip 或 research sharing 发送的数据，都应被平台视为“离开本地信任域”，即使 daemon 运行在本机。

集成必须遵守：

- 节点配置明确显示 `local` 或 `p2p` 路径；不得静默从本地降级到 P2P。
- 默认不向 Hyperspace 发布 Data Feed、Artifact 或 Signal。
- 外发内容经过 workspace policy、敏感信息检查和必要 Gate。
- 返回结果保留 peer/model、请求模式、时间、版本、成本/积分与原始响应引用。
- Hyperspace 返回的推理或研究内容只是一个来源，不能自动提升为事实或覆盖完成。
- Coverage Policy 未满足时继续调用获准的 Collection 节点，并明确返回缺口；Hyperspace inference 不能用模型记忆填补证据缺口。
- capability Signal 带 TTL；daemon/模型离线后立即过期，避免调度到陈旧能力。

## 决策建议

- **确认支持 Hyperspace，但以 Integration Package 为安装单元、多个节点为产品表面。**
- **首期由 Worker 调用本机官方 daemon；不重写 P2P 协议，不再分发官方二进制。**
- **Processing、Collection transport、Storage/Memory 分开建节点。** 这是权限和数据契约的真实边界，不是额外架构。
- **Agent Runtime Provider 后置且可选。** 只有出现复用 Hyperspace 自治 brain/orchestration 的真实 Workflow 后再做。
- **允许作为 Data Feed/Signal 的外部消费者，但必须是单独、显式授权的订阅/桥接节点。**
- **许可证视为未明确授予。** 获得官方许可或公开许可证前，只支持用户独立安装与 localhost API 集成。

