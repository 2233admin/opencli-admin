# 原生智能生命周期架构

OpenCLI Admin 现在拥有一条确定性、离线、零凭据的原生智能路径：证据研究 →
本体 → 图谱 → 人格 → 群体推演 → 访谈 → 报告 → 报告问答 → 关闭。默认路径只使用
仓库代码和 SQLite；网络、外部 LLM、Redis/ODP、Zep、PostgreSQL、
last30days 和 MiroFish 都不是运行前提。

实现入口：

- [原生执行器](../../backend/workflow/native_intelligence_executor.py)
- [阶段算法](../../backend/workflow/intelligence/stages.py)
- [版本化合同](../../backend/workflow/native_intelligence_contracts.py)
- [聚合状态机](../../backend/workflow/native_intelligence_state.py)
- [持久化命令服务](../../backend/workflow/intelligence_store.py)
- [离线固定夹具](../../backend/workflow/fixtures/native_intelligence_offline.json)

## 能力面

后端注册 29 个可独立编排的 granular actions；每个 action 都有自己的
`workflow.native-intelligence.<action>` binding、输入/输出合同、稳定错误、
夹具场景和 readiness 结果。

| 分组 | Actions |
| --- | --- |
| 研究与知识 | `research`, `ontology`, `graph`, `personas` |
| 推演 | `simulation.prepare`, `simulation.start`, `simulation.step`, `simulation.run`, `simulation.stop`, `simulation.resume`, `simulation.status`, `simulation.actions`, `simulation.timeline`, `simulation.stats` |
| 访谈 | `interviews.one`, `interviews.batch`, `interviews.all`, `interviews.step`, `interviews.run`, `interviews.history` |
| 报告 | `report.start`, `report.step`, `report.run`, `report.progress`, `report.read`, `report.ask`, `report.answers` |
| 生命周期 | `cancel`, `close` |

Studio 的 `native-intelligence-lifecycle` HDA 锁定组合其中 18 个 action，覆盖完整
离线主路径，同时保留单步、暂停/恢复、单人/批量访谈和查询 actions 供高级编排。
HDA 定义位于
[hda_templates.py](../../backend/workflow/hda_templates.py)，目录投影位于
[capability_projection.py](../../backend/workflow/capability_projection.py)。

## 内化边界

last30days 和 MiroFish 只作为产品能力盘点与算法内化的参考。原生 lifecycle：

- 不调用这两个 runtime；
- 不要求它们的路径、URL、密钥或进程；
- 不承诺其 API、内部状态或部署形态 parity；
- 不把模拟产物伪装成采集证据，所有相关 artifact 均携带 `simulated`、
  provenance、algorithm version 和 seed。

仓库内原有 compatibility provider 可以继续独立存在，但不能改变原生 action
合同或 readiness。

## 聚合、恢复与事件脊柱

`IntelligenceSession` 是唯一生命周期聚合。它集中管理：

- 合法状态迁移和 Workflow status 投影；
- `version` compare-and-swap；
- `(session_id, idempotency_key)` 与 canonical request hash；
- artifact、grounding/reference、transition 和 command result；
- `researching`、`interviewing`、`reporting` 的 operation lease、attempt 和
  checkpoint manifest；
- retryable failure 的原始 command、idempotency identity、request hash 和确定性
  resume target；
- cancel、close 和 post-close 拒绝。

每个变更命令在同一 SQLAlchemy transaction 内完成：

1. CAS 更新聚合版本；
2. 追加 artifact、同 session reference、authoritative transition 和 idempotency
   record；
3. 通过共享 allocator 追加有界 `WorkflowRunEvent`；
4. 写入稳定 `event_id` 的 transactional outbox。

commit 后才进行 best-effort mirror dispatch。发布失败不回滚权威状态；重试是
at-least-once，消费者按 `event_id` 去重。Workflow 事件统一走
[workflow_run_events.py](../../backend/workflow/workflow_run_events.py)，因此续跑、
并发 session 和 SSE replay 共用一条 gap-free 事件脊柱，不存在第二套 runtime
事件流。

过期 operation 不能直接完成：必须先以 expected-version CAS recovery 取得 lease。
访谈从 checkpoint manifest 中跳过已完成 persona；报告从第一个缺失 section
恢复。非过期外部 owner 返回 `operation_in_progress`。

## Typed reference 与跨 run 续跑

节点之间只传递有界引用，不传完整 artifact body：

```json
{
  "schema": "intelligence-session-ref.v1",
  "sessionId": "uuid",
  "version": 12,
  "artifactRefs": [
    {
      "artifactId": "report_...",
      "kind": "report",
      "contentHash": "sha256"
    }
  ]
}
```

后续 Workflow run 可以显式提交 `intelligenceSessionRef` 继续同一 session。
读取始终同时限定 `session_id` 和 `artifact_id`，并校验 kind/content hash；
composite foreign keys 使数据库无法表达跨 session grounding。篡改或猜测引用
不会改变聚合，也不会泄露另一 session 是否存在。

## Readiness

29 个 action 均由四个机器谓词认证：

- `executor_registered`
- `contract_complete`
- `fixture_evidence_registered`
- `gates_resolvable`

四者全部为真才投影为 `runnable`。任一执行器、action-specific runtime contract、
夹具 transcript/hash 或 gate resolver 缺失/畸形时，都 fail closed 为 `blocked`，
并返回 `missingReasons`；调用方不能通过提交 status 提升 readiness。完整 HDA
只依赖其 18 个子 action，因此可选查询 action 被阻塞不会伪造 HDA 状态。

## 查询与检查

完整 lifecycle 的 query/inspect actions 包括：

- 推演：`simulation.status`, `simulation.actions`, `simulation.timeline`,
  `simulation.stats`
- 访谈：`interviews.history`
- 报告：`report.progress`, `report.read`, `report.answers`

Workflow 层使用现有接口检查运行状态与恢复点：

- `GET /api/v1/workflows/runs/{run_id}`
- `GET /api/v1/workflows/runs/{run_id}/checkpoint`
- `GET /api/v1/workflows/runs/{run_id}/trace`
- `GET /api/v1/workflows/runs/{run_id}/events`
- `GET /api/v1/workflows/runs/{run_id}/events/stream`

事件仅携带 session/artifact references、状态和有界摘要；完整内容由
session-scoped store 查询。命令、故障诊断和当前验证状态见
[原生智能生命周期验证记录](../verification/native-intelligence-lifecycle.md)。
