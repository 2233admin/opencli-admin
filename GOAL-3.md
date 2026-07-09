# GOAL-3 — api_channel 厚契约迁移代码审查修复环

> `/loop` 自驱(接 GOAL-2 `6e08d41` 后,来自这轮 `/code-review xhigh` 的 14 条已验证 finding)。
> 每轮读本文件 → 下个未 [x] 项 → 端到端做+测绿 → 自检 staged → auto-commit → 勾掉。
> 命中真分叉/需重新设计游标语义等敏感决策 → 停问,别自己拍板架构。
> 用户 2026-07-01 授权:每 PR(每条 finding)绿即 **auto-commit**(仅限此 goal,显式 `git add <路径>`,绝不 `add -A`;**push 仍等用户**)。

## 坐标
- repo `D:\projects\opencli-admin` 分支 `refactor/thin-channel-thick-runner`
- 测试闸:`uv run pytest tests/unit tests/integration tests/skills --no-cov -q`(当前基线:unit 412 / integration 77 / skills 97,零失败)
- 跑测试用 PowerShell(`cd D:\projects\opencli-admin; uv run ...`);Bash 被 RTK hook 改写易炸("z: command not found")
- ⚠️ **永不 stage**:`backend/api/v1/chat.py`、`PR-DESCRIPTION.md`、`HANDOFF-strangler-fig.md`、`GOAL.md`、`GOAL-2.md`、`GOAL-3.md`(用户 dock WIP + 控制文件)
- 本 goal 源头改动(api_channel 厚契约 + credential endpoint,尚未 commit)已跑通:后端 tests 全绿 + 真实 uvicorn+encryption key 活验证过 store/list/delete 全链路 + `npx tsc -b` 前端类型检查干净。**这些改动本身先 commit 一刀(PR0),再逐条修 finding。**

## PR0 — commit 本轮 api_channel 厚契约迁移源头改动(先做,别跳过)
把这些已验证但未提交的文件 add 并提交(排除上面永不 stage 清单):
`backend/api/v1/sources.py backend/auth/manager.py backend/channels/api_channel.py backend/channels/base.py backend/pipeline/channel_runner.py backend/pipeline/collector.py backend/schemas/credential.py frontend/src/api/endpoints.ts frontend/src/components/ChannelConfigForm.tsx frontend/src/pages/SourcesPage.tsx tests/integration/test_sources_api.py tests/unit/auth/test_manager.py tests/unit/channels/test_api_channel.py tests/unit/channels/test_rss_fetch.py tests/unit/pipeline/test_channel_runner.py tests/unit/pipeline/test_collector.py tests/unit/pipeline/test_collector_incremental.py`
测试闸跑一遍确认绿,再 commit。commit message 示例:`feat(api-channel): thick-contract fetch() + encrypted credential store endpoints`。

## 状态机(每轮更新)

- [x] **PR0** — 见上,提交源头改动(`d15e4fd`,593 passed 7 skipped)
- [x] **PR1** — `api_channel.py` fetch() 转发 `timeout`(`8d0c6ad`,594 passed):`client.request(...)` 调用加 `timeout=timeout` kwarg(两处:owns_client 分支的 httpx.AsyncClient 已经隐式带了 client 级 timeout,但 `.request()` 显式传更保险且修的是 ctx.http 分支——共享 client 硬编码 30s,必须靠 per-request `timeout=` 覆盖)。加测试:mock ctx.http 记录 kwargs,断言 `timeout=<config值>` 被传入。
- [x] **PR2** — `fetch()` 补 `except Exception` 兜底(`7de0191`,595 passed)(镜像 `collect()` 的 `except Exception as exc: ... "API request failed: {exc}"` 文案),包成 `ChannelFetchError` 抛出(别学 collect() 返回 ChannelResult.fail——fetch() 契约是抛异常)。加测试:mock client.request 抛 `OSError("connection refused")`,断言抛 `ChannelFetchError` 且消息含 "connection refused"。
- [x] **PR3** — basic auth 两处实现合一(`2beefe8`,608 passed):抽一个共享 helper(建议 `backend/auth/header_builder.py` 或就近放 `backend/auth/manager.py` 顶层函数,如 `build_basic_auth_header(username, password) -> dict|None`——两者都空返回 None/不发头,而不是发空 Basic 头),`AuthManager.resolve_context()` 和 `ApiChannel._resolve_auth_headers()` 都改调用它。顺带把 bearer/api_key 的 header 构造也一并抽成共享 helper(消掉三处硬编码 key 名的问题:token/key/username+password 约定收敛到一处)。加测试覆盖"两条路径行为一致"的场景(空 creds → 都不发 Basic 头)。
- [x] **PR4** — `AuthManager.store()` 防并发撞唯一约束(`79fc2e4`,609 passed):`session.commit()` 外包 `try/except IntegrityError`,冲突时 rollback + 重新 select + UPDATE(不是插第二行)。加测试:模拟并发双写同 `(source_id, key_name)`,断言最终只有一行、值是后写的。
- [x] **PR5** — `CredentialCreate.key_name` 的 `max_length`(`91edcc0`,610 passed;有一次全量跑偶发单测flaky重跑绿,非本改动引入) 从 100 改成 64,和 `SourceCredential.key_name` 的 `String(64)` 对齐。加测试:65 字符 key_name 触发 Pydantic 422。
- [x] **PR6** — `source_service.delete_source()`(`96511d9`,611 passed) 同一 session 里级联删对应 `source_credentials` 行(delete 前先 `DELETE FROM source_credentials WHERE source_id = ...` 或用 SQLAlchemy `delete(SourceCredential).where(...)`,和删 source 同一事务提交)。加测试:存凭据→删源→断言 `AuthManager().resolve(source_id)` 返回空字典(不再是孤儿)。
- [x] **PR7** — 收窄 `run_channel()`/`collector.py` 在非增量渠道上的多余开销(`93c67db`,614 passed;RSS增量/限速路径零回归;isinstance检查换成`owns_client`布尔位,顺带更好mock):①`collector.py` 的 `_collect_via_runner` 在调用 `DBCursorStore().load()` 前先判 `channel.capabilities.incremental`,非增量渠道整段 db_cursor/staging 逻辑跳过(等价于 PR5b 之前的行为,只是路由仍统一走 `run_channel`);②`channel_runner.py` 的 `run_channel()` 只在 `chan.fetch is not AbstractChannel.fetch`(即渠道真正覆写了 fetch())时才构建 `RateLimitedClient`,否则 `client=None` 传给默认适配器(反正它不读 `ctx.http`)。**这条要仔细验证不破坏 PR5a/PR5b 的增量渠道行为**——RSS 仍要正常走 cursor+rate-limit。全量跑 tests/unit + tests/skills + tests/integration 确认零回归。
- [x] **PR8** — `ApiChannel.collect()` 改成薄包装(`eafef17`,614 passed;老13个collect()测试原样过,顺带把fetch()的owns_client分支也改回`async with`保mock兼容+抽了个`_send`小helper去重),委托给 `fetch()`(构造一个不带 `http`/`source_id` 的 `FetchContext`,catch `ChannelFetchError` 转回 `ChannelResult.fail(str(exc))`,成功则 `ChannelResult.ok(result.items, **result.metadata)`)。**`tests/unit/channels/test_api_channel.py` 里所有 `test_collect_*` 断言必须原样通过不改**(这是这条 PR 的验收标准——旧接口行为零变,只是实现委托了)。
- [x] **PR9** — `CredentialField` name 属性改派生自 `keyName`(已唯一+ASCII,没另加`fieldId` prop——`keyName`已经满足这个要求,加会是纯重复)(`1ee0cb0`,tsc干净+614 passed;⚠️本仓无React组件测试框架,只能typecheck验证)。
- [x] **PR10** — `CredentialField` 的 `listSourceCredentials` 失败态(`5e0a344`,tsc干净):加 `loadError` state,`.catch()` 里 `setLoadError(true)`,placeholder 逻辑区分"确认未存储" vs "状态获取失败"(后者显示类似"⚠ 无法获取存储状态"而不是伪装成未配置)。
- [x] **PR11** — `collector.py`/`pipeline.py` 的 `cursor_pending`/`cursor_source_id` 键名(`f5c3f76`,615 passed)改成防撞的保留前缀(如 `__cursor_pending__`/`__cursor_source_id__`),两处出现(`collector.py` 写入 + `pipeline.py` 的 `pop`)同步改。
- [x] **PR12** — `channel_runner.py` 分页 metadata 合并策略加注释文档化(`b8b4e57`,615 passed)(明确"后页覆盖前页同名键"是有意行为,不是 bug),不改代码逻辑,只补 docstring/inline comment——因为目前无真实渠道 exercise 这条路径,别在没有真实用例前臆造合并语义。
- [x] **PR13** — `run_channel()` 分页循环(`75db78a`,616 passed)

> ✅ **GOAL-3 完成**(2026-07-01):PR0→PR13 全落,593→**616 passed**,零回归。`d15e4fd..75db78a` 共 14 个 commit,分支 `refactor/thin-channel-thick-runner`。**未 push**(push 等用户)。 `chan.fetch(ctx)` 外包 try/except,失败时 `log.warning(...)` 打出"第 N 页失败,已丢弃 M 条已抓 items,cursor 可能已推进到 X"再重新抛出(**不改变异常传播行为和 cursor 提交时机**——只加可观测性,cursor/一致性语义的真正修复留给以后,那是 GOAL.md 自己都判过的敏感决策点)。

## 每 PR 验收(DoD)
1. 全 `tests/unit` + `tests/integration` + `tests/skills` 绿(≥ 基线,PR0 后基线按新数字算)
2. 旧路径行为零变(尤其 PR7、PR8——这两条改的是既有生产路径,必须零回归)
3. commit(仅码+测路径,自检 staged 集,`git status --porcelain` 核对无 chat.py/GOAL*.md/HANDOFF*.md/PR-DESCRIPTION.md)
4. 更新本文件状态框 + 一行进度

## 停止条件(任一 → 停+报,别瞎猜)
- 全 PR 完
- pytest 红且 2 轮内修不动
- **真分叉**:PR7 发现会破坏 RSS 增量行为、PR13 发现必须动 cursor 提交时机才能修对、或任何一条修法出现多条不等价路径
- 需要 push(push 永远等用户)

## 参考
- 本轮 finding 全文出自 `/code-review xhigh`(10 finder angles + 13 verify + 3 sweep,当前会话 transcript)。P1(PR1-4)/P2(PR5-9,含 PR0)/P3(PR10-13)按严重度排。
- 已知刻意不修的架构级问题(记在这,别在 loop 里自己动):`ApiChannel` 从不声明 `Capabilities.auth_kind`,`ctx.auth` 对它架构性地永远无用——真正修法是把 `Capabilities.auth_kind` 泛化成可按 source 动态解析,这是设计级决策,不进本 goal。
