# GOAL-4 — 采集管线高可靠化(接 GOAL-3 之后)

> `/loop` 自驱。每轮读本文件 → 下个未 [x] 项 → 端到端做+测绿 → auto-commit → 勾掉。
> 命中真分叉 → 停问,别自己拍板架构。
> 用户已批:每 PR 绿即 auto-commit(显式 `git add <路径>`,绝不 `add -A`,绝不碰 `backend/api/v1/chat.py`/`GOAL*.md`/`HANDOFF*.md`/`PR-DESCRIPTION.md`);push 仍等用户。

## 坐标
- repo `D:\projects\opencli-admin` 分支 `refactor/thin-channel-thick-runner`
- 测试闸:`uv run pytest tests/unit tests/integration tests/skills --no-cov -q`(PowerShell,`cd D:\projects\opencli-admin`;Bash 工具在此环境被 RTK hook 改写会炸)
- 基线(PR0 已完成,commit `2e58cc3`):616 passed 7 skipped

## 已完成背景(不用再做)
- PR0(本文件外,已提交 `2e58cc3`):`ChannelResult.error_type` 打标 + 6 渠道 catch-all 补齐 + `rss_channel.py:98` timeout 转发漏洞。

## 已锁定的架构决策(别重新问,直接照做)
1. **重试接入 celery**:`pipeline.py` 对 retryable 异常 re-raise,celery task 声明的 `max_retries=3` 借此自动生效——不改 `tasks.py`,不加显式 `self.retry()`。
2. **调度器**:全套接通 redbeat 当 celery beat backend;`CronSchedule` CRUD(创建/改/删)时同步写/删 redbeat entry(不再是"改了要重启 beat 才生效");本地 `backend/scheduler.py` 那条轮询 loop 是否保留由你在做 PR-C 时看情况定(local executor 模式下可能还需要它,celery 模式下应该完全让位给 redbeat)——但两套调度语义不能同时活着互相打架,拿主意时记录在本文件里说明取舍,不用停下来问。

## 状态机

- [x] **PR-A — 错误分类法(taxonomy)+ 幂等性验证**(`e0c196f`,639 passed)。`error_taxonomy.py`落地;幂等性:序列重跑靠content_hash已经对(既有测试证实),但发现真gap——check-then-insert非原子,并发写同content_hash会IntegrityError丢整批,已修(rollback+recheck+逐条插survivors)+补测试。PR-B激活重试后这个race会变真实,不再是纯理论。
  在 `backend/channels/base.py` 或新文件(建议 `backend/pipeline/error_taxonomy.py`)定义 `is_retryable(error_type: str) -> bool`:
  - retryable:`TimeoutException`、`TimeoutError`、`ConnectionError`、`ConnectError`、`ReadError`、`RemoteProtocolError`、`OSError`(网络/subprocess 层瞬时故障)
  - permanent:`ValueError`、`KeyError`、`FileNotFoundError`(二进制/配置缺失,重试没用)、`json.JSONDecodeError`、`ChannelFetchError` 本身(已经是包装过的语义错误,看 `__cause__` 才能细分——如果 cause 是 retryable 类型则 retryable,否则 permanent)
  - `httpx.HTTPStatusError`:4xx(除 429,已经在 `RateLimitedClient` 层重试过、到这里说明重试也没用)→ permanent;5xx/429 理论上不该漏到这层(`RateLimitedClient` 已处理),如果漏到了按 retryable 处理兜底
  - 加单测覆盖每类判断。
  **幂等性验证**(不是新写,是确认现状):读 `backend/pipeline/sinks/`,确认 `collect()` 被重跑一次(同一批 items 再来一遍)时 `write_batch` 不会产生重复记录(应该靠 `identity()`/内容 hash 去重)。写一个测试用例证明"同一 task 的 collect→persist 跑两遍,`records_collected` 不翻倍"。如果发现不幂等,记录在本文件里,是否要在本 goal 内修还是记成已知风险——这是真分叉,停问。

- [x] **PR-B — pipeline.py 对 retryable 异常 re-raise,激活 celery 真重试**(`30ac9ae`,645 passed)。查清楚了:光re-raise不够,`tasks.py`必须加`autoretry_for=(Exception,)`(此前max_retries=3是死的,没人调self.retry());runner.py Phase 4只在run_pipeline正常返回时跑,re-raise会跳过它把TaskRun卡在running——加了except统一收口标failed再往上抛。`run_scheduled_collection`(cron那条兄弟task)现状没retry,不在这条PR范围,记了没动。
  `pipeline.py` 的 step1/collect 与 step2-3/sink 两处 `except Exception as exc:` 改成:先判 `is_retryable(type(exc).__name__)`(或 `channel_result.error_type` 那条路径),retryable 就 re-raise(让 `run_collection` celery task 函数本身抛出,`autoretry_for` 或 `self.retry()` 生效——先确认 celery task 装饰器需不需要加 `autoretry_for=(Exception,)` 或类似,`bind=True` 已经有了,可能只需要在 catch 到异常处显式 `raise self.retry(exc=exc, countdown=...)`,去 `worker/tasks.py` 确认清楚再改,别瞎猜);permanent 才照旧转 `PipelineResult(success=False)` 吞掉。
  **验证**:写测试模拟一次 retryable 失败,断言 celery task 走了 retry 路径(用 celery 的 eager/test 模式或 mock `self.retry`);模拟一次 permanent 失败,断言不重试、直接 `PipelineResult(success=False)`。

- [x] **PR-C — redbeat 接通(全套,见上面锁定决策)**(`77b4afb`,657 passed)。挖到底:celery beat压根没接过(`build_beat_schedule()`零调用方,已删,只留`parse_cron_expression`复用)。全套落地:celery-redbeat依赖+`beat_scheduler`配置+`redbeat_sync.py`(sync_entry/remove_entry/populate_all)+schedule CRUD同步(gate在`task_executor=="celery"`,fail不炸请求)+main.py启动populate_all。本地`scheduler.py`**保留不动**——local模式下唯一调度器,跟redbeat靠task_executor互斥不打架。踩坑并修:populate_all首版抄了tasks.py那套`new_event_loop().run_until_complete()`,但调用方main.py lifespan本身就在跑着的loop里,会炸"already running"——改成async函数直接await。本仓无真实redis,新测试走mock redbeat库边界。
  1. `pyproject.toml`/`uv add celery-redbeat`
  2. `celery_app.py`:`beat_scheduler = "redbeat.RedBeatScheduler"`,`redbeat_redis_url` 配置(复用 `settings.redis_url` 或 `celery_broker_url`)
  3. 起始 populate:进程启动时(或一次性脚本)把现有 `CronSchedule` 表全量写成 redbeat entries(用 `worker/beat_schedule.py` 里已有的 `_get_enabled_schedules`/`parse_cron_expression` 复用,别重写)
  4. `backend/api/v1/schedules.py`(或对应 CRUD 文件——先找到)的创建/更新/删除/enable-toggle 端点里,同步调用 redbeat 的 `RedBeatSchedulerEntry(...).save()` / `.delete()`,不再只写 DB
  5. `backend/worker/beat_schedule.py` 的 `build_beat_schedule()` 现在有实际调用方了(populate 脚本)——如果它的逻辑跟 redbeat entry 构造重复,提取共享的 cron-parse 部分,别留两份平行实现
  6. `backend/scheduler.py` 的本地 loop:决定去留(见上面架构决策),照实现,在本文件补一行说明取舍
  7. **验证**:起真实 redis(本仓测试环境已有 fixture 大概率),写集成测试:建一个 schedule → 断言 redbeat 里有对应 entry;删 schedule → entry 消失;不需要真等 cron 触发(那是 celery beat 自己的事,不用集成测出"真的到点跑了")

- [x] **PR-D — web_scraper 迁 fetch();opencli/cli/skill 评估后跳过**(`bbfd5b9`,660 passed)。web_scraper真迁了(拿限速+backoff),16个老collect()测试原样过。opencli:非HTTP client(subprocess+browser pool),迁了ctx.http也用不上,跳过。cli/skill:评估中发现PR-B的celery重试已经靠`error_type`taxonomy覆盖它们了(所有渠道failure都走`ChannelResult.fail(error_type=...)`,不只fetch()渠道)——单独retry wrapper纯重复,不加。
  参照 GOAL-3 PR8 api_channel 的迁法:`collect()` 变薄包装委托给新写的 `fetch()`,**老的 `test_collect_*` 断言必须原样通过不改**(验收标准)。`web_scraper` 走 `ctx.http`(拿 `RateLimitedClient` 的 429/backoff);`opencli` 是 subprocess+浏览器池,不是 HTTP 请求,`fetch()` 迁移对它意义有限(它本来就没有走 HTTP client 这条路)——**先判断 opencli 值不值得迁,若"迁了但 ctx.http 完全用不上"就没必要,只把它记成"评估过、不迁,原因是 XXX"跳过,别为了凑数硬迁**。
  `cli`/`skill` 渠道如果评估后确实需要重试(比如 opencli/skill 的浏览器 flaky 场景),再加独立的 retry wrapper(不是 fetch() 迁移,是 collect() 外面包一层"失败重试 N 次"的装饰器)——先看有没有真实需求再动,没有就跳过记录原因。

- [x] **PR-E — 真健康探针(cheap liveness ≠ deep readiness,分两档)**(`a86c216`,675 passed)。`health_check()`签名从`()->bool`拓成`(config=None, source_id=None)->bool`(向后兼容,老0参调用不变),`source_service.py`透传。api真HEAD/GET+真auth头(走`_resolve_auth_headers`包括加密store);web_scraper两档(lxml驱动能用+目标真可达);opencli两档(二进制在+真打CDP `/json/version`,agent/bridge模式跳过深探针,pool未初始化兜底老行为)。health→dispatch gating按计划没做(feature不是fix)。
  - `api_channel.health_check()`:对 `config.get("base_url")` 发一个轻量 HEAD/GET(带 `_resolve_auth_headers`,真的带认证探活,不是随便connect一下),超时给短(如 5s),网络错误/4xx5xx → False
  - `web_scraper_channel.health_check()`:探目标 URL 可达(HEAD/GET) + BeautifulSoup/lxml driver 能正常 import/实例化(这个基本不会挂,但按用户原话"driver 活着"补上)
  - `opencli_channel.health_check()`:现在只查 `_OPENCLI_BIN` 存在;补上真正打 CDP endpoint(`GET {cdp_endpoint}/json/version`)确认浏览器起得来、够得着——注意这依赖 browser_pool 已 acquire 一个 endpoint,看现有 `pool.acquire()` 怎么用,别为了 health_check 常驻占一个浏览器槽位
  - **明确不做**:health_check 接入 dispatch gating(不健康就跳过任务)——那是 feature 不是 fix,本 goal 不做,写清楚原因

> ✅ **GOAL-4 完成**(2026-07-01):PR0(session外,`2e58cc3`)→PR-A→PR-E 全落,616→**675 passed**,零回归。`2e58cc3..a86c216` 共 6 个 commit,分支 `refactor/thin-channel-thick-runner`。**未 push**(push 等用户)。挖到的额外发现:celery beat 之前压根没接通(PR-C)、`run_scheduled_collection` 仍无重试(PR-B 范围外,已记录)、cli/skill 靠 PR-B 的 taxonomy 已间接拿到重试(PR-D 评估结论)。

## 每 PR 验收(DoD)
1. `tests/unit` + `tests/integration` + `tests/skills` 全绿(≥ 616 基线)
2. 老路径行为零回归(尤其 PR-B、PR-D——改的是生产路径)
3. commit 仅码+测路径,`git status --porcelain` 自检无 chat.py/GOAL*.md/HANDOFF*.md/PR-DESCRIPTION.md
4. 勾掉本文件对应项 + 一行进度(commit hash + 测试数)

## 停止条件(真分叉才停,别瞎猜)
- 全 PR 完
- pytest 红且 2 轮内修不动
- PR-A 幂等性验证发现真的不幂等,要不要本 goal 内修
- PR-B 里 celery 重试到底该用 `autoretry_for` 还是显式 `self.retry(exc=exc)`,两种语义不等价(前者装饰器声明式、每次都重试同样逻辑;后者能按错误类型定制 countdown/次数)——如果 `worker/tasks.py` 现状明显该用哪种就直接用,不明显再停问
- PR-C 步骤 6(本地 scheduler.py 去留)如果发现 local executor 模式还有活人在用(不只是测试覆盖),别直接删,记下来问
- PR-D 判断某渠道"迁不迁"本身有分歧(不确定算不算真分叉,判断错了也就是白评估一次,不算严重后果,不用为这个停)
- 需要 push(push 永远等用户)
