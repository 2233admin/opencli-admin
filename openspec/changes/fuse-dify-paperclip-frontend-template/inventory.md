# Product Inventory

## Conclusion

OpenCLI already contains most of the execution surfaces needed for the fusion. The
missing layer is a consistent object hierarchy and a shell that keeps building,
running, evidence, review, and governance in one context.

This is not a visual reskin. The intended product loop is:

`目标 → 项目 → 工作流/自动化 → 工作项 → 运行 → 成果/证据 → 复核/审批 → 完成`

## Current OpenCLI Assets

| Capability | Existing surface | Reuse decision |
| --- | --- | --- |
| Global action queue | `/inbox` | Keep as the cross-project human action surface. |
| Workspace and templates | `/studio` | Keep as the entry into projects and imported DSL. |
| Workflow editor | `/studio/workflow` | Use as the Dify-style builder spine. |
| Dify import | `frontend/lib/workflow/dify-translator.ts` | Keep the canonical translation path and compatibility report. |
| Work list and run detail | `/tasks`, `/tasks/[id]` | Separate business work state from individual run state. |
| Sources and schedules | `/sources`, `/schedules` | Promote as explicit data-chain and trigger domains. |
| Runtime evidence | Run trace, events, EvidenceBatch, `/records` | Join under work-item and workflow context. |
| Agents and execution resources | `/agents`, `/skills`, `/nodes`, `/workers` | Group as team/capability resources, not the product center. |
| Governance | `/control/actions`, providers, operations API types | Surface approvals, policies, cost and audit around work. |

### Existing seams to repair

1. `/tasks` currently means a collection task while the API also defines richer
   `OperationsWorkItem` types. These must not remain the same user-facing object.
2. Run state, work state, approval state, and evidence live in separate screens.
3. Workflow debug runs and production runs need an explicit environment boundary.
4. Data chain, schedules, and runtime data must stay visible as first-class domains;
   they must not disappear inside a generic workspace bucket.
5. The global and workflow command palettes need distinct names and scopes.
6. The current `DESIGN.md` still references the previous Vite tree and is stale against
   the active Next.js app; this change follows current code and tokens.

## Dify Logic To Learn

Dify uses two navigation levels:

- Global resource domains: Apps, Agents, Knowledge, Integrations, Marketplace and
  deployments.
- Object lifecycle inside one app: orchestrate/configure, API access, logs, annotations,
  monitoring and permissions.

Its useful development loop is:

`模板/空白/导入 → 编排 → 整体或单节点调试 → 变量与追踪 → 发布版本 → 生产运行 → 日志与指标 → 修改再发布`

OpenCLI should learn the separation between debug and production, the explicit
draft/version/publish model, and data/integrations as reusable workspace assets.

Official references:

- https://github.com/langgenius/dify/blob/main/web/app/components/main-nav/routes.ts
- https://github.com/langgenius/dify/blob/main/web/app/components/app-sidebar/app-detail-section.tsx
- https://docs.dify.ai/en/self-host/use-dify/debug/history-and-logs
- https://docs.dify.ai/en/self-host/use-dify/build/version-control
- https://docs.dify.ai/en/self-host/use-dify/knowledge/readme

Do not copy Dify's chatbot/app-type taxonomy, chat feedback model, or RAG-first language.

## Paperclip Logic To Learn

Paperclip makes the task the control-plane object and connects it to goal, project,
agent run, output, approval, costs, and activity. Task status remains distinct from an
individual run's process status.

Its useful governance loop is:

`Goal → Project → Task → Agent Run → Output/Evidence → Review/Approval → Done`

OpenCLI should learn the actionable inbox, task detail as a cockpit, deep-linked runs,
approval gates, budgets as control limits, and activity as immutable evidence.

Official references:

- https://github.com/paperclipai/paperclip/blob/634ae1298fca40d8755060b8d505460db73bdcb5/docs/start/core-concepts.md
- https://github.com/paperclipai/paperclip/blob/634ae1298fca40d8755060b8d505460db73bdcb5/ui/src/components/Sidebar.tsx
- https://github.com/paperclipai/paperclip/blob/634ae1298fca40d8755060b8d505460db73bdcb5/ui/src/pages/IssueDetail.tsx
- https://github.com/paperclipai/paperclip/blob/634ae1298fca40d8755060b8d505460db73bdcb5/ui/src/pages/Inbox.tsx

Do not copy the AI-company/CEO/employee metaphor, heartbeat terminology, or the full
finance and organization hierarchy.

## Unified Vocabulary

| Unified object | Meaning in OpenCLI | Dify influence | Paperclip influence |
| --- | --- | --- | --- |
| 控制空间 | Resource and permission boundary | Workspace | Company boundary without metaphor |
| 目标 | Desired operational outcome | App purpose | Goal |
| 项目 | Deliverable boundary | App/project shell | Project |
| 工作流 | Executable design | Workflow canvas | Routine/pipeline |
| 工作项 | Business progress and ownership | App task/operation | Issue/task |
| 运行 | One execution attempt | Debug/production run | Agent run |
| 成果与证据 | Data, artifacts and trace | Output/logs | Artifacts/evidence |
| 复核与审批 | Human control gate | Annotation/feedback | Approval |
| Agent 与资源 | Reusable execution capability | Agents/tools/integrations | Agents |
| 用量与成本 | Budget and execution guardrail | Usage | Costs |
| 审计动态 | Immutable change history | Logs | Activity |

## Recommended Information Architecture

Global level:

`概览 / 待我处理 / 工作区 / 数据链路 / 触发与调度 / 运行数据 / Agent 与执行资源 / 集成中心 / 治理与设置`

Inside a project:

`总览 / 工作项 / 编排 / 调试运行 / 版本 / 成果与审计`

The prototype must keep these two levels visually distinct.
