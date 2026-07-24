# last30days-skill 能力与 OpenCLI Admin 集成评估

日期：2026-07-20

## 结论

`last30days-skill` 不是单一网站爬虫，而是一个以 Agent Skill 形式分发的多来源研究编排与证据综合引擎。它负责把“最近 30 天某个主题发生了什么、社区如何评价”拆成查询计划，并行检索多个来源，按相关性和原生参与度排序、聚类、合并，再输出研究简报或稳定的机器可读 JSON。

它与 OpenCLI Admin 的关系是互补的：

- OpenCLI Admin 适合提供抖音、小红书、Bilibili 等中国平台的登录态采集、标准化、去重、存储和持续调度。
- `last30days` 适合提供主题解析、跨来源检索计划、证据评分、趋势发现、研究简报和来源健康诊断。
- 上游仓库支持 TikTok，但未提供 Douyin 数据源；抖音应继续由 OpenCLI Admin 采集，然后接入类似 `last30days` 的研究层。

## 上游能力

仓库将产品定义为 Skill + Python Engine：`SKILL.md` 规定 Agent 如何规划与调用，`scripts/last30days.py` 执行真实研究。

主要能力：

- 近 30 天主题研究、新闻、推荐、比较和趋势发现。
- Reddit、X、YouTube、TikTok、Instagram、Hacker News、Polymarket、GitHub、Web 等多来源并行检索。
- 利用点赞、评论、浏览、转发、预测市场成交等原生指标排序。
- 实体消歧、查询计划、评论/字幕富化、跨来源聚类、去重和置信度门槛。
- `doctor`、`doctor --probe`、`doctor --postmortem` 来源健康诊断。
- Markdown、HTML 和版本化 JSON 输出。
- 本地研究库、全文搜索、watchlist、Atom feed 和趋势增量。

机器 JSON 契约包括：

- `source_status`
- `clusters`
- `results`
- `engagement`
- `relevance_score`
- `freshness_verdicts`

这使它适合成为工作流中的“研究与分析节点”，而不只是面向人的 Slash Command。

## 与现有管线的重叠与差异

| 能力 | OpenCLI Admin | last30days |
| --- | --- | --- |
| 登录浏览器采集 | 强，适合抖音等国内站点 | 部分来源支持 Cookie/API |
| 抖音数据源 | 已有 26 个命令 | 无 Douyin，只有 TikTok |
| 小红书 | 已有 OpenCLI 适配器 | 依赖外部 x-mcp/xiaohongshu-mcp |
| 标准化、去重、入库 | 已有 | 主要面向研究报告和本地研究库 |
| 多来源主题规划 | 较弱 | 强 |
| 参与度排名 | 尚未形成领域评分 | 强 |
| 跨来源聚类 | 仅有通用 merge | 强 |
| 趋势发现 | 可采热点，缺少完整判定层 | 有 discovery + confidence floor |
| 来源健康诊断 | 有基础运行状态 | 有细粒度 source status 与 doctor |
| 简报生成 | 尚不完整 | Markdown/HTML/JSON 完整 |

## 推荐集成方式

不建议直接把整个上游项目塞进采集核心。推荐分三层：

1. **Skill/Plugin 层**
   - 将“研究最近 30 天的某个主题”作为用户入口。
   - Skill 负责解析主题、时间窗、平台范围、比较/推荐/趋势意图。

2. **Workflow Research Node**
   - 新增研究规划、证据评分、聚类、趋势判定、简报生成节点。
   - 输入使用 OpenCLI Admin 已存储的标准化记录。
   - 输出采用类似上游 `agent JSON` 的稳定契约。

3. **Source Connector 层**
   - 抖音、小红书、Bilibili 继续走 OpenCLI 和本地 Browser Bridge。
   - Reddit、HN、Polymarket 等可按需要采用公开接口或独立插件。
   - 不让研究层直接持有国内平台 Cookie。

第一阶段可实现：

```text
topic / time window
  -> query plan
  -> OpenCLI sources (Douyin / XHS / Bilibili / Twitter)
  -> normalize + dedupe
  -> engagement scoring
  -> cross-source clustering
  -> confidence gate
  -> Markdown / JSON brief
  -> records + watchlist
```

## 风险与边界

- 上游采用 MIT License，可借鉴和集成，但仍应保留许可证声明。
- Python Engine 要求 Python 3.12+，并可能依赖 Node、yt-dlp、gh 以及第三方 API。
- TikTok/Instagram 主要依赖 ScrapeCreators，存在额度、费用和供应商稳定性风险。
- Cookie 读取必须明确征得用户同意；上游提供 `--preflight` 和禁用 Cookie 的选项。
- HTML 发布是外部公开操作，必须保持显式授权。
- 上游指令契约很长，直接嵌入服务端会带来升级和行为漂移风险；稳定 JSON 边界比复用整套输出提示词更适合本项目。

## 一手来源

- [Repository README](https://github.com/mvanhorn/last30days-skill)
- [Runtime SKILL.md](https://github.com/mvanhorn/last30days-skill/blob/main/skills/last30days/SKILL.md)
- [Concepts](https://github.com/mvanhorn/last30days-skill/blob/main/CONCEPTS.md)
- [Configuration](https://github.com/mvanhorn/last30days-skill/blob/main/CONFIGURATION.md)
- [Agent JSON export](https://github.com/mvanhorn/last30days-skill/blob/main/docs/reference/json-export.md)
- [Python engine entrypoint](https://github.com/mvanhorn/last30days-skill/blob/main/skills/last30days/scripts/last30days.py)
- [MIT License](https://github.com/mvanhorn/last30days-skill/blob/main/LICENSE)
