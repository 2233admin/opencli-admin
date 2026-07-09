# 系统工程审核 + 控制论修复方案

> 产出方式:5 路并行 Sonnet 子 agent 审计(架构/数据链路/安全/前端契约/测试运维),
> P0 级 + 锚定发现由主模型逐条读码复核。日期 2026-07-02。
> 分支 `refactor/thin-channel-thick-runner`。
>
> 标注:✅ = 已读码亲验 / ▫ = agent 报告,未独立复核。

## 部署信任模型(已定 2026-07-02)

**局域网通信走 NetBird / WireGuard mesh,不做直接公网端口映射。**

- **入站边界 = WG 层**:只有 fleet overlay 上已认证的 peer 能触达 API/MCP/odp-ingest。
  应用层"无鉴权"由此获得真实网络边界兜底 → 相关发现(轮子 7)从 P1 降为 **P2 纵深防御备案**。
- **出站威胁不受 WG 保护**:SSRF 类威胁是"服务器被恶意内容(爬到的网页/RSS/被改的 provider
  `base_url`)骗着主动发出请求"。WG 挡入站不挡出站——出站可打 fleet overlay(100.80.x.x)、
  本机 localhost 服务(redis 6379 等),或把真实 LLM key 外泄到公网。**轮子 4 仍必修(P1)。**
- **LLM agent 是可信 mesh 内的不可信因子**:MCP 把 `create_source`+`trigger_task` 暴露给 agent,
  而 agent 处理不可信内容(爬网页/RSS),prompt injection 可触发 cli 渠道任意二进制 →
  **轮子 4 的 binary 白名单仍值做(P1 硬化),不因可信 mesh 而免**。

---

## 一、控制论诊断:这不是一堆孤立 bug,是四类回路病

维纳四原则拿来当透镜,本次绝大多数发现归到前两类——**反馈回路断裂**和**信息丢失**。
这解释了为什么它们分散在 Python/Rust/React 三层却"长得一样"(同构性),也决定了修法:
不是逐点打补丁,是**装轮子**——一处机制,全层复用,让系统自己纠错(自组织)。

| 控制论原则 | 系统里对应的东西 | 违反它的发现 |
|---|---|---|
| **① 反馈是生命线**(感知差异→调整→再执行) | 重试分类、DLQ、错误上浮、CI 门禁 | #1 重试不触发、#3 DLQ 吞消息、#8 主循环 panic、shadow 错误没人读、前端缺 onError、CI 不测关键路径 |
| **② 信息即控制力**(信息丢=控制力衰减) | accepted 计数真实性、可观测性、凭证保密 | #2 摄入黑洞(假 accepted)、#4 毒消息与 trim 混同、明文 key 外泄、无 healthcheck、shadow 计数只进日志 |
| **③ 同构性**(同一模型跨领域复用) | 错误处理模式在三层重复出现 | 缺 onError(React)≡ 重试漏分类(Celery)≡ DLQ 丢信号(Rust)——**同一个病,该用同一个轮子治** |
| **④ 目的性/自组织**(局部规则+全局反馈→有序) | 校验器、契约、不变量在调用点就地强制 | SSRF 无统一校验器、env 开关散落、鉴权靠"部署层但愿"、游标非原子推进 |

---

## 二、发现台账(记录)

### P0 — 会真丢数/坏/被攻破

| # | 位置 | 问题 | 原则 | 验 |
|---|---|---|---|---|
| P0-1 | `backend/pipeline/error_taxonomy.py` + ODP sink 路径 | `httpx.HTTPStatusError` 不在 `_RETRYABLE`,ODP 回 5xx→判永久→`pipeline.py` 吞成失败结果正常返回→Celery `autoretry_for` 不触发。配 `odp_only` 策略=无处落、无自动重试。**机制现成**:有 `is_retryable_http_status()`+`RetryableHTTPStatus` sentinel,只是 ODP 路径没用 | ① | ✅ |
| P0-2 | `odp-rs/.../odp-ingest/src/state.rs:24` + `handlers.rs:99-101` | 漏配 Redis→`bus=None`→`else { accepted += 1 }`,返回 202 但没入流。纯黑洞,运行期零信号。(注:NDJSON 入口对解析失败是 400,黑洞只在 batch+无 bus) | ② | ✅ |
| P0-3 | `odp-rs/.../odp-store/src/reap.rs:56-62`(**本仓 `ef4828d` 引入**) | 毒消息(JSON 反序列化失败)走 DLQ 路径时 `read_entries_by_id` 静默丢弃→不进 `found_ids`→被误判"已 trim"直接 XACK,不写 DLQ 行=静默永久丢,且与"真被 trim"安全分支无法区分 | ①② | ✅ |
| P0-4 | `backend/channels/cli_channel.py:40,46` | `binary`+`command` 全来自 channel_config,`create_subprocess_exec(*full_cmd)`=任意二进制执行。配无鉴权 API/MCP=RCE。exec-form 无 shell 注入 | ④ | ✅ |

### P1 — 严重债/潜伏 bug

| # | 位置 | 问题 | 原则 | 验 |
|---|---|---|---|---|
| P1-1 | `backend/pipeline/storer.py:23,38` | 默认 `forward_to_odp=True`,裸 `ODP_INGEST_URL` 触发,绕开 `write_strategy` 状态机→legacy 源意外泄漏进 ODP + 双入口迷惑。(idempotency_key 去重挡掉字面重复,故非重复灌数)。`HANDOFF-strangler-fig.md` 标了"PR3 必收口" | ④ | ✅ |
| P1-2 | `backend/schemas/provider.py:34` + `api/v1/providers.py:15` | `GET /providers` 明文返回所有 LLM api_key;`ModelProvider.api_key` 明文存库,没走 `SourceCredential` 的 Fernet | ② | ✅ |
| P1-3 | `backend/main.py`(全局) | 全 API 无 AuthN/AuthZ(`api_key_enabled` 定义了没 `Depends` 校验);odp-ingest 无 auth 且默认 bind `0.0.0.0`;CORS debug 下 `["*"]`+`allow_credentials=True` | ④ | ✅ |
| P1-4 | 见下方 SSRF 枚举 | 响应回显型 SSRF(rss/web_scraper/api/crawl4ai 抓用户 URL→`GET /records` 读回=内网读原语);无 scheme 白名单/私网 IP 拦截/元数据防护;多处 `follow_redirects=True`;provider `base_url` 可改指外部主机→连真实 Bearer key 一起外泄 | ②④ | ▫ |
| P1-5 | `odp-rs/.../odp-store/src/main.rs:54,59,60` | 主循环裸 `?`,Redis/PG 瞬断→整进程 panic 退出(reap 有 log-continue,主循环没有) | ① | ✅ |
| P1-6 | `backend/pipeline/cursor_store.py` + `runner.py` | SELECT-then-write 无原子 UPSERT/行锁;只有按域名进程内信号量,非 per-source→并发触发同源丢更新(漏抓中间段) | ①④ | ▫ |
| P1-7 | `backend/pipeline/sinks/dual_sink.py:57` + `pipeline.py` | shadow 写失败塞进 `SinkResult.errors` 但 `pipeline.py` 从不读→影子模式 ODP 长期挂,任务仍显 completed,唯一线索是 worker 日志一行 warning | ② | ▫ |
| P1-8 | `.github/workflows/ci.yml` | 只 `pytest -m "not live" --no-cov`——无 `alembic upgrade head` 冒烟、无 `cargo test`(odp-rs 连已有单测都不跑)、coverage gate 关掉。迁移链坏能一路绿灯合并 | ① | ▫ |
| P1-9 | `tests/unit/pipeline/test_pipeline_errors.py:34,58,153` | 调用签名跟真实 `run_pipeline(task_id, source, parameters=None,...)` 对不上:传 `run_pipeline(db_session, source, task.id)`,`db_session` 当了 task_id(仅进日志 `%s` 侥幸不炸),`task.id` 当了 parameters(UUID 非 dict)。rss 源无 `session_affinity` capability 跳过 `params.get` 分支→侥幸通过=测了假东西 | ① | ✅ |
| P1-10 | `frontend/src/pages/BrowsersPage.tsx:778,528` | 重启 API 按钮 + 实例 agent_url 保存两个 mutation 缺 onError,失败全静默 | ① | ▫ |

### P2 — 硬化项

- ▫ odp-ingest `dedup.rs` 无上限/TTL→投毒(自选幂等键让合法事件被当 duplicate 丢)+ 内存 DoS;`handlers.rs:71` 整批持单写锁
- ▫ `handlers.rs:30` NDJSON 无显式请求体大小上限(仅靠 axum 默认 2MB)
- ▫ `odp-store/main.rs:46` 无优雅关闭(裸 `loop`,无 SIGTERM 处理)→部署强杀撞未 flush 批次
- ▫ `docker-compose.yml` odp-ingest/odp-store 无 healthcheck;下游 `depends_on: service_started` 非 `service_healthy`→起容器时序竞争
- ▫ `.env.example` 与实际 env 读取脱节:`ODP_INGEST_REQUIRED`(fail-open/closed 语义关键开关)、`ODP_INGEST_TIMEOUT`、odp-rs 侧 `ODP_DATABASE_URL/ODP_STORE_BATCH_SIZE/ODP_BUS_*` 全没进主文档
- ▫ `frontend/src/pages/SourcesPage.tsx:301` 6 种完工渠道被硬编码标"(开发中)"=误导文案
- ▫ `frontend/src/pages/SkillsPage.tsx` RecordWizard 修了点取消泄漏,但没堵路由跳转/后退卸载(缺 unmount cleanup)→录制中离开页面照旧泄漏 pool mutex
- ▫ `odp-store/src/reap.rs:38` `p.delivery_count > MAX_DELIVERIES`(=5)实为 6 次才进 DLQ,与注释"5"字面不符(应 `>=`)
- ▫ `external_http_processor.py:78` `os.path.expandvars(auth_header)`→配置者设 `$OPENAI_API_KEY` 可把宿主 env 注入出站 header
- ▫ `config.py:19,91` 弱默认密钥(`change-me-*`);本机 `.env` 已真实覆盖且已 gitignore,无提交泄密
- ▫ `frontend` `connectivity_ok/connectivity_errors` 后端有、前端类型直接丢弃

### SSRF 完整出站枚举(20 点,详见安全 agent 原始报告)

需统一校验器覆盖的用户/DB 供给 URL 出站点:
- 回显型(→records 可读回内网):rss_channel(2)、web_scraper_channel、api_channel、crawl4ai_channel、external_http_processor
- 探测 oracle:source_service `discover-feed`(2)
- 盲打:webhook/feishu/wecom notifier(3)
- **凭证外泄型**(base_url 可改+附真实 key):distill、skill_channel、crawl4ai LLMConfig、openai_processor
- health_check 变体(仅 bool):web_scraper/api/crawl4ai(3)

---

## 三、修复方案 = 8 个"轮子"(可复用机制,非逐点补丁)

排序 = 性价比。每个轮子标:治哪些发现 / 控制论原则 / 大致工作量。

### 轮子 1 — DLQ 毒消息可区分【P0-3】① ② · 小
`reap.rs` 必须把"解析失败"与"真被 trim"分开:`read_entries_by_id` 对解析失败的条目保留原始 bytes 放进 DLQ payload(或单独计数+告警),绝不走"没 entry 就直接 ack"分支。
**这是本仓上轮自己引入的丢数 bug,码在手边,最先修。**

### 轮子 2 — 重试分类闭环【P0-1, P1-5】① · 小
(a) ODP sink/`odp_client` 捕获 `httpx.HTTPStatusError`,对 5xx/429 走已有的 `is_retryable_http_status()`→设 `RetryableHTTPStatus` error_type,让负反馈回路真正闭合。
(b) `odp-store/main.rs` 主循环三个裸 `?` 改 log-and-continue(沿用 reap 的模式),瞬断不再 panic 退出。

### 轮子 3 — 摄入信号真实性【P0-2】② · 小
odp-ingest `bus=None` 时要么 fail-fast 拒绝启动,要么响应显式标 `degraded/no-op` 且**不计入 accepted**。假 accepted = 被污染的信息 = 假的控制力。

### 轮子 4 — 统一 URL 校验器【P0-4 部分, P1-4, 多个 P2】④ · 中
一个 `safe_url(url)` 模块(仅 http/https;解析后拦 RFC1918/loopback/link-local/元数据 169.254;禁跳转到私网;pin 已解析 IP),在全部 20 个出站点就地调用。**同构性**:一处规则全层复用;**自组织**:每个调用点就地强制不变量,不需中央防火墙。cli_channel 额外加 binary 白名单。

### 轮子 5 — 错误上浮契约【P1-7, P1-10, 重试耗尽告警】① ② · 中
定一条契约:任何失败都必须浮到可观测通道。
- Python:`DualSink` shadow 错误接入 `events.emit(level=warning)` 或写回 `TaskRun`;Celery 重试耗尽发 dedicated 信号而非只写 DB 状态字段。
- React:所有 `useMutation` 缺 onError 的补齐 toast(BrowsersPage 两处起)。
**同构性**:三层同一个"别吞错误"模式,一份契约拉齐。

### 轮子 6 — CI 反馈门禁【P1-8, P0-3/P1-5 回归防护】① · 中
这是元反馈回路——**捕捉断裂反馈回路的系统**。加:
- `alembic upgrade head`(fresh db)+ `downgrade -1 && upgrade head` 冒烟 job
- `cargo test --workspace`(odp-rs)job
- odp-store writer/reap 的 testcontainers 集成 job(redis+postgres,先 2-3 个关键用例:dead_letter 失败不 ack、reap 重复 claim 幂等、savepoint 隔离单条坏消息)
- 恢复 coverage gate

### 轮子 7 — 鉴权边界【P1-3 → 降 P2 备案;P1-2 部分保留】④ · 视情
**已定:WG mesh 承担入站边界**,故应用层鉴权降为纵深防御备案(非急):全局 API-key/session
`Depends`、CORS 修正、bind 收到 WG 接口/127.0.0.1(而非 0.0.0.0,防 split-tunnel 误配扩大暴露面)。
**但 P1-2 的 provider key 加密+响应 mask 保留(挪进轮子 4 一起做)**——因为 key 外泄的真实路径
是 SSRF 出站 exfil + 日志 + DB 备份,不是入站,WG 救不了。

### 轮子 8 — 游标原子推进 + strangler 收口【P1-1, P1-6】① ④ · 中
(a) `source_cursors` 用 `INSERT ... ON CONFLICT (source_id) DO UPDATE` 或 `SELECT FOR UPDATE`;游标只在"这批已确认落盘"后推进。
(b) `storer.py` 默认 `forward_to_odp=False`,删掉裸 env var 兜底路径,ODP forward 只由显式 `write_strategy` 触发(收口 HANDOFF 标注的 PR3)。

---

## 四、落地批次

| 批 | 内容 | 理由 |
|---|---|---|
| **B1(先)** | 轮子 1+2+3 | 三个数据链路 P0,全在既有职责内,码已读清,小改+补测,直接堵静默丢数 |
| **B2** | 轮子 6 | 装 CI 门禁,给后续所有改动兜底(含 B1 的回归) |
| **B3** | 轮子 4+5 | SSRF 校验器 + 错误上浮,面大但同构,一次机制多点收 |
| **B4** | 轮子 8 | strangler 收口 + 游标原子性,需设计确认 |
| **B5(降级备案)** | 轮子 7 | 部署面已定 WG mesh → 应用层鉴权降 P2 纵深防御,不进主线 |

> 部署面已定(WG mesh),轮子 7 降级备案。B3 的 SSRF 校验器现含 provider key 加密+mask。
