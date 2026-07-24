# `cclank/news-aggregator-skill` 实现分析

- 核对日期：2026-07-20
- 核对提交：[`b639b622a79ec242669d6111708efbf863592de4`](https://github.com/cclank/news-aggregator-skill/tree/b639b622a79ec242669d6111708efbf863592de4)
- 范围：仓库源码、Skill 说明、安装依赖和一次 Hacker News 实时冒烟运行。

## 结论

它不是一个在 Python 内部完成 AI 摘要、排序和报告生成的完整新闻系统，而是一个两层 Skill：

1. Python 负责从网页、JSON API、RSS/Atom、OPML 和 Playwright 页面采集数据，并尽量归一成 `source/title/url/time/heat/summary/content` JSON。
2. 宿主 Agent 按 `SKILL.md` 读取 JSON，翻译、总结、写 Deep Dive，并渲染成中文 Markdown 报告。

这个边界是其最重要的设计：采集尽量确定性，语义加工交给已有模型能力，因此不需要额外 LLM API Key。证据见三步工作流和统一报告模板：[`SKILL.md` L12-L48](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/SKILL.md#L12-L48)。

## 结构与数据流

```text
自然语言 / 菜单编号
        ↓
SKILL.md 选择 source、limit、keyword、deep
        ↓
fetch_news.py / daily_briefing.py
        ↓
来源适配器（API / HTML / RSS / OPML / Playwright）
        ↓
统一 JSON（stdout，可选保存到 reports/YYYY-MM-DD）
        ↓
宿主 Agent 翻译、摘要、Deep Dive、Markdown 排版
```

- `fetch_news.py` 是主入口。它在函数内注册来源 key，支持单源、多源和 `all`，再顺序调用顶层 fetcher：[`fetch_news.py` L856-L947](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L856-L947)。
- 多数来源是小型适配器：调用公开 API、抓 HTML，或复用通用 RSS 解析器。通用 RSS 解析器输出统一字段，并做三次请求重试：[`rss_parser.py` L20-L118](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/rss_parser.py#L20-L118)。
- OPML 自定义订阅从用户配置或 Skill 根目录读取，最多 8 线程并发抓取：[`fetch_user_feeds.py` L26-L69](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_user_feeds.py#L26-L69)。
- `daily_briefing.py` 用硬编码 profile 把来源分组；组内并发抓取，组与组之间顺序执行，然后输出统一 JSON：[`daily_briefing.py` L140-L165](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/daily_briefing.py#L140-L165)、[`daily_briefing.py` L197-L238](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/daily_briefing.py#L197-L238)。
- `--deep` 不是模型分析。它并发下载正文页面，移除少量标签后截取前 3000 字符，真正的“深度分析”仍由宿主 Agent 完成：[`fetch_news.py` L59-L94](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L59-L94)。
- 菜单也不是独立交互程序；`templates.md` 只是编号到命令的提示词映射，Agent 负责解释用户下一条回复：[`templates.md`](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/templates.md)。

## 聚合、筛选、排序和持久化

- 关键词过滤主要只检查标题；“AI 自动扩展成 LLM/GPT/Claude…”写在 Skill 规则中，不是通用代码自动扩展：[`fetch_news.py` L51-L57](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L51-L57)、[`SKILL.md` L174-L180](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/SKILL.md#L174-L180)。
- 没有统一评分模型。各来源保留上游顺序；国际新闻使用按来源轮询的方式混排，以获得来源多样性：[`fetch_news.py` L674-L701](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L674-L701)。
- 去重只出现在 keyword 结果不足 5 条的 Smart Fill 分支，而且只是精确比较 URL 与标题。普通多源聚合、国际新闻和日报没有事件级去重：[`fetch_news.py` L949-L980](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L949-L980)。
- 没有持久缓存、增量游标或“已读”状态。脚本只把当前结果写为带时间戳的 JSON；Markdown 报告由 Agent 另行生成：[`fetch_news.py` L838-L854](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L838-L854)、[`fetch_news.py` L986-L998](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L986-L998)。

## 做得好的地方

1. **Skill 与采集器分层明确**：不用在每个来源重复写翻译和报告逻辑，统一模板还可以约束模型输出。
2. **来源适配成本低**：通用 RSS、动态注册子来源和 OPML 能快速扩大覆盖面。
3. **证据优先于生成**：原始 JSON 先输出到 stdout，Skill 明确禁止脱离 JSON 编造新闻。
4. **降级思路实用**：HN 查询失败会退回页面抓取；保护较强的站点走 Playwright；国际新闻单源失败不会中断全部来源。
5. **来源多样性优先**：国际聚合采用 round-robin，而不是让单一高产来源占满结果。

## 局限与风险

1. **宣传能力有一部分停留在提示词层**：没有代码级语义去重、统一排序、AI 摘要或严格事实核验。
2. **时间窗口并非绝对严格**：时间无法解析时 `filter_by_hours` 会 fail-open 保留该条，因此“国际新闻严格 24h”可能被绕过：[`fetch_news.py` L33-L48](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L33-L48)。
3. **`all` 可能重复抓取和重复输出**：它同时包含 newsletter/podcast/essay 聚合器和动态注册的单个子来源，然后直接运行 `sources_map.values()`：[`fetch_news.py` L807-L830](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L807-L830)、[`fetch_news.py` L890-L930](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L890-L930)。
4. **错误可观测性较弱**：顶层 fetcher 使用裸 `except: pass`，来源异常可能静默变成缺数据：[`fetch_news.py` L938-L944](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_news.py#L938-L944)。
5. **TLS 安全被关闭**：通用 RSS 请求使用 `verify=False` 并隐藏警告，不适合直接照搬到生产系统：[`rss_parser.py` L10-L11](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/rss_parser.py#L10-L11)、[`rss_parser.py` L94-L118](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/rss_parser.py#L94-L118)。
6. **依赖声明不完整**：Playwright 脚本直接导入 `playwright`，但 `requirements.txt` 只有 `requests` 和 `beautifulsoup4`：[`fetch_bensbites.py` L1-L12](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_bensbites.py#L1-L12)、[`requirements.txt`](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/requirements.txt)。
7. **失败占位符会污染新闻结果**：Ben's Bites 抓取失败时仍返回带 `Today` 的伪条目，而不是结构化错误：[`fetch_bensbites.py` L75-L99](https://github.com/cclank/news-aggregator-skill/blob/b639b622a79ec242669d6111708efbf863592de4/scripts/fetch_bensbites.py#L75-L99)。
8. **许可证状态需复核**：README 标注 MIT，但该提交根目录没有 `LICENSE` 文件。

## 对 OpenCLI Admin 的可复用建议

可以借它的“来源适配器 → 统一证据对象 → Agent 渲染”思路，但不应直接复制脚本：

- 用声明式 source registry 代替 `main()` 中的硬编码注册，并为每个来源声明能力、速率、认证、时效和降级策略。
- 统一事件 envelope 至少包含 `source_id`、`source_url`、`published_at`、`retrieved_at`、`canonical_url`、`content_hash`、`fetch_status` 和原始证据引用。
- 在代码层完成时间规范化、canonical URL、精确去重、事件聚类和来源健康度；Agent 只负责语义摘要和展示。
- 保留原始不可变抓取产物与最终报告之间的可追溯关系，不把 `Today`、`Recent` 或抓取失败占位符当作事实。
- 使用受控并发、超时、重试、熔断和可观测错误，不关闭 TLS 校验，也不吞异常。

## 本地核验

- `python -m compileall -q scripts`：通过。
- `python scripts/fetch_news.py --list-sources`：通过，当前列出 46 个 source key。
- `python scripts/fetch_news.py --source hackernews --limit 2 --no-save`：通过，实时返回 2 条结构化 JSON。
