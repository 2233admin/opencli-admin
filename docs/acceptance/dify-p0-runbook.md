# Dify P0 验收手册

本手册验收两条相互独立的能力：Dify Workflow DSL 兼容运行，以及 Dify 插件包的元数据登记。插件登记不会执行插件 Python/JavaScript，也不会自动授予网络、模型、密钥或沙箱权限。

## 前置条件

1. 从仓库根目录启动 Compose，确认 API、Frontend、PostgreSQL 和 `dify-graphon-runtime` 健康。
2. Graphon 健康响应必须报告：
   - `contractVersion`: `opencli.graphon.compat.v1`
   - `engine.name`: `graphon`
   - `engine.version`: `0.7.0`
   - `engine.commit`: `b187ce7927fea1a7c137b642be3f78e3abb9f7de`
3. 准备文件：
   - `tests/fixtures/dify/pure_logic.yml`
   - `tests/fixtures/dify/llm_answer.yml`
   - `tests/fixtures/dify/http_request.yml`
   - `tests/fixtures/dify/code_blocked.yml`
   - `tests/fixtures/dify_plugins/tool_manifest.yaml`

如果 API 配置了 `API_AUTH_TOKEN`，下述请求均增加 `Authorization: Bearer <token>`。

## A. 插件登记

1. 打开 `/plugins`，确认“已安装插件”由后端注册表返回；断开 API 后，页面必须显示“插件能力目录”和后端不可用提示，前端占位不得标为已安装。
2. 选择“安装插件包”，上传 `tool_manifest.yaml`。
3. 记录响应和详情页中的：
   - `id`（installed plugin id）
   - `providerKey`、`version`、`author`
   - `sourceKind`、`sourceDigest`、`manifestSpecVersion`
   - `signatureState`
   - `pluginTypes`、`permissions.requiredCredentials`
   - `runtimeStatus`、`blockers`、`nodeDefinitions`
4. 预期 `runtimeStatus` 为 `BLOCKED`，每项未适配能力必须有稳定 blocker；页面上无需打开开发者工具即可理解原因。
5. 在 Studio 节点搜索中搜索 Provider 名称。预期显示 Provider/版本来源，节点处于锁定状态且不能拖入画布。

截图：插件列表、插件详情（含 blocker）、Studio 锁定节点搜索结果。

## B. Workflow 导入与编译

1. 打开 `/studio`，选择“导入 DSL”，上传 `pure_logic.yml`。
2. 确认导入报告显示 Graphon 后端检查，画布只有一个 Dify package；展开后应有 `source-start-001` 和 `source-end-002` 两个内部节点，package 为 locked/managed。
3. 编译并确认：
   - `valid: true`
   - runtime 只有一个顶层 package binding
   - `binding_id: workflow.compat.dify.graphon`
   - `sourceNodeIndex` 与两个内部节点一致
4. 分别导入并编译 LLM、HTTP、Code fixture。预期返回准确、可操作的 blocker，而不是通用 500：模型/运行时、网络策略、沙箱。
5. Dify tool 插件在 P0 只登记元数据；其节点必须返回 `dify_plugin_runtime_adapter_required` 或 `tool_adapter_required`，不得执行包内代码。

截图：单一 package、展开的内部节点、编译 blocker 面板。

## C. 运行与持久化回放

1. 运行 `pure_logic.yml` 导入所得工作流，记录 `runId`。
2. 等待 terminal status；预期为 `completed`。
3. 查询 `/api/v1/workflows/runs/<runId>/events`，记录：事件数、每个 `sequence`、`nodePath`、`internalNodeId` 和最终输出引用。
4. 预期 sequence 从 1 严格递增；Start/End 的事件路径均为 `[packageId, internalNodeId]`。
5. 刷新运行页，重新读取同一 run。预期事件数、顺序、内部节点最终状态和输出引用完全一致。
6. 对 LLM fixture：已配置对应模型运行时则记录真实答案；未配置则必须显示精确 blocker，不能降级成假成功。

截图：运行中内部节点状态、完成状态与输出、刷新后的相同状态。

## D. 自动验证

```text
pnpm --dir frontend run check:dify-p0
pnpm --dir frontend run check:workflow-regressions
pnpm --dir frontend run check:control-plane
pnpm --dir frontend run lint
pnpm --dir frontend run build
uv run pytest --no-cov tests/integration/test_workflow_dify_import_api.py tests/integration/test_workflow_dify_compile_api.py tests/integration/test_workflow_dify_run.py tests/integration/test_plugin_dify_import_api.py tests/unit/test_dify_package_security.py
cd compat/dify_graphon_runtime
uv run pytest tests/test_contract.py
```

验收记录至少保存：日期、Git commit、Graphon identity、installed plugin id、run id、event count、内部节点最终状态、输出 artifact/reference、所有截图路径和未通过项。
