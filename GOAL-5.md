# GOAL-5 — Agent 接入(SKILL.md + RSS + REST)+ 内容分类 taxonomy(仿 AIHOT / Dify)

> `/loop` 自驱。每轮读本文件 → 下个未 [ ] 项 → 端到端做+测绿 → auto-commit → 勾掉。
> 命中真分叉 → 停问,别自己拍板架构。
> 每 PR 绿即 auto-commit(显式 `git add <路径>`,绝不 `add -A`,绝不碰 `backend/api/v1/chat.py`/`GOAL*.md`/`HANDOFF*.md`/`AUDIT*.md`/`GRILL*.md`/`PR-DESCRIPTION.md`);push 仍等用户。

## 背景

对标 https://aihot.virxact.com/agent 的"Agent 接入"模式(Skill/RSS/REST 三轨,匿名免 token,按用户意图分流端点)。opencli-admin 现状(GOAL-5 之前):
- 内容模型 `CollectedRecord`(`backend/models/record.py`)全 JSON blob(raw_data/normalized_data/ai_enrichment),无真实分类/标签字段
- `DataSource.tags`(`backend/models/source.py`)是自由 JSON list,不是本次要做的内容分类
- 整个 `/api/v1/*` 无鉴权(admin 工具 style),无 public/private 区分
- RSS 只有摄入(`rss_channel.py`),没有对外发布
- 无 SKILL.md 生成能力(fork 上游有个同名"skill"概念但语义不同——浏览器录制→蒸馏的数据源渠道,和这次"agent 可装的 SKILL.md 包"是两回事,注意别混)

## 坐标
- repo `D:\projects\opencli-admin`,新分支 `feat/agent-access-taxonomy`(从当前 `main` 切出)
- 测试闸:`uv run pytest tests/unit tests/integration tests/skills --no-cov -q`(PowerShell,`cd D:\projects\opencli-admin`;Bash 工具在此环境被 RTK hook 改写会炸)
- 部署目标未定 —— 本 goal 只出设计落地的代码,不碰部署/域名

## 已锁定的架构决策(别重新问,直接照做)

1. **鉴权**:公开接口匿名免 token(仿 AIHOT),限流用 IP-based 轻量中间件(内存 token bucket,不引入 Redis 依赖),不做 API Key 发放机制。
2. **暴露范围**:`DataSource` 加 `public`(bool,默认 `False`)开关,只有显式打开的源的内容才可能进公开接口。
3. **分类机制**:抄 Dify 的 `Tag` + `TagBinding` 模式,去掉 `tenant_id`(opencli-admin 无多租户概念)。`Tag(id, type, name, created_at)`,`type ∈ {"category", "subtag"}`;`TagBinding(id, tag_id, target_id, created_at)`,`target_id` 指向 `collected_records.id`,不建 DB 级 FK(照抄 Dify 做法,完整性靠服务层)。业务不变量:每条 record 最多绑 1 个 `type=category` 的 tag,`type=subtag` 可绑多个。
4. **顶级分类闭集种子值**(占位提议,未被用户改,直接按此写 seed):`模型能力` / `产品动态` / `行业资讯` / `研究论文` / `工程实践` / `其它`。分类名不照抄 AIHOT(那套是仿 Dify 机制,不是仿 AIHOT 命名)。
5. **分类来源**:`DataSource.default_category` 兜底(source 级默认);AI enrichment 阶段跑完后可用 LLM 输出覆盖式细化绑定。LLM 分类调用失败/超时 —— 不阻断 pipeline,直接落回 source 默认值,record 状态复用现有 `status` 枚举(`raw|normalized|ai_processed|notified|error`),不新增状态。
6. **curated 精选**:`CollectedRecord` 加 `curated`(bool,默认 `False`),**v1 只做人工打标**(走现有 admin API 手动 PATCH)。自动/规则化 curate 是二期,本 goal 不做 —— 这是 YAGNI 裁决不是遗漏,别加。
7. **PublicContentService**(`backend/services/public_content_service.py`)是唯一查询入口 —— 给定 `mode`(`selected`|`all`)/`category`/`since`/`q`/`take` 返回过滤后的 record 集合,REST 和 RSS 都调它,不重复写"哪些内容可对外"这条过滤逻辑(`source.public=True` 是硬性前提,`mode=selected` 再加 `curated=True`)。
8. **RSS**:新增对外发布方向(现有 `rss_channel.py` 只是摄入,方向不同,不复用其摄入逻辑,只复用 `PublicContentService` 的查询结果),用 `feedgen` 库序列化成 Atom。
9. **SKILL.md**:不手写。从 `taxonomy.py`(分类闭集)+ 路由定义脚本生成后 commit 进仓库,按静态文件路由 served。CI 加一致性检查:重新生成结果必须等于已提交文件,防止改分类忘同步文案。
10. **Daily digest**:独立定时任务(复用现有 pipeline 调度基建,没有就加最简单 cron 任务),把当日 `public=True AND curated=True` 的 record 快照进新表 `daily_digests`(date, record_ids, 可选 LLM 摘要文案),不是实时计算。同一天重跑必须幂等(upsert,不重复插入)。
11. **响应白名单**:新增 `PublicRecordRead` schema,只含 `id/title/url/summary/source_name/published_at/category/subtags`,显式排除 `raw_data`/`normalized_data`/内部 source 配置 —— 防止 admin 内部字段随手泄露到公开接口。

## 状态机

- [x] **PR-A — 数据模型:Tag/TagBinding + DataSource 扩展字段 + taxonomy 闭集定义**(`0f48495`,398→414 passed,零回归)。
  新增 `backend/models/tag.py`(`Tag`/`TagBinding`,建表 migration,索引 `(type, name)`、`target_id`、`tag_id`)。`DataSource` 加 `public: bool = False`、`default_category: str | None` 两列(migration)。新增 `backend/taxonomy.py` 定义闭集分类常量(见架构决策 #4)+ 校验函数 `is_valid_category(name) -> bool`。
  验收:migration 跑通,新表/新列存在,`taxonomy.py` 单测覆盖合法/非法分类名判断。

- [x] **PR-B — TagService**(`adaf55b`,414→424 passed,零回归)。
  `backend/services/tag_service.py`:`bind_category(record_id, category_name)`(校验闭集、强制"最多 1 个"覆盖式绑定,非法分类名报错)、`add_subtags(record_id, names: list[str])`(去重、允许新建)、`get_tags(record_id)`、`list_by_category(category_name)`。
  验收:单测覆盖"重复绑定 category 是覆盖不是叠加"、"非法 category 名拒绝"、"subtags 去重"、"list_by_category 只返回该分类下的 record_id 集合"。

- [x] **PR-C — Enrichment 阶段接入分类**(`25d48f0`,424→439 passed,零回归)。走全LLM驱动+兜底:现有enrichment(`ai_processor.py`)本来就没有专门分类调用,只是把用户配置prompt的LLM JSON输出存进`ai_enrichment`——没造新LLM调用架构,机会性读该JSON里的`category`/`subtags`键(有校验),没有/非法/enrichment未跑/失败都落回`source.default_category`;`default_category`也空则记警告跳过分类,subtags仍照跑,不阻断pipeline、不新增status。
  扩展现有 AI enrichment 阶段(找到 `backend/pipeline/` 里对应步骤):跑完常规 enrichment 后,调 `TagService.bind_category`(优先 LLM 输出,失败/超时/未跑则用 `source.default_category` 兜底)+ `TagService.add_subtags`(LLM 输出的细粒度标签)。
  验收:LLM 分类成功路径、LLM 失败兜底路径、`source.default_category` 为空时的行为(记录警告,不崩)都有测试;确认 pipeline 整体状态机不受影响(现有 `status` 流转测试不回归)。

- [x] **PR-D — PublicContentService**(`68993be`,439→457 passed,零回归)。补了`CollectedRecord.curated`列(架构决策#6要但之前PR都没加,migration`n4i5j6k7l8m9`)。`since`过滤用`created_at`原生列不是`normalized_data.published_at`(那字段格式不统一,查了会错不只是慢)。`q`用`lower(cast(normalized_data as String)).contains()`(跟`record_service.py`现有写法一致,dialect通用非Postgres专属ILIKE)。`take`默认50上限200。安全测试(`public=False`永不泄露,含"给我全部"式恶意参数组合)已覆盖。
  `backend/services/public_content_service.py`:核心过滤(`source.public=True` 硬前提 + `mode`/`category`/`since`/`q`/`take`)。
  验收(安全关键):`source.public=False` 的 record 无论调用方传什么过滤参数都不能出现在结果里 —— 这条测试必须覆盖"恶意/异常参数"场景,不只是正常路径。

- [x] **PR-E — REST API + 限流**(`b343146`,457→474 passed,零回归)。限流60次/分钟/IP内存token bucket,只挂public router非全局middleware。响应壳复用现有`ApiResponse[T]`(`backend/schemas/common.py`),白名单字段用显式mapper函数(非`model_validate`裸转)。`summary`取`ai_enrichment.summary`优先,没有则退`normalized_data.content`(合理外推非锁定决策原文)。泄露测试断言`raw_data`/`normalized_data`/`source_id`等键不在响应里,非仅信任schema。
  `backend/api/public/`(`router.py`/`items.py`/`schemas.py`/`throttle.py`),挂载 `/api/public/*`(与现有 `/api/v1/*` 并列,`main.py` 加一行 `include_router`)。`GET /api/public/items?mode=&category=&since=&q=&take=`。IP-based 内存限流中间件,只挂在 public router 上。非法 `category` 参数返回 400 + 合法值列表。
  验收:端点集成测试(public/private 混合数据不泄露私有源)、限流触发 429+Retry-After、`PublicRecordRead` 字段白名单测试(响应体绝不含 `raw_data`/`normalized_data`)。

- [x] **PR-F — RSS 发布**(`457499b`,474→479 passed,零回归)。路由`/api/public/rss`,线路格式实为Atom(feedgen序列化),路径名"rss"照AIHOT命名对齐,docstring写清楚。新加`feedgen==1.0.0`依赖。复用PR-D查询+PR-E白名单mapper,不重写过滤逻辑。序列化失败兜底走手搭空Atom壳(不靠feedgen本身,防它自己炸时兜底也炸)。
  `backend/api/public/rss.py`:`GET /api/public/rss` 复用 `PublicContentService` 结果集,`feedgen` 序列化 Atom。序列化异常兜底吐合法空 `<channel>` 壳,不 500。
  验收:产出 XML 用 `feedparser`(现有摄入用的同一库)反解 round-trip 测试通过;异常兜底路径有测试。

- [x] **PR-G — Daily digest**(`ce86256`,479→509 passed,零回归)。调度:本分支实际有`scheduler.py`+celery/beat但`CronSchedule.source_id`非空FK跟digest(不挂单一source)不契合,改动太侵入不值——改走混合:celery beat静态entry(`daily-digest-snapshot`,00:10 UTC,`task_executor=celery`时免费生效)+独立入口`backend/worker/digest_job.py`(`task_executor=local`时给外部OS调度器调),不新造进程内调度器。`PublicContentService`加`until`上界参数(可选,不改现有调用行为)。
  新表 `daily_digests`(migration)+ `backend/services/digest_service.py` + 定时任务(复用现有调度基建;GOAL-4 已接通 redbeat,优先复用而不是新开一套调度)+ 端点 `GET /api/public/daily`、`/api/public/daily/{date}`、`/api/public/dailies?take=N`。
  验收:同一天重跑两次不重复(幂等测试);空数据日的行为(无 curated 内容时不报错,返回空)。

- [x] **PR-H — SKILL.md 生成**(`cde20bf`,509→521 passed,零回归)。生成脚本`backend/scripts/generate_skill_md.py`直接内省PR-E/F/G的真实`APIRouter`(参数/默认值/description),不是手抄文档,配`--check`漂移模式。输出`backend/skills/agent_access/SKILL.md`,额外加`main.py`挂`StaticFiles`到`/skills`,真正served出`GET /skills/agent_access/SKILL.md`(spec原文要求的"静态文件路由 served")。CI真接了一步进`.github/workflows/ci.yml`的`backend-test`job,另加pytest漂移测试当本地权威闸(手动验证过篡改SKILL.md/taxonomy分类名都能触发失败)。**发现但没动的遗留问题**:`backend-test`job的`working-directory: backend`跟`pyproject.toml`/`tests/`实际在仓库根不一致,job本身像是已经跟别处改动脱节坏了,跟本PR无关,没有顺手改,记录在此。

> ✅ **GOAL-5 完成**(2026-07-08):PR-A→PR-H全落,398→**521 passed**(414/424/439/457/474/479/509/521 逐PR过点),零回归。`0f48495..cde20bf`共8个commit,分支`feat/agent-access-taxonomy`。**未push**(push等用户)。遗留:`.github/workflows/ci.yml`的`backend-test`job working-directory疑似已脱节坏了(见PR-H),不在本goal修。
  生成脚本(从 `taxonomy.py` + 路由定义读取)产出 `backend/skills/agent_access/SKILL.md`,静态文件路由 served。CI 步骤:重新跑生成脚本,diff 已提交文件,不一致则失败。
  验收:生成脚本单测 + CI 一致性检查文档化(写清楚怎么跑、什么时候会红)。

## 每 PR 验收(DoD)
1. `tests/unit` + `tests/integration` + `tests/skills` 全绿(不低于 PR-A 前的基线)
2. 老路径行为零回归(尤其 PR-C —— 改的是生产 pipeline 路径)
3. commit 仅码+测路径,`git status --porcelain` 自检无 `chat.py`/`GOAL*.md`/`HANDOFF*.md`/`AUDIT*.md`/`GRILL*.md`/`PR-DESCRIPTION.md`
4. 勾掉本文件对应项 + 一行进度(commit hash + 测试数)

## 停止条件(真分叉才停,别瞎猜)
- 全 PR 完
- pytest 红且 2 轮内修不动
- 顶级分类种子值(架构决策 #4)如果实现中发现现有已采集内容明显套不进这 6 类,要不要现在改分类表 —— 停问,别自己加类目
- 限流阈值具体数值(次数/窗口)没有强共识,给个保守默认(比如 60 req/min/IP)先落地,除非明显不合理不用为这个停
- PR-G 复用哪套调度基建(redbeat vs 本地 scheduler.py)如果 GOAL-4 那两套还在互斥期,按 GOAL-4 已锁定的 `task_executor` gate 走,不重新纠结
- 需要 push(push 永远等用户)

## 后续排队(不在本 goal 内,已定顺序,未来各开一个 GOAL-N)
参照 https://github.com/langgenius/dify 的组件功能(后端+前端都要,不是只抄后端),按依赖链顺序:
1. 模型 Provider 管理(多 LLM provider 抽象)
2. Workflow 编排引擎
3. 插件市场
4. App 发布机制

这四项跟本 goal(Agent 接入 + 分类)相互独立,规模各自都够开一轮完整 brainstorming + spec,本文件不展开。
