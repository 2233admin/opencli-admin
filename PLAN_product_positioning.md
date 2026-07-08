# OpenCLI Admin — 产品定位与架构原则（Fork）

> **状态**：方向锁定（2026-06-18）  
> **Obsidian 副本**：`Documents/Obsidian/Research/opencli-admin/开发调研-产品与架构-2026-06-18.md`

## 一句话定位

**带登录态的采集调度器 + 结构化数据出口**；补 n8n 抓不了的那段；**不是** Mac Mini 舰队控制台，**不是** n8n 替代品。

## 分工

| OpenCLI Admin | n8n |
|---------------|-----|
| 浏览器会话（CDP/Bridge） | Webhook 下游编排 |
| Adapter 采集与 normalize | 去重、通知、写第三方 |
| SQLite `records` | 集成与自动化 |

## 第一性原理（最小闭环）

1. Session — LAN 上谁方便挂 Chrome（**Windows / Linux 均可**）  
2. Adapter — 站点 → 结构化记录  
3. Schedule — 何时采  
4. Egress — webhook / export / 知识库  

Mac Mini 集群是规模化选项，**不是**个人 NAS lab 默认路径。

## 控制论 + OODA（反馈优先）

先闭合：**采到了吗 → 下游 ACK 了吗 → 会话还有效吗**；再扩张多节点执行器。  
**OODA 现状**：Observe/Orient 弱，Decide 无输入，Act（多 Agent）过重 — 操作者完不成一圈「观察→调整」。  
当前欠账：质量仪表、webhook 投递反馈、去重/异常 Orient、规则化 Decide、数据 egress。

## Fork 优先级

1. 文档：NAS + LAN Session + n8n 模板  
2. 单机/LAN UI 模式（隐藏舰队 IA）  
3. Records 导出 API  
4. UI reskin（见 `PLAN_ui_reskin.md`）  
5. Obsidian / 媒体（按需）

## X / 中文社区市场叙事（2026-06-18 调研）

### 声量结构

| 项目 | X 上的角色 | 典型叙事 |
|------|------------|----------|
| **OpenCLI**（jackwener） | 主声源 [@jakevin7](https://x.com/jakevin7) | Agent 读写基础设施、Browser Bridge、站点 CLI、自愈 adapter |
| **OpenCLI Admin**（xjh1994） | **二次传播**，非作者主导 campaign | 舆情监控、多 Chrome 多账号、Mac Mini 集群、Docker、AI 打标 + 飞书 |

**高曝光帖**（公开可读）：

- [@codesth](https://x.com/codesth/status/2034660940139167956) — 2026-03-19，~302K views，README 式摘要  
- [@liangwenhao3](https://x.com/liangwenhao3/status/2036756586048463328) — 2026-03-25，~8.1K views，`#AI #采集`

**中文长文**（与 X 叙事一致）：[zymn.cc 舆情实战](https://zymn.cc/2026/03/28/opencli-admin-monitoring-dashboard/) — Mac Mini A/B/C 分工、飞书推送、AI 摘要打标。

**竞品参照**：[@wey_gu](https://x.com/wey_gu/status/2052443011632791888) 将 Printing Press 与 OpenCLI 类比（CLI-factory / 登录态浏览器），说明「网站→CLI」赛道在 2026 仍热，但 **Admin 层几乎无人单独讲叙事**。

### 市场默认故事 vs Fork 差异

| 维度 | 上游 / 社区默认 | 本 Fork 主张 |
|------|-----------------|--------------|
| 硬件 | Mac Mini 舰队、多机多账号 | **任意 LAN 会话机**（Windows/Linux）；Mac 仅规模化选项 |
| 能力 | 浏览器 + opencli 为主 | **多执行面**：RSS/API/Web/CLI/脚本；浏览器是 capability 之一 |
| 价值句 | 舆情面板 + AI 打标 + IM 推送 | **采到了然后呢**：normalize → egress → OODA 反馈（ACK、质量、会话健康） |
| 编排 | 产品内通知为主 | Admin 抓 + **n8n 接**；不替代 n8n |

### Fork 对外话术候选（A/B）

1. **个人 lab**：「NAS 调度 + LAN 登录态 — 带会话的采集调度器，不是爬虫脚本堆。」  
2. **执行面**：「浏览器只是节点之一；RSS/API/脚本同样进同一套 records 出口。」  
3. **缺口**：「opencli 把数据搬下来；我们补 **结构化落库 + webhook + 可观测闭环**。」

## 待用户确认

- 数据终态：Obsidian / Postgres / 仅 n8n？  
- 是否需要非文本资产管道？  
- 对外主推哪条话术（上表 1/2/3）？