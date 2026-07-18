# Backend Bug Triage — 2026-07-18

部署验证 + 测试全量跑完后的后端问题账本。环境: main @ 50f48c8, Docker api+agent-1 (源码构建 0.3.6), host uv 环境跑测试。

## P0 — 结构性

### 1. identity 后端未进 main, production 前端登录死路
- 前端 `app/login/page.tsx` 三通道: OIDC (未配置) / bootstrap (`signInWithBootstrap` → `GET /api/v1/auth/me`) / 本地开发模式 (仅 `NODE_ENV !== 'production'`)
- main 后端 `backend/security/` 只有 `fleet_auth.py` + `url_guard.py`; `/auth/me`、`BOOTSTRAP_ADMIN_TOKEN` 的 identity 模块只存在于 `origin/codex/notification-ack`、`origin/codex/workflow-studio-motion-wip`
- 后果: `next build` 产物在 main 上**无法登录任何账号**。当前部署被迫用 `next dev` (工程模式) 绕过
- 修法: 把 codex 分支 identity 模块 (backend/security/identity.py + /auth/me 路由) 合回 main, 或前端登录页在 identity 后端缺席时降级

## P1 — 测试红 (真回归)

### 2. workflow import / demand-draft / turbopush 与 plan-IR 校验器脱节 (integration 9 挂)
- `tests/integration/test_workflow_patch_api.py` ×8 + `test_workflow_turbopush_publish_api.py` ×1
- 复现: `POST /api/v1/workflows/import/external-runtime` (langgraph 图) 返回 `valid: false`
- 根因错误码:
  - `plan_ir_orphan_merge` — importer 把 langgraph `merge` 映射为 `intelligence.flow.merge` (要求 ≥2 入边), 导入图只有 1 入边
  - `plan_ir_port_type_mismatch` — `external.tool.capability` 出口 `type='unknown'` 接不上 merge 入口 `recordCandidate[]`
- plan_ir 校验在 c42ece1 (four-level node hierarchy) 接入 compiler; importer (`backend/workflow/external_importer.py`) 没跟着更新映射
- 修向 (二选一): importer 合成合法图 (merge 补占位入边 / 外部工具出口给宽松类型), 或 plan-IR 对 external.* 目录节点放宽端口类型。牵涉工作流语义, 建议和工作流重构讨论一起定

## P2

### 3. chat confirm `trigger_task` 吞掉派发失败
- `backend/api/v1/chat.py:437`: `result = await get_executor().dispatch_collection(task.id, {})` 结果未检查, 派发炸了 API 仍回 `applied: true`
- 修法: 检查 result / try-except 回 `applied: false` + 原因

## P3

### 4. 单测无 .env 隔离
- 根 `.env` 配了 `API_AUTH_TOKEN` (部署必需) 时, `tests/unit` 挂 19 个 (workers/nodes_install/geo 全是 401 或 token 注入断言)
- pydantic Settings 直读仓库根 `.env`; conftest 未清空鉴权相关 env
- 修法: conftest autouse fixture 强制 `API_AUTH_TOKEN=''`

### 5. 杂项
- B904 raise-without-from 集中在 `backend/api/v1/browsers.py` (~8 处), 异常链丢失
- ruff 1701 条 (E501×679 / W293×388 为主, F841×17, F401×15); B008 是 FastAPI 惯用法, 建议 ruff config 加 per-file-ignores
- pytest-asyncio `event_loop_policy` fixture deprecation 警告 43 条

## 测试基线 (token env 清空后)

| 套件 | 结果 |
|---|---|
| tests/unit + tests/skills | 1355 passed, 5 skipped |
| tests/integration | 374 passed, 9 failed (上述 #2), 5 skipped |

复跑命令 (host):
```powershell
cd D:\projects\opencli-admin
$env:API_AUTH_TOKEN=''; $env:AGENT_API_TOKEN=''; uv run --extra dev pytest tests/unit tests/integration -q --no-cov
```

## P3 补录 (2026-07-18 晚)

### 6. 全套跑测试顺序污染 flake (main 存量)
- `pytest tests/integration tests/unit tests/skills` 全套跑稳定挂 6 个, 单跑全过; clean main 与 feature 分支同样 6 个 → 存量顺序依赖, 非新代码
- 名单: test_workflow_opencli_hda_trace_api (projection/stream ×2), test_workflow_turbopush_publish_api (capabilities ×1), test_nodes_install_script (netbird/ssh ×2), +1
- 疑似共享进程级状态 (capability registry / settings snapshot / os.environ 写入未回滚)
- 修向: 定位先污染后断言的 test 对 (pytest -p no:randomly 二分), 或对相关 fixture 加隔离

---

## 采集链路专项审计 (2026-07-18 双 agent 扫描, Fable 抽查裁决)

两路独立审计 (静默失败猎手 / 正确性+性能), 合并去重。标 ✅ = 主循环人工抽查坐实; 其余 agent 验证过调用链或对照过测试套件。

### P1 — 会产生生产可见症状

| # | 位置 | 问题 | 触发 |
|---|---|---|---|
| C1 ✅ | `pipeline/notifier_dispatch.py:48-81` + `pipeline.py:438` | 通知发送在**持 SQLite 写锁**的 session 里逐条打网络 (flush 后 send, 全发完才 commit), 违反 pipeline.py:124 自己声明的契约 | 一个慢 webhook (默认 15s) × N 条记录 = 写锁挂几分钟, 并发 run 全部 "database is locked" |
| C2 | `scheduler.py:44-45` | cron 表达式非法 → croniter 异常被 `except: return False` 吞掉, **调度永久停摆, 零日志零痕迹** | 管理员 cron 手误一次, 该源从此不采, 无任何诊断线索 |
| C3 | `pipeline/ai_processor.py:118-121` + `pipeline.py:409` | 未知 processor_type 静默 no-op (连 debug 日志都没有); 且 `ai_count = len(new_records)` 无条件赋值 → **每次 run 谎报 "AI 处理完成 N 条"** | provider 配错, 富化永久失效, 面板上却全绿 |

### P2 — 数据正确性 / 稳定性

| # | 位置 | 问题 |
|---|---|---|
| C4 | `scheduler.py:37-52` | 61s due 窗口与实际 tick 节拍解耦 (无 last-fired 标记): 漂移到临界点后同一 fire 连续两 tick 双派发 (重复采集); 循环体 >1s 则漏发 |
| C5 ✅ | `executor/local.py:52-61` | `dispatch_collection`/`dispatch_scheduled_collection` 裸 `create_task` 无强引用 — asyncio 官方文档明示可被 GC 吞任务, run 永久卡 running。同类 `dispatch_acquisition` 就有正确姿势 (task dict) |
| C6 | `executor/local.py` + `scheduler.py:57-64` | 进程内管线**无全局并发上限** (仅 domain_limiter 每域 3): 整点对齐的 N 个调度 = N 个并发 Chrome/opencli 子进程压同一事件循环 |
| C7 | `channels/base.py:149` / `rss_channel.py:171` | `identity()` 稳定去重键**从未被接线** — 去重只靠 content_hash(title\|url\|content), feed 改标题/修错字 = 同一条目重复入库 |
| C8 | `processors/openai_processor.py:68` 等 | 逐条 LLM 调用无显式超时 (SDK 默认 600s×2 重试): 死网关把 50 条批次钉在 ai_processing 几小时 |
| C9 | `executor/celery_exec.py:14-41` | `apply_async` 是同步 broker 往返, 直接在事件循环上跑 — broker 慢/挂 = 整个 API 进程卡秒级/次 |
| C10 | `pipeline/cursor_store.py:127-133` | `SELECT ... FOR UPDATE` 在 SQLite 方言下**被静默忽略** — docstring 声称的丢失更新保护只在 Postgres 存在; 默认部署上并发同源 run 的游标互踩 (重拉或跳数据) |
| C11 | `pipeline/pipeline.py:372` | cursor save 是唯一没有 try/except 的写后步骤: sink 已落库后 save 炸 = run 标**假失败** + Celery 重试重复采同一窗口 |
| C12 | `pipeline/pipeline.py:108,435` | `notifications_sent` 声明即死代码; step5 无条件报 "通知发送完成" — 逐条失败只落 NotificationLog, 从不聚合回 TaskRun, 全败数周面板照样正常 |

### P3

| # | 位置 | 问题 |
|---|---|---|
| C13 | `channels/api_channel.py:156` / `rss_channel.py:154` / `http_client.py:19` | 504/520 被归类永久失败零重试 (web_scraper 同样状态码却正确映射 Retryable); RETRY_STATUS 缺 504 |
| C14 | `worker/tasks.py:107-135` | 重试固定 60s 无 backoff/jitter (同步重试波); `run_scheduled_collection` **完全没有** autoretry, 与 pipeline.py:222 声明的契约矛盾 |
| C15 | `pipeline/storer.py:58-64` | 去重存在性检查每 hash 一个 bind 变量 — 大批次撞 SQLite 变量上限, 采集成功后整批写入炸 |
| C16 | `channels/cli_channel.py:77-85` | 超时只 kill 直接子进程 (opencli 通道有 taskkill /T 先例), shell 包装的孙进程泄漏; kill 后 wait 的异常 bare pass, 僵尸风险 |
| C17 | `pipeline/pipeline.py:180-201` + `opencli_channel.py:27` | 采集前为拼显示串跑 `opencli --help` 子进程 (热路径 1-3s); help/browser 缓存进程生命周期内永不失效, opencli 升级后旧参数误路由 |
| C18 | `pipeline/notifier_dispatch.py:44-46` | 未知 notifier_type 的规则静默 skip (有测试背书=有意, 但零日志) — 配错的规则永久哑死无从发现, 补一行 warning 即可 |
| C19 | `pipeline/runner.py:177-181` | 终态失败只存 str(exc), 丢弃下层已算好的 error_type 分类 — 运维看不到可重试/永久判定 |
| C20 | `channels/opencli_channel.py:419-455` | CDP tab 快照失败吞成空集 → cleanup 把**用户自己开的标签页**当新开全关掉, 且无日志 |

### PERF (采集吞吐)

| # | 位置 | 问题 |
|---|---|---|
| C21 | `pipeline/pipeline.py:404-412` | AI 富化落库逐条 `session.get` — N+1, 应 IN 批查/批更 |
| C22 | `channels/rss_channel.py:78,156` | `feedparser.parse()` 同步跑在事件循环上 (MB 级 feed = 秒级冻结整个 API); BeautifulSoup 同类 — 应 `asyncio.to_thread` |
| C23 | `pipeline/notifier_dispatch.py:48-70` | 逐条 flush + 串行 send + 每次新建 HTTP client (兼 C1 的持锁放大器) |
| C24 | `pipeline/events.py:16-32` | 每个事件独立 session+INSERT+commit(fsync); skill 长循环几十次串行 commit 全在热路径 |
| C25 | `processors/*` | 逐条串行 LLM POST 无 gather/semaphore — 富化墙钟 = 条数 × 单条延迟 |

### 已验证干净 (免重复排查)

子进程统一 `create_subprocess_exec`+`wait_for`+kill; RateLimitedClient 令牌桶+封顶指数退避+jitter+Retry-After; **cursor 在 sink 落库后才推进** (测试背书); storer 批量插入+SAVEPOINT 兜底; browser_pool 租约有 deadline; DualSink shadow-write 错误上浮链路完整。

### 修复分组建议 (回头修, 一组一 PR)

1. **锁与假信号** (C1+C23, C3, C12, C18, C19) — 通知移出写锁 session + 聚合失败计数 + 补日志
2. **调度器** (C2, C4) — cron 解析报错落日志/标记 schedule invalid + last-fired 标记消双发
3. **执行器** (C5, C6, C9) — task 强引用 dict + 全局 semaphore + apply_async 挪 to_thread
4. **游标与重试语义** (C10, C11, C13, C14) — SQLite 路径乐观锁/串行化 + cursor save 包错 + 重试分类修正
5. **吞吐** (C8, C21, C22, C24, C25) — LLM 超时+并发上限, feedparser to_thread, 事件批 commit
6. **杂项** (C7, C15, C16, C17, C20)
