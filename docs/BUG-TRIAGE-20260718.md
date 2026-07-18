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
