# Dify P0 本地 E2E 验收记录（2026-07-21）

## 范围与环境

- Backend/runtime acceptance commit: `a9c312e`
- Studio palette compatibility follow-up: `fbfa881`
- Backend: `http://127.0.0.1:8031`
- Graphon sidecar: `http://127.0.0.1:8095`
- 验收方式：本地独立进程 HTTP E2E（非 Docker Compose）
- Graphon contract: `opencli.graphon.compat.v1`
- Graphon engine: `graphon 0.7.0`
- Graphon commit: `b187ce7927fea1a7c137b642be3f78e3abb9f7de`
- Dify Slim: `0.6.5` 已固定，当前机器未安装可执行 helper，健康响应为 `available: false`

## 插件注册表与运行时状态

- Graphon 在线：插件 `runtimeStatus=READY`；Workflow capability `status=runnable`、`backendAvailable=true`。
- 停止 sidecar 后：插件 `runtimeStatus=BLOCKED`；Workflow capability `status=blocked`、`backendAvailable=false`；blocker 为 `dify_graphon_unavailable`。
- 恢复 sidecar 后：状态重新变为 `READY/runnable`。
- 元数据导入插件：
  - id: `6004d08d-b822-464b-8266-ad0cb5524a7a`
  - provider: `example/research_tools`
  - version: `1.2.3`
  - runtime status: `BLOCKED`
  - 插件包代码未执行；能力以锁定节点投影到 Studio。

## Workflow 导入、编译与运行

- Pure logic fixture 导入为一个 locked/managed package，内部节点为 `source-start-001`、`source-end-002`。
- Compile binding: `workflow.compat.dify.graphon`
- OpenCLI run id: `dify-acceptance-1784644067`
- Graphon runtime run id: `45ec6aae-d728-4453-bed1-681ca7c7a68f`
- Terminal status: `completed`
- Event count: `9`
- Event sequence: `1,2,3,4,5,6,7,8,9`
- Nested final states:
  - `source-start-001`: `completed`
  - `source-end-002`: `completed`
- Output preview: `{ "outputs": {} }`
- 连续两次读取持久化事件：内容完全一致。

## 运行前结构化阻断

| Fixture | Compile | Blocker |
| --- | --- | --- |
| `llm_answer.yml` | blocked | `dify_model_provider_required`, `dify_slim_runtime_required` |
| `http_request.yml` | blocked | `network_permission_required` |
| `code_blocked.yml` | blocked | `dify_sandbox_required` |
| `tool_blocked.yml` | blocked | `tool_adapter_required` |

## 自动验证

- Backend P0 integration suite: `34 passed`
- Graphon sidecar contract suite: `19 passed`
- Frontend `check:dify-p0`: `5 passed`
- Frontend workflow regressions: `38 passed`
- Frontend control-plane regressions: `14 passed`
- Frontend TypeScript: passed (`tsc --noEmit`)
- Frontend clean production build: passed
- Ruff targeted validation: passed
- 干净 worktree `git diff --check`: passed

## 尚未完成的环境验收

- Docker CLI 存在，但本机 Docker daemon 在本次验收中无响应，因此没有执行 Compose 网络、容器健康检查和容器重启持久化验证。
- 插件中心与 Studio 已完成浏览器人工 smoke check，但本次没有提交截图文件；截图证据仍需在可用的 Compose/审核环境补录。

以上两项是部署环境证据缺口，不改变本次本地进程 E2E 的通过结果，也不应被表述为 Compose 已验收。
