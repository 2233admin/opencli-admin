# 前端操作链路与 5090 协同拆分

## 本轮目标

Studio 的 Agent、模板、空白三种创建入口，以及 DSL 导入，统一落到同一条 canonical 链路：

> 创建 Project Draft + Primary Workflow + Workflow Draft → 编辑 → Validation Run → 发布 immutable Workflow Version

本轮只完成这条 authoring 链路。资源关联、Automation、正式 Run 和 Delivery 后移，避免再次把历史的“应用类型”或“项目部署”变成平行领域模型。

## Canonical 约束

- `Project` 是持续业务结果边界；创建入口不同，但持久化对象和生命周期相同。
- 创建必须事务性 bootstrap `Project Draft`、`Primary Workflow` 和 revision 为 `1` 的 `Workflow Draft`。任一步失败都不得留下孤立 Project 或 Workflow。
- Validation Run 绑定明确的 Draft revision，只产生验证证据，不是正式 Run，也不代表发布。
- 发布从已验证 Draft 创建不可变的 `Workflow Version`。发布不启动执行，已发布版本不得被覆盖更新。
- `Automation` 引用明确的 Workflow Version；启用/停用属于 Automation。不存在“激活 Project”“激活 Workflow”或 `Project deployment` 领域对象。
- Project 的运行中、未运行、部分运行或阻塞只是由 Workflow、Automation、资源和近期 Run 推导出的 operational state，不是可切换的激活状态。
- `app_type` 仅用于 Dify 导入兼容、标签和五类筛选；它不得选择不同的创建 API、Draft schema、验证、发布或运行生命周期。

## 实施批次

### 批次 1：canonical authoring（当前）

1. **事务 bootstrap**
   - 一个请求创建 Project Draft、Primary Workflow 和 Workflow Draft，并一次返回三个稳定 ID 与 Draft revision。
   - Agent、模板、空白和“导入到新 Project”复用该事务；模板和 Dify 仅提供初始 graph/展示分类。
   - 验收：失败全量回滚；重试不产生半成品；Primary Workflow 可从 Project 稳定定位。

2. **Validation Runs**
   - `POST /api/v1/workspaces/{workspace_id}/projects/{project_id}/workflows/{workflow_id}/draft/validation-runs`。
   - 结果持久化并返回 `runId`、`workflowId`、Draft revision、状态、`valid`、errors/warnings。
   - 验收：验证旧 revision 的结果不能替当前 Draft 背书；Validation Run 不写正式 Run 历史。

3. **Immutable Versions**
   - 发布请求携带已验证的 base revision，创建单调递增、不可变的 Workflow Version。
   - 验收：并发旧 revision 返回冲突；读取历史版本内容稳定；发布后不创建、不启用 Automation。

### 批次 2：运营资源（后续）

- Project Connection Binding、Source、Destination 等资源关联。
- 创建 Automation、绑定明确 Workflow Version，以及独立的启用/停用动作。
- 正式 Run、事件、trace、artifacts 与恢复入口。
- Side Effect Operation、Delivery Execution Result、Delivery Business Outcome、幂等与 Recovery Case。

批次 2 不得反向改变批次 1 的 Project/Draft/Version 身份与生命周期。

## 5090 基线与本轮任务

### 基线门槛

5090 必须从包含当前基线 `4d4ef84` 的 HEAD 或其后同步分支开始：

```powershell
git merge-base --is-ancestor 4d4ef84 HEAD
git rev-parse --short HEAD
```

第一条命令必须成功。不得基于仍停留在 `c42ece1` 的 `origin/main` 开工；若远端 main 未同步，直接使用包含 `4d4ef84` 的同步分支作为基线。

### 5090 当前优先级

5090 本轮不修改 Studio backend，优先用真实浏览器完成以下 E2E：

1. 五类筛选分别只显示对应 `app_type`，切回“全部”恢复完整列表。
2. 单 Workspace 显示真实名称；多 Workspace 出现选择器，切换后项目列表和新建目标 Workspace 同步变化。
3. 分别导入五种 Dify mode，并验证映射：
   - `chat` → `chatbot`
   - `agent-chat` → `agent`
   - `advanced-chat` → `chatflow`
   - `workflow` → `workflow`
   - `completion` → `text-generator`
4. 每种导入都落到同一套 Project + Primary Workflow + Draft authoring 链路；`app_type` 只影响标签和筛选。

每项保留浏览器截图、使用的 Workspace/Project ID、关键请求响应与失败复现。若浏览器环境不可用，改做独立只读 review，输出按严重级别排序的发现，不直接修 backend。

## 文件所有权（本轮）

| 执行方 | 独占范围 | 禁止范围 |
| --- | --- | --- |
| 本机 backend executor | `backend/api/v1/studio.py`、`backend/models/studio.py`、Studio migration、`tests/integration/test_studio_authoring_api.py` 及对应 backend authoring tests | 不接收 5090 对同文件的并行修改 |
| 本机 frontend/integrator | `frontend/app/(app)/studio/**`、`frontend/lib/studio/**`、Studio 相关 API hooks/types 与 Dify translator | 不修改 backend executor 的独占文件 |
| 5090 | 真实浏览器验证；证据仅写入单独的 `docs/verification/*5090-studio*` 报告/附件，或提交只读 review | 不修改 `backend/**`、`tests/integration/test_studio_authoring_api.py` 或本机正在编辑的 Studio 前端文件 |
| 本文档 writer | 仅 `docs/frontend-operation-flow-5090-coordination.md` | 不修改代码或其他文档 |

发现产品缺陷时，5090 先报告复现步骤、预期/实际结果和证据；由本机 owner 修复后再复验。下一批如需把实现交给 5090，必须先显式重分配文件所有权。

## 批次 1 联调完成标准

- 三种创建入口和 Dify 新建导入都使用事务 bootstrap，无孤立 Project/Workflow。
- Draft revision 冲突可见，Validation Run 与 revision 对应。
- 发布生成不可变版本，重复读取一致，旧 revision 无法覆盖。
- UI 和接口均不把发布描述成 Project/Workflow 激活；本批不出现 deployment 接口。
- 五类 `app_type` 共用同一 authoring contract 和生命周期。
- backend targeted tests、frontend lint/typecheck 与 5090 浏览器证据均有新结果。
