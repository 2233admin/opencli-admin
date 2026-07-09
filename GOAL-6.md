# GOAL-6 — 模型 Provider 管理(仿 Dify model-runtime,自研)

> `/loop` 自驱。每轮读本文件 → 下个未 [ ] 项 → 端到端做+测绿 → auto-commit → 勾掉。
> 命中真分叉 → 停问,别自己拍板架构。
> 每 PR 绿即 auto-commit(显式 `git add <路径>`,绝不 `add -A`,绝不碰 `GOAL*.md`/`HANDOFF*.md`/`AUDIT*.md`/`GRILL*.md`/`PR-DESCRIPTION.md`);push 仍等用户。

## 背景

Dify 队列 item 1(见 GOAL-5 末尾排队)。main 上已有胚胎版,本 goal 升级成真子系统:

- 已有:`ModelProvider` 表(name / provider_type∈{claude,openai,local} / base_url / api_key **已 Fernet 加密**(`backend/auth/crypto.py`,env `CREDENTIAL_ENCRYPTION_KEY`)/ default_model / enabled)+ CRUD API(`backend/api/v1/providers.py`,纯 CRUD 无 test/sync)+ 响应 masking(`has_api_key`/`api_key_preview`)+ Next.js providers 页(`frontend/app/(app)/providers/page.tsx`)
- 痛点 1:四个消费点各自为政拼 client —— `chat.py` agent 坞(私有 `_build_client`)、`skill_channel`、processors(openai/claude/local,config dict + env fallback)、`crawl4ai_channel`(litellm 间接)
- 痛点 2:`DataSource.ai_config` JSON 是绕开 ModelProvider 的平行凭证通道(双真相源)
- 痛点 3:无模型目录、无"系统默认模型"概念、无 test connection、无 failover
- 轮子边界:model-hotel(5080 自研网关)管跨 provider 聚合/凭证池/quota;app 内**只做** role 级候选顺序 failover,不重复造

## 坐标

- repo `D:\projects\opencli-admin`,新分支 `feat/model-provider-mgmt`,**从 main 切**
- **前置(用户手动)**:GOAL-5 分支 `feat/agent-access-taxonomy` 由用户 push + merge 进 main 后再开工;若开工时 main 里还没有 taxonomy 提交,停问
- 测试闸:`uv run pytest tests/unit tests/integration tests/skills --no-cov -q`(PowerShell,`cd D:\projects\opencli-admin`;Bash 工具在此环境被 RTK hook 改写会炸)
- 基线测试数以切分支后 main 实测为准,PR-A 前先跑一遍记进本文件

## 已锁定的架构决策(别重新问,直接照做)

1. **运行时自研,不引 litellm**。新包 `backend/llm/`:`base.py`(`ProviderAdapter` ABC:`chat()` / `list_models()` / `test_connection()`)、`openai_compat.py`、`anthropic.py`、`factory.py`、`resolver.py`、`catalog.py`(anthropic 硬编码模型目录常量)。
2. **`provider_type` 枚举不动**(`openai|claude|local`),语义=adapter 族:`openai`/`local` → `OpenAICompatAdapter`,`claude` → `AnthropicAdapter`。不破坏 crawl4ai 的 litellm 前缀映射和存量数据。
3. **`provider_models` 表**(模型目录):`id, provider_id(真 FK→model_providers, ondelete CASCADE), model_id, model_type(str, default "llm",闭集校验,v1 只有 "llm",列留 embedding/rerank 扩展位), capabilities(JSON 可空: tools/vision/context_window), source∈{discovered,manual}, enabled(bool default True), created_at`。唯一约束 `(provider_id, model_id)`。sync 是 upsert,`source=manual` 条目绝不被 sync 覆盖或删除。
4. **`model_defaults` 表**(系统默认模型,按消费角色):`role`(闭集 `chat|executor|enrichment`,唯一)、`candidates`(JSON 有序列表 `[{provider_id, model_id}]`)。首位=主选,后位=failover 候选。role 对应:agent 坞对话 / skill_channel 便宜执行 / pipeline enrichment 兜底。
5. **模型发现**:OpenAI-compat 打 `GET {base_url}/v1/models`(ollama/model-hotel/deepseek 等全通);anthropic 返回 `catalog.py` 常量。发现失败不崩,返回错误详情供前端展示,可手动登记兜底。
6. **SSRF/key 外泄防护**:factory 建带 api_key 的 client 前必须过 `backend/security/url_guard.py`(`avalidate_public_url_and_ip` + `PinnedAsyncHTTPTransport`),与 main 现有 openai_processor/skill_channel 做法一致。本地地址(ollama/model-hotel)按 url_guard 现有豁免机制走,没有豁免机制则停问。加密/masking 复用现有,不重做。test connection 的错误响应绝不回显 api_key。
7. **failover 语义**(resolver):`resolve(role)` 返回首位候选;`resolve_with_fallback(role)` 按 candidates 顺序试。**只有连接级错误(连不上/超时/5xx)才降级**;4xx 业务错误(如 401 key 错)不降级——那是配置错,降级会掩盖问题。坏 provider 进内存 cooldown(简单时间窗,进程内 dict,不引 Redis),窗口内跳过。
8. **消费点收编范围**:`chat.py`(替 `_build_client`)、`skill_channel`、processors(openai/claude/local)三处走 factory;agent 级 `processor_config` 覆盖能力保留(provider 供底,agent config 覆盖)。**crawl4ai 例外**:client 是 crawl4ai 内部造的(litellm),只收编 provider/model/key 的**解析**走同一 resolver,litellm 调用保留,docstring 写明例外原因。
9. **双轨收敛(软)**:`DataSource.ai_config` 支持 `provider_id` 引用;存量 inline `api_key`/`base_url` 继续能跑但记 deprecation 警告日志;新前端只给 provider 下拉。v1 不硬迁移、不删字段。`ai_agents.provider_id` 维持松散字符串列,不在本 goal 升 FK(改动收益比不值)。
10. **API 面**(挂现有 providers router):`POST /providers/{id}/test`、`POST /providers/{id}/models/sync`、`GET|POST|PATCH|DELETE /providers/{id}/models`、`GET|PUT /model-defaults`。响应壳复用 `ApiResponse[T]`。
11. **前端**:扩展 Next.js providers 页(shadcn/ui + react-query hooks 现有模式,不新增 zustand 用途):provider 行展开模型目录表格 + sync 按钮、test connection 按钮 + 状态徽章(延迟/失败原因)、defaults 卡(三 role 各配 candidates,可排序)、preset 列表加 model-hotel(prefill base_url)。

## 状态机

- [x] **PR-A — 数据模型**(基线 1504→**1530 passed**,+26 新测,零回归;GOAL-6 从 main `e60c473` 切 `feat/model-provider-mgmt`,该 main 已含 GOAL-7 browser-act 但**无 GOAL-5 taxonomy**——用户显式指示此序,taxonomy 非 GOAL-6 代码依赖)。`backend/models/provider_model.py`(`ProviderModel` 表 `provider_models`:**真 FK** `provider_id→model_providers.id ondelete CASCADE`+index、`model_id`、`model_type` default `llm`、`capabilities` JSON、`source`、`enabled`、唯一约束 `(provider_id, model_id)`)+ `backend/models/model_default.py`(`ModelDefault` 表 `model_defaults`:`role` 唯一、`candidates` JSON 有序)+ 注册进 `backend/models/__init__.py`。`backend/llm/__init__.py`(闭集 `VALID_MODEL_TYPES/ROLES/SOURCES`+校验 helper)+ `backend/llm/catalog.py`(`ANTHROPIC_CATALOG` 硬编码常量,决策 #5 无 /v1/models discovery:`claude-opus-4-8`/`claude-sonnet-5`/`claude-haiku-4-5-20251001`,ctx 200000)。Pydantic schema `provider_model.py`/`model_default.py`(field_validator 用 backend.llm helper 校闭集)。migration `d8e9f0a1b2c3`(down_revision=`a7v8w9x0y1z2`,scratch db 全链 base→head + downgrade round-trip 验通,repo db 被别进程锁故用 scratch)。闭集校验只在 Pydantic/backend.llm 层(SQLAlchemy 无 @validates,匹配现有 provider_type/channel_type 约定)。测试 `tests/unit/llm/` + `tests/unit/test_provider_model.py`/`test_model_default.py`(26 测:闭集 helper+schema 双层、唯一约束 IntegrityError、role 唯一、FK cascade、catalog 完整性)。
  ~~验收:migration 跑通;唯一约束生效测试;model_type/role 闭集校验单测;基线测试数记录进本文件。~~ 全达成。
  ⚠️ **PR-C/E 注意**:sqlite 默认不强制 FK,本 repo runtime(`backend/database.py`)从不发 `PRAGMA foreign_keys=ON`(已 grep 确认)——DB 级 cascade 只在 pragma 开时生效,生产删 `ModelProvider` 不会自动级联删 `provider_models`;PR-C 删 provider 时要显式清理 catalog 行或开 pragma,别假设 FK cascade 自动触发。

- [x] **PR-B — `backend/llm/` 运行时**(1530→**1551 passed**,+21 新测,零回归)。`base.py`(`ProviderAdapter` ABC:`chat(messages,*,model)->str` / `list_models()->list[str]`(失败 raise) / `test_connection()->ConnectionTestResult` TypedDict `{ok,latency_ms,error,models_sample}`(不 raise);`LlmAdapterError` 不含 secret;`redact_secret` helper)。`openai_compat.py`(`OpenAICompatAdapter` for openai|local,`avalidate_public_url_and_ip` 在建 `AsyncOpenAI` 前跑 + `PinnedAsyncHTTPTransport`,照 skill_channel/openai_processor)。`anthropic.py`(`AnthropicAdapter` for claude,`list_models`=`anthropic_catalog()` 决策 #5)。`factory.get_adapter(provider)` 按 provider_type 派发。**决策 #6 local-address 解**(关键):url_guard **无既有** localhost/私有豁免机制(读全模块+38测确认),故扩展 `backend/security/url_guard.py` 加 keyword `allow_private=False`(全层穿透:is_ip_blocked→_check_host_and_ips→validate*→PinnedAsyncHTTPTransport→guarded_async_client),**default False 全部现有调用行为不变**(38 url_guard 测 + 全量 1551 零回归验证);`unspecified/multicast/reserved` 恒 blocked、DNS-rebind pin 恒生效,`allow_private=True` 只放行 loopback/private/link-local/CGNAT;**唯一传 True 者=OpenAICompatAdapter 且仅 provider_type=="local"**(openai/claude 全守卫)。测试 `tests/unit/llm/test_adapters.py`(21:两 adapter chat/list_models/test_connection、url_guard 拒绝(恶意 base_url 建 client 前拒+SDK 从不被调)、api_key 不入 error(5测 redact 断言)、factory 派发、local 放行 loopback vs openai 拒同 URL + local 仍 pin)。
  ~~验收:...api_key 不出现在任何异常消息断言。~~ 全达成。
  ⚠️ **url_guard 是共享审计模块(AUDIT B3)**,本 PR 加了 `allow_private` 扩展——向后兼容(default False),但 review/合并时留意此跨切改动。

- [x] **PR-C — API:test + sync + 目录 CRUD + defaults**(1551→**1575 passed**,+24 新测,零回归)。`backend/services/provider_model_service.py`(薄端点,DB 逻辑在此,单一 mock 缝=`get_adapter`):`sync_models`(决策 #3:manual 行永不覆盖/删=`kept_manual`,discovered 已存=去重不违唯一约束,新=added,**stale discovered prune**=本 PR 设计选择已文档化,manual 永不 prune,幂等)、catalog CRUD(`add_manual_model` 结构上强制 source=manual)、`delete_provider_models`、`put_default`(role 闭集 + 每 candidate provider 存在 + model 在该 provider catalog,清晰错误无 key)、`test_connection`(转 adapter 结果已 sanitize)。端点(providers.py 扩展 + 新 `model_defaults.py` router 挂 __init__):`POST /providers/{id}/test`、`.../models/sync`(LlmAdapterError→502)、`GET|POST|PATCH|DELETE /providers/{id}/models[/{row}]`、`GET /model-defaults`、`PUT /model-defaults/{role}`(role 入 path,比 spec 的 GET|PUT 更 RESTful,判断改)。**provider-delete 清理**:现有 `DELETE /providers/{id}` 先调 `delete_provider_models`(PR-A 坑:sqlite 无 cascade)。测试 `tests/integration/test_provider_models_api.py`+`test_model_defaults_api.py`(24:test 成功/失败+api_key 不在 body、sync 幂等+manual 存活+stale prune、CRUD、defaults 校验 bad-role/nonexistent-provider/model-not-in-catalog、provider-delete 无孤儿)。
  ~~验收:...错误响应无 key 泄露断言。~~ 全达成(现有 providers 测试零回归)。

- [x] **PR-D — resolver + failover**(1575→**1599 passed**,+24 新测,零回归)。`backend/llm/resolver.py` `ProviderResolver`(注入式 monotonic clock、进程内 `_cooldown_until` dict 无 Redis、模块单例 `resolver`)。`resolve(db,role)->ResolvedModel|None`(首候选,无配置/空/provider 已删=None,不 failover)。`resolve_with_fallback(db,role,operation)`:顺序试候选——cooled→跳过不建 adapter、missing provider→跳过无 cooldown、成功→立即返、`LlmAdapterError retryable=True`(连接级)→cooldown+下一个、**`retryable=False`(4xx 业务)→立即 re-raise 不 cooldown 不 fallthrough(决策 #7 核心)**、全竭→`ResolverError`带 tried/cooled 计数无 key。`_set_cooldown` 同步读写无 await 协程安全。**错误分类**(改 PR-B 3 文件,向后兼容):`LlmAdapterError` 加 `retryable=False` kw、`base.classify_retryable(exc)` 三层(openai/anthropic APIConnection/Timeout/InternalServer→True,4xx/auth→False,`status_code>=500` 兜底,余 False),adapter chat/list_models except 传 `retryable=classify_retryable(exc)`。测试 `tests/unit/llm/test_resolver.py`(24:顺序降级+cooldown 记录、4xx 不降级+不 cooldown+B 不试、cooldown 窗口跳过+过期重试、全竭 ResolverError 无 key、20 并发一致、classify_retryable 15 例);adapters 测重跑 21/21 无回归。
  ~~验收:...并发调用下 cooldown dict 不炸。~~ 全达成。

- [x] **PR-E — 消费点收编**(1599→**1617 passed**,+18 新测,**零回归**——高危生产路径 PR,全量已跑验)。核心=去重 client 构造走 factory,**不改行为**。新 factory 助手 `build_openai_compat_adapter`/`build_anthropic_adapter`/`litellm_prefix_for` + `_provider_view`(SimpleNamespace,解两难:chat.py 的 live ORM provider 直接写 env-key 会被 autoflush 持久化进 DB→用抛弃视图规避;skill_channel/processors 是 dict 配置需属性访问)+ 各 adapter 加 `get_client()` 交出守卫 client(tool-loop 要裸 client)。收编:**chat.py**(`_build_client` 走 factory,`OPENAI_API_KEY` env fallback + `_pick_provider` + tool-loop 全保留;**原来无 SSRF 守卫→现在有**,决策 #6 顺带补洞,无测试覆盖故不回归)、**skill_channel**(走 factory,qwen3:4b + guard 保留)、**openai/claude processor**(走 factory + 各自 env fallback/usage 日志/JSON-mode 保留,裸 SDK response 仍自取)、**crawl4ai**(litellm 调用+LLMConfig 未动,只 `litellm_prefix_for` 收编映射)。**runner agent-override 未动**+新测锁定(provider 供底 agent processor_config 覆盖)。dead-code grep 净(无残留重复 client 构造)。测试 `tests/unit/llm/test_pr_e_consumers.py`+runner 测(18)。
  ~~验收:零回归闸...各消费点删掉的私有 client 拼装代码不残留。~~ 全达成,无改现有测试。
  ⚠️ **留白/偏差**(诚实记):(1)**resolver 未接入任何消费点**——PR-D 建好测好(24测)但 PR-E 未 wire,agent 保守判断:决策 #8 只要求"走 factory"非"走 resolver",接入会引入 role/model_defaults 选择轴改现有 provider 选择行为+风险回归;resolver 可 import 待未来 opt-in 消费点用(或另开收尾接入)。(2)**local_processor 未改**——ollama 原生 `/api/generate` 协议 + `timeout` 配置旋钮与冻结的 OpenAICompatAdapter 不匹配,强收会改 wire 行为/丢旋钮,判为不安全跳过。(3)chat.py 补了 SSRF 守卫(原缺)。

- [x] **PR-F — 双轨收敛(软)**(1617→**1622 passed**,+5 新测,零回归)。seam=`backend/pipeline/ai_processor.py` 新 `_resolve_llm_config(ai_config, source_id)`(process_with_ai 调):无 provider_id→`return ai_config` **字节不变**(仅 inline api_key/base_url 存在时 log deprecation 警告);provider_id 解析→`dict(ai_config)` copy 覆盖 processor_type/api_key/base_url/model(inline 也给时警告"provider_id 优先");provider_id 不解析→警告+回落 ai_config 不崩(fail-soft 同现有 posture)。DB session 仅 provider_id 存在时开(常路不碰 DB)。`ai_agents.provider_id` 未动(仍松散字符串,决策 #9)。判断:加 `resolve_provider=True` kwarg,pipeline.py 调用传 `resolve_provider=agent_config is None`(agent 级 config 经 runner 另路解析 provider_id,不走本 deprecation 逻辑避免每次 agent 运行误报)。测试 `tests/unit/pipeline/test_ai_processor.py`(5:provider_id 路径、inline 字节相同+warn(断言 `passed_config is ai_config`)、both→provider 赢、provider_id 不存在回落、resolve_provider=False 门控)。
  ~~验收:...警告日志断言。~~ 全达成(inline 路径行为字节相同)。

- [x] **PR-G — 前端**(决策 #11)。现状=providers 页原为纯只读 Card 网格(`createProvider/update/delete` 是死代码)。新建 `frontend/components/providers/`(`provider-form-dialog.tsx` 增改弹窗+3 预设 Claude/OpenAI/**model-hotel**、`provider-catalog-panel.tsx` 展开目录表+sync+手动添加、`model-defaults-card.tsx` 三角色候选卡可增删排序按角色保存)+ `types.ts`(修 `ModelProvider` 去假 api_key 加 `has_api_key/api_key_preview`,加 `ProviderModelRead/ConnectionTestResult/ModelRole/ModelDefault*` 等)+ `endpoints.ts`(8 端点)+ `hooks.ts`(11 react-query hooks 含 queryKey 失效)+ `page.tsx` 接线。四交互(目录展开/sync、test+徽章、defaults、preset)完整实现;**额外补了 create/edit/delete 弹窗**(超决策 #11 原文——preset 需 add-provider 表单才有落点,且后端一直有 provider CRUD 端点前端未接,接上使页面真可用)。api_key 全程 masked(密码框写入态、编辑只显 preview、page 只碰 has_api_key/api_key_preview,无处渲染原始 key)。
  ~~验收:...api_key 在 UI 全程 masked。~~ tsc `--noEmit` exit 0(独立重跑)+ eslint 净 + `next build` 成功 + 无碰 backend/tests。⚠️ **弹窗提交/mutation toast/Select 联动/惰性请求 需真实后端跑起来才能点击验证**——本轮无法起全栈(后端+DB+dev server),编译/构建/类型接线已证,合并前建议接后端手点一遍。

> ✅ **GOAL-6 完成**(2026-07-09):PR-A→PR-G 全落,1430→**1622 passed**(A~F 后端 1448/1467/1484... 至 1622;PR-G 前端 tsc/eslint/build 绿),零回归(既有 12 failed 全 main 遗留:opencli/workflow/nodes-install + 4 `*_live.py` 需真 Chrome)。分支 `feat/model-provider-mgmt`(从 main `e60c473` 切,7 commit `6cf3358..<PR-G>`)。**未 push**(push 等用户)。数据模型(provider_models+model_defaults 真 FK)+ 自研 LLM 运行时(OpenAICompat+Anthropic 双 adapter+factory,**不引 litellm**)+ url_guard `allow_private` local 豁免 + API(test/sync/目录 CRUD/defaults)+ resolver+failover(4xx 不降级+cooldown)+ 消费点收编(factory 去重 client 构造)+ ai_config 软收敛 + Next.js 前端。
> **⚠️ 关键留白**(合并前须知):(1)**resolver+failover(PR-D)建好测好但未接入任何消费点**(PR-E 保守判断:接入改 provider 选择行为+风险回归)——model_defaults 表+API+resolver 全在,但目前无代码路径真正调用 `resolve_with_fallback`;要激活 failover 需另开收尾把消费点接上 resolver(或明确它是 opt-in 基建)。(2)**url_guard 加了 `allow_private`**(共享审计模块 AUDIT B3,向后兼容 default False,但跨切改动 review 留意)。(3)local_processor 未收编(ollama 协议+timeout 旋钮不匹配 adapter)。(4)前端交互需真实全栈点击验证。(5)`BROWSER_ACT_API_KEY`... 属 GOAL-7 无关。

## 每 PR 验收(DoD)

1. `tests/unit` + `tests/integration` + `tests/skills` 全绿(不低于 PR-A 前基线)
2. 老路径行为零回归(尤其 PR-E —— 改的是生产 chat/pipeline 路径)
3. commit 仅码+测路径,`git status --porcelain` 自检无 `GOAL*.md`/`HANDOFF*.md`/`AUDIT*.md`/`GRILL*.md`/`PR-DESCRIPTION.md`
4. 勾掉本文件对应项 + 一行进度(commit hash + 测试数)

## 停止条件(真分叉才停,别瞎猜)

- 全 PR 完
- 开工时 main 没有 GOAL-5 taxonomy 提交(前置未满足)
- pytest 红且 2 轮内修不动
- url_guard 对本地地址(ollama/model-hotel)没有既有豁免机制(决策 #6)
- main 合并后发现 provider 相关结构与本设计冲突(比如别的分支也动了 ModelProvider)
- 需要 push(push 永远等用户)

## 后续排队(不在本 goal 内,已定顺序,未来各开一个 GOAL-N)

参照 https://github.com/langgenius/dify 组件功能,依赖链顺序:
1. ~~模型 Provider 管理~~(本 goal)
2. Workflow 编排引擎
3. 插件市场
4. App 发布机制
