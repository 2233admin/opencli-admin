# Perplexity 官方开源搜索评估项目研究

> 核验范围：仅使用 Perplexity 官方 GitHub 组织及其仓库内的一手资料。  
> 核验日期：2026-07-12。`search_evals` 基于提交 [`cab4c5d`](https://github.com/perplexityai/search_evals/commit/cab4c5df36e5660dc73f5580352eb52962587f01)（2026-06-08）。

## 结论

`search_evals` 值得直接复用为**离线搜索/深度研究系统的评测 runner 基线**，但不应接入采集主链路，也不能直接充当 freshness、citation、coverage 或底层 retrieval 评测器。它评估的是 Agent 最终答案：三个套件做答案正确性判定，WideSearch 对结构化结果做 precision / recall / F1。

对本项目最有价值的不是“再引入一个 Agent 框架”，而是以下现成机制：

1. `System/Provider Harness` 与 `Benchmark Suite/Grader` 分离；
2. 固定数据集 revision / SHA-256、任务构造版本和 instruction hash；
3. 可恢复运行、逐 task/attempt 的完整 trace、失败计零与失败排除两套汇总；
4. Agent 和 grader 分开核算成本；
5. 同一个 benchmark 横向比较多种搜索/研究 provider。

建议把它作为独立的 `Search Evaluation` 组件包或离线 Workflow 节点使用。平台自己的 freshness、来源覆盖、引用归因、抓取成功率和检索排序指标仍需自行实现。

## 1. 许可证与数据边界

- Runner 代码是 [MIT License](https://github.com/perplexityai/search_evals/blob/main/LICENSE)，可复制、修改、分发和商用，但需保留版权和许可声明。
- 仓库明确说明 MIT **只覆盖 runner 代码**，benchmark 数据在运行时从上游下载，继续受各自条款约束；不能把 runner 的 MIT 许可套到缓存数据上。见 [`THIRD_PARTY_DATASETS.md`](https://github.com/perplexityai/search_evals/blob/main/THIRD_PARTY_DATASETS.md)。
- 仓库不再分发标准化后的数据副本，而是通过 Hugging Face `datasets` / `huggingface_hub` 使用标准缓存。这一做法适合直接借鉴到我们的 dataset connector：保留来源、revision、许可和缓存引用，不复制一套失去出处的数据。

数据集条款摘要：

| Suite | 运行时来源 | 数量 | 上游条款/限制 |
| --- | --- | ---: | --- |
| BrowseComp | OpenAI 加密 CSV | 1,266 | 上游要求不要公开解密后的样例；代码固定文件 SHA-256 |
| DeepSearchQA (`dsqa`) | `google/deepsearchqa` | 900 | Apache-2.0；固定 Hugging Face revision |
| HLE | `cais/hle` 文本子集 | 2,158 | MIT，但访问受 gated dataset 条款约束，需先接受条款并认证 |
| WideSearch | `ByteDance-Seed/WideSearch` | 200 | 仓库记录其 LICENSE 文件为 CC0-1.0，同时提醒数据卡标签为 `other` |

固定来源、revision、行数与 contract version 的实现见 [`dataset.py`](https://github.com/perplexityai/search_evals/blob/main/search_evals/suites/dataset.py)。

## 2. 评估任务与指标

官方 README 列出四套 benchmark：[`README.md`](https://github.com/perplexityai/search_evals/blob/main/README.md)。

| Suite | 评估对象 | 当前实现的评分 |
| --- | --- | --- |
| BrowseComp | 需要持续、创造性浏览才能回答的困难事实题 | OpenAI grader 做二元 `CORRECT / INCORRECT / NOT_ATTEMPTED`，score 为 0/1 |
| DeepSearchQA | 多步信息寻找、系统整理和较穷尽回答 | 专用 grader 做二元正确性判定，score 为 0/1 |
| HLE | Humanity's Last Exam 的文本信息检索子集 | OpenAI grader 做二元正确性判定，score 为 0/1 |
| WideSearch | 收集、整理大量可独立核验事实的表格任务 | `success_rate`，按 row/item 的 precision、recall、F1；`score` 和代码声明的主指标均为 `f1_by_item` |

二元 grader 与 DSQA grader 的实现见 [`graders.py`](https://github.com/perplexityai/search_evals/blob/main/search_evals/suites/graders.py)，WideSearch 的表格解析、对齐、去重、cell judge 和指标计算见 [`widesearch.py`](https://github.com/perplexityai/search_evals/blob/main/search_evals/suites/widesearch.py)。

### 一个需要注意的官方仓库内部不一致

当前 README 的结果说明写的是 WideSearch 报告平均 `f1_by_row`，但代码中 `WideSearchSuite.primary_metric = "f1_by_item"`，最终 `GraderResult.score` 也取 `metrics["f1_by_item"]`。因此集成时应以固定 commit 的代码契约为准，不能只解析 README 表格。

## 3. Runner 与 Provider 接口

### Runner

[`EvalRunner`](https://github.com/perplexityai/search_evals/blob/main/search_evals/runner.py) 的运行单元是“一套 system 配置 × 一套 suite”：

- 并发执行 task，单 task 最多三次尝试；
- 运行前校验 provider/grader 凭据；
- 相同配置可恢复，已完成 task 直接复用；
- provider 返回已经存在、grader 尚未完成时，只续跑 grader，避免重复付费；
- 记录 task、attempt、provider 原始响应、工具调用、grader trace、错误和成本；
- summary 同时输出 `failed_as_zero` 与 `failed_excluded`，避免隐藏失败样本。

运行目录身份包含 system 配置、suite instruction SHA-256、dataset fingerprint 和可选 suffix；dataset fingerprint 又包含 source、revision、预期行数和 task construction contract version。这个可复现性设计可直接复用。

### Provider Harness

[`BaseHarness`](https://github.com/perplexityai/search_evals/blob/main/search_evals/harnesses/base.py) 的最小抽象是：

- 输入 `HarnessRequest(task_id, suite, problem, instructions, attempt_dir, run_dir)`；
- 异步 `run()`；
- 输出统一 `HarnessResult(answer, provider, model, cost, response_id, tool_calls)`；
- 提供 preflight、成本恢复/记录和 close 生命周期。

当前 registry 直接支持 [Perplexity Agent API、OpenAI Responses API、Anthropic Managed Agents、Exa Agent API、Parallel Task API](https://github.com/perplexityai/search_evals/blob/main/search_evals/harnesses/registry.py)。参数使用 Pydantic discriminated union 严格校验，配置示例见 [`systems.toml`](https://github.com/perplexityai/search_evals/blob/main/systems.toml)。

Perplexity harness 使用 background response：创建请求后持久化 provider state，通过 response id 恢复轮询，抽取最终文本、tool calls、token usage 与 provider cost。见 [`perplexity.py`](https://github.com/perplexityai/search_evals/blob/main/search_evals/harnesses/perplexity.py)。

这套接口可以直接转写为我们的 Evaluation Provider Adapter；不建议让它替代已有通用节点/Worker 协议，因为它的请求和结果都专门面向 benchmark answer generation。

## 4. 是否包含 freshness / coverage / citation / retrieval evaluation

| 能力 | 是否包含 | 核验结论 |
| --- | --- | --- |
| Freshness evaluation | 否 | 没有以发布时间、更新时间、抓取时间或查询时点为基准的专用指标/grader。日期只可能作为 WideSearch 某个答案字段，用 `date_near` 容差比较；这不是 freshness 评测。 |
| Coverage evaluation | 部分、仅答案层 | WideSearch 的 recall/F1 能衡量参考表格事实是否收集齐，可视为结构化答案的事实覆盖率；没有来源类别覆盖、独立来源数、域覆盖或采集范围 coverage policy。 |
| Citation evaluation | 否 | 没有 citation completeness、citation correctness、claim-to-source entailment、URL 可访问性或 attribution 指标。WideSearch 的 `url_match` 只比较答案单元格内 URL 的域名集合，不能等同引用质量评测。 |
| Retrieval evaluation | 否（只有端到端 IR 任务） | HLE 被描述为 information-retrieval subset，Agent 也会产生 web-search tool traces；但 runner 不评 NDCG、MRR、Recall@K、Precision@K、文档相关性或检索去重。它评的是最终回答是否正确。 |

因此，对本项目而言：

- WideSearch 的 row/item precision、recall、F1 可直接借来做“采集结果与 gold set 的结果覆盖评测”；
- freshness、来源 coverage、citation attribution 和底层 retrieval 需要新增独立 grader，不能宣称 `search_evals` 已覆盖；
- provider tool trace 可以作为后续计算这些指标的输入证据，但当前 schema 的规范化结果只保证 `tool_calls`，没有统一的 `Document/Source/Citation` 契约。

## 5. Perplexity 官方组织内其他相关项目

截至核验日，官方公开项目中与本项目搜索、采集、数据处理或 Agent 接入直接相关的主要是：

| 项目 | 官方能力 | 许可证 | 建议 |
| --- | --- | --- | --- |
| [`modelcontextprotocol`](https://github.com/perplexityai/modelcontextprotocol) | 官方 MCP server；暴露 Search API、Sonar ask、deep research、reasoning；支持 stdio 和 HTTP | MIT | **直接复用为可选 MCP/节点接入**。不要复制成平台核心；保留 API key、超时、代理、host/origin 安全策略。 |
| [`perplexity-py`](https://github.com/perplexityai/perplexity-py) | 官方 Python SDK；同步/异步 Search、Responses、Chat，类型、重试、流式和错误模型 | Apache-2.0 | **Python Worker 可直接复用**，优先于手写 REST client。`search_evals` 当前也依赖它。 |
| [`perplexity-node`](https://github.com/perplexityai/perplexity-node) | 官方 TypeScript/JavaScript SDK；Search 的多查询、域、语言、日期、recency、academic 等参数 | Apache-2.0 | **Node Worker/Integration Package 可直接复用**。这些过滤参数适合映射为搜索采集节点配置。 |
| [`ai-sdk`](https://github.com/perplexityai/ai-sdk) | 把 Search API 封装成 Vercel AI SDK tool；返回 title/url/snippet/date/last_updated | `package.json` 和 README 声明 MIT；仓库当前未见独立 LICENSE 文件 | **仅在已有 Vercel AI SDK 的前端/Agent 包中复用**；后端平台不应为这一薄封装引入 Vercel AI SDK。分发前需注意缺少 LICENSE 文件这一包装瑕疵。 |
| [`api-cookbook`](https://github.com/perplexityai/api-cookbook) | 官方示例：fact checker、daily knowledge、金融新闻、研报、学术搜索、memory/OpenAI agent 集成等 | MIT | **借鉴场景、prompt 和 API 用法**；示例不是稳定平台库，不整包依赖。 |
| [`pplx-rs`](https://github.com/perplexityai/pplx-rs) | 官方 Rust client 仓库 | MIT/Apache-2.0 双许可 | **目前不适合复用**：官方 README 明确仍是 placeholder。 |

以下公开仓库与本项目当前目标关联较弱，不建议纳入搜索/采集路线：`pplx-garden` 和 `pplx-kernels` 面向推理/GPU 内核；`pgcat`、Bazel/toolchain、Swift/UI、实验 SDK fork 等不是搜索、采集或 Agent 能力包。完整官方仓库入口为 [Perplexity GitHub organization](https://github.com/perplexityai)。

## 6. 复用分级

### 可直接复用

- `search_evals` 的 MIT runner，用于独立离线评测服务/节点；
- `BaseHarness`、统一结果 schema、resume/attempt trace、成本账本、dataset fingerprint 思路与实现；
- WideSearch 结构化结果 grader，用于有 gold set 的批量采集准确率/覆盖率；
- Python/Node 官方 SDK；已有 MCP client 场景下直接使用官方 MCP server。

直接复用仍需保留许可证，并将第三方 benchmark 数据条款单独登记。

### 只借鉴

- benchmark suite / grader 的分层方式；平台应适配已有 Workflow、Artifact、Data Feed 和 Worker，而不是复制第二套调度平台；
- provider registry：官方代码当前是显式 union + registry，适合少量 provider。我们若已有集成包发现机制，按现有机制注册即可；不必照搬静态 registry；
- Cookbook 的搜索、事实核验、金融和学术场景；
- MCP 的工具命名和边界，以及 SDK 中 search filters 的参数模型。

### 不适合或不能宣称复用

- 不能把 `search_evals` 当抓取器、索引器、广播网络或 Agent orchestration engine；
- 不能用它现有分数宣称 freshness、citation correctness、source coverage 或 retrieval ranking 达标；
- 不应把 benchmark 数据提交进本仓库或 Data Feed，尤其是 BrowseComp 解密样例和 gated HLE；
- 不建议接入当前仍为 placeholder 的 Rust SDK；
- 后端不是 Vercel AI SDK 栈时，不值得为 `ai-sdk` 的薄 tool wrapper 增加依赖。

## 7. 对本项目的最小落地建议

第一阶段只做一个独立 `Search Evaluation` 组件包，不进入数据采集主链路：

1. 输入一个已注册的搜索/研究节点版本和 benchmark suite；
2. 将每个 benchmark task 作为 Workflow 子任务执行；
3. 原始请求、结果、来源/tool trace、grader trace 和 cost 全部存为 Artifact；
4. 保留 `failed_as_zero` 与 `failed_excluded` 两套结果；
5. 先支持答案正确率和 WideSearch 结果 F1；
6. 后续另加平台自有的 Freshness、Source Coverage、Citation Attribution、Retrieval Ranking 四类 grader。

这样可用最少改动获得可复现的 provider 横评能力，同时不把评测 runner 错当成采集平台本身。
