# 原生智能生命周期验证记录

状态日期：2026-07-23。

## 当前状态

| Gate | 状态 | 证据 |
| --- | --- | --- |
| 离线零凭据完整 lifecycle | 已有确定性自动化证据 | `native-intelligence-offline-v1` 固定夹具；18-action HDA 到 `closed` |
| 29 action 合同/readiness | 已有确定性自动化证据 | action-specific binding、29 个唯一 fixture scenarios、四谓词 fail-closed |
| SQLite 持久化与恢复 | 已有确定性自动化证据 | restart、CAS、idempotency、lease race、checkpoint、outbox、cross-session FK |
| WorkflowRunEvent 脊柱 | SQLite 与 live PostgreSQL 自动化证据；PG CI 强制 gate 已接入 | append-only suffix、共享 sequence allocator、REST replay、expand/audit/contract migration |
| PostgreSQL SQL/DDL | 已有静态与 offline migration 证据 | PostgreSQL dialect compilation 和 Alembic `--sql` |
| Live PostgreSQL conformance | 本地真实 PostgreSQL 18.4 与 CI/release 强制 gate 均有证据 | 隔离 TEMP cluster、`REQUIRE_POSTGRES_CONFORMANCE=1`、CI 同款 5-file selector：37 passed、40 deselected、exit 0；测试后服务停止且目录删除 |
| Browser/Studio targeted lifecycle | 已有真实 Chrome 三场景证据；限定范围内已验证 | 模板 Preview/Run、默认画布 Add Native Intelligence → Run、legacy graph UI load/save/reload 均通过；跨 run 浏览器场景仍待验 |
| 最终全仓 QA | 进行中；标准前端 build 已 fresh 通过，final code review pending | 释放测试负载后运行标准 `npm run build`，25 个页面全部生成；不得据此声明当前 code-review findings 已关闭 |

“已验证”只指仓库自动化覆盖，不把 dialect compilation 等同于 live PostgreSQL，
也不把 API integration 等同于浏览器验收。

2026-07-23 使用真实 Chrome 对 Studio 做了三条定向复验：

- 从“原生智能完整生命周期”模板创建的单节点工作流，Preview 未请求
  `/opencli-hda/trace`，也未创建 run 或 IntelligenceSession；普通 UI Run 以
  `145` 个事件完成并进入 `closed`；
- 新打开的默认非空画布为 3 个节点，通过“添加节点”加入
  `Native Intelligence Lifecycle` 后变为 4 个节点，普通 UI Run 完成且未进入
  blocked 状态；projection 有效，包含 `199` 个事件和 `36` 个
  compiled/runtime nodes；
- 通过 API 预置含顶层和 node-level legacy extensions 的 graph，经 Studio UI
  load、canonical autosave 和完整 browser reload 后，嵌套 `null` 与未知字段均
  保留；最终 revision 为 `3`、canonical node 数为 `2`，已规范化移除的
  `sourceAnchor` 未被重新引入；
- 三条场景的应用操作窗口内均无 application console/page error、HTTP 4xx/5xx、
  loading failure 或外部网络请求。完整 reload 捕获到的唯一异常经 CDP
  execution-context 元数据确认来自已安装 `Moss` Chrome extension 的 isolated
  world，不属于应用 default context。

浏览器命令、ID、telemetry、清理状态和截图见
[Chrome QA 摘要](../../.omx/evidence/final-chrome-qa-20260723-181732/README.md)
与
[结构化验证记录](../../.omx/evidence/final-chrome-qa-20260723-181732/verification.json)。

该证据只放行上述三个 Studio 场景，不代表跨 run resume，或以既有 run 为对象的
query/inspect、cancel/recover/close 浏览器 lifecycle 已完成。

同日释放并行测试负载后，在 `frontend` 目录重新执行标准 `npm run build`：
编译、TypeScript、page data 和静态页面生成全部成功，25 个页面完成，进程
exit 0。该结果只证明 fresh production build gate；final code review 仍 pending，
当前 review findings 不在本文中标记为已关闭。

## 本地复现

原生合同、算法、store、Workflow 和 migration：

```powershell
uv run --python 3.13 --extra dev pytest `
  tests/unit/test_native_intelligence_contracts.py `
  tests/unit/test_intelligence_store_dialects.py `
  tests/unit/test_native_intelligence_research_graph.py `
  tests/unit/test_native_intelligence_simulation.py `
  tests/unit/test_native_intelligence_interviews_reports.py `
  tests/integration/test_intelligence_session_store.py `
  tests/integration/test_intelligence_session_migration.py `
  tests/integration/test_native_intelligence_research_graph_pipeline.py `
  tests/integration/test_native_intelligence_simulation.py `
  tests/integration/test_native_intelligence_interviews_reports.py `
  tests/integration/test_workflow_native_intelligence_lifecycle.py `
  tests/unit/test_workflow_run_events.py `
  tests/integration/test_workflow_event_spine_integration.py `
  tests/integration/test_workflow_event_spine_migrations.py `
  --no-cov -q
```

Readiness、目录和前端静态合同：

```powershell
uv run --python 3.13 --extra dev pytest tests/unit/test_capability_exposure_matrix.py tests/unit/test_generate_capability_catalog.py --no-cov -q
uv run --python 3.13 python -m scripts.generate_capability_catalog --matrix docs/backend-capability-exposure-matrix.yaml --output frontend/lib/plugins/generated-capability-catalog.json --check
npm --prefix frontend run check:workflow-regressions
```

迁移与代码质量：

```powershell
uv run alembic heads
uv run ruff check backend tests
git diff --check
```

Live PostgreSQL 不是可跳过的发布 gate。`TEST_DATABASE_URL_PG` 必须指向一个
明确的 PostgreSQL 测试管理库；数据库名须包含独立的 `test`、`testing`、`ci`、
`tmp` 或 `temp` 标记，且不能包含 `prod`、`production`、`live` 或 `staging`。
测试不会在该管理库建业务表，而是为每个 scenario 创建随机 sibling database，
结束时终止残留连接并删除，因此测试角色需要 `CREATEDB` 权限。无 selector 的
本地运行明确 skip；CI 设置 `REQUIRE_POSTGRES_CONFORMANCE=1`，缺失或不安全的
URL 会直接失败。

本地已有安全 PostgreSQL 测试服务时运行：

```powershell
$env:TEST_DATABASE_URL_PG = "postgresql+asyncpg://opencli:secret@localhost:5432/opencli_admin_test"
uv run --python 3.13 --extra dev pytest `
  tests/integration/test_intelligence_session_store.py `
  tests/integration/test_intelligence_session_migration.py `
  tests/unit/test_workflow_run_events.py `
  tests/integration/test_workflow_event_spine_migrations.py `
  tests/integration/test_workflow_event_spine_integration.py `
  -m postgres_conformance --no-cov -p no:cacheprovider -q
```

该命令复用 SQLite 的 aggregate CRUD/CAS、idempotency、lease/recover、真实双连接
race、cross-session composite FK、outbox 和 WorkflowRunEvent allocator scenarios，
并在独立临时数据库执行 Alembic upgrade → downgrade → re-upgrade。event-spine
场景额外覆盖 append allocator CAS/idempotency/conflict、两个独立连接并发分配、
legacy duplicate/counter drift preflight、stopped-writer reconciliation、
expand → audit → contract、continuation、REST replay 和 DB-authoritative
projection。CI 的 `migrations` job 启动 PostgreSQL 16 service，并以强制模式运行
同一命令。仅运行 `tests/unit/test_intelligence_store_dialects.py` 或 Alembic
offline SQL 不足以放行。

event-spine expand revision 另有 PostgreSQL offline SQL 渲染检查；contract
revision 包含读取现存数据的 duplicate/counter-drift preflight，必须连接临时
PostgreSQL 执行，不能用 `--sql` 替代。

2026-07-23 另在本机启动真实 PostgreSQL 18.4 隔离 TEMP cluster，并设置
`REQUIRE_POSTGRES_CONFORMANCE=1`，按上方 CI 同款 5-file
`postgres_conformance` selector 执行：37 passed、40 deselected、exit 0。
测试完成后已停止该 PostgreSQL 服务并删除隔离 TEMP cluster 目录。该证据补充
而不替代 CI/release 强制 gate，也不把临时数据库残留在开发机。

## 运行检查

获取能力与 readiness：

```powershell
Invoke-RestMethod http://localhost:8000/api/v1/workflows/tool-capabilities
Invoke-RestMethod http://localhost:8000/api/v1/workflows/capabilities
```

检查已启动的 run：

```powershell
$runId = "<run-id>"
Invoke-RestMethod "http://localhost:8000/api/v1/workflows/runs/$runId"
Invoke-RestMethod "http://localhost:8000/api/v1/workflows/runs/$runId/checkpoint"
Invoke-RestMethod "http://localhost:8000/api/v1/workflows/runs/$runId/trace?limit=500"
Invoke-RestMethod "http://localhost:8000/api/v1/workflows/runs/$runId/events?afterSequence=0&limit=500"
```

应确认：

- readiness 的四个 predicates 全为 `true`，否则以 `missingReasons` 为准；
- 18 个 HDA action 按固定 transcript 执行并终止于 `closed`；
- `partial` 输出含 `intelligenceSessionRef`，artifact refs 只有
  `artifactId/kind/contentHash`；
- trace 中存在 `intelligence.workflow-projection.v1`，事件 sequence 连续；
- query actions 能看到 timeline/stats、interview history、report
  progress/sections/answers；
- native 参数中没有 last30days/MiroFish/Zep/LLM endpoint 或 credential。

## 稳定错误与排障

所有 action 共用的引用/并发错误：

- `intelligence_session_ref_invalid`
- `intelligence_session_id_invalid`
- `intelligence_session_not_found`
- `intelligence_artifact_ref_invalid`
- `intelligence_artifact_ref_kind_mismatch`
- `intelligence_artifact_ref_hash_mismatch`
- `intelligence_artifact_not_found`
- `intelligence_version_conflict`
- `intelligence_idempotency_conflict`
- `operation_in_progress`

主要 action-specific 错误：

- 研究/图谱：`research_input_required`, `research_artifact_missing`,
  `ontology_artifact_missing`, `graph_artifact_missing`
- 推演：`persona_artifact_missing`, `simulation_not_running`,
  `simulation_not_stopped`, `simulation_not_available`
- 访谈：`persona_id_required`, `persona_ids_required`,
  `simulation_artifact_missing`, `interview_not_in_progress`
- 报告：`interview_artifact_missing`, `report_not_in_progress`,
  `report_not_available`, `report_artifact_missing`, `question_required`
- 终止：`session_not_cancellable`

排障顺序：

1. 查 Tool Capability manifest 的 `readiness.predicates` 和 `missingReasons`。
2. 查 run checkpoint/trace，确认最后 committed sequence 与 domain state。
3. 遇到 `operation_in_progress` 时检查 lease 是否仍有效；过期 operation 必须
   recovery，不能直接 complete。
4. 遇到 version/idempotency conflict 时重新加载最新
   `intelligenceSessionRef.version`；同 key 不得改变 canonical payload。
5. 遇到 artifact ref 错误时不要重写 hash/kind；从最后 committed output 获取新
   typed ref。
6. mirror 失败只重试 outbox；不得回滚或手工重写 authoritative transition。

尚未覆盖的跨 run Browser lifecycle 与 final code review 通过前，不得把对应
待验项改写为“已完成”；本次 live PostgreSQL、fresh build 与三场景 Chrome
证据也不扩大其验收范围。
