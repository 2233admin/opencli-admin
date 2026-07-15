# 前端操作链路与 5090 协同拆分

## 目标

把当前分散的“项目、工作流、数据源、调度、通知、任务、成果”收敛为一条用户能理解的主链路：

> 与 Agent 描述监测目标 → 确认来源 / 频率 / 邮箱 → 保存项目 → 验证 → 激活 → 查看运行 → 收到简报 → 异常回到待处理

P0 完成标准：用户不需要离开项目上下文，也不需要理解后端资源名，就能创建并激活一个定时采集、邮件交付的监测项目，并看见第一次运行结果。

## 当前操作逻辑盘点

### 已经成立

- `/studio` 是项目入口，支持 Agent、模板、DSL 三种创建方式。
- `/studio/new` 已突出 Agent，并收集数据来源、检查频率和邮件地址。
- `/studio/workflow` 已具备草稿自动保存、验证 Run 和发布版本动作。
- `/sources` 可以启停来源并手动触发采集。
- `/tasks`、`/records`、`/notifications` 已能展示运行、数据和通知结果。
- `/inbox` 已具备异常、等待事项、复核信号的运营入口。

### 主要断点

1. Agent 创建只保存 `Project + WorkflowDraft`，不会创建或绑定数据源、调度和邮件规则。
2. “发布工作流版本”和“激活可运行项目”是两个不同概念，但界面没有解释，也没有第二步动作。
3. 来源、调度、通知是全局资源页，缺少项目上下文和统一的项目关联键。
4. 调度页与通知页主要是查看页，用户无法从项目链路完成创建、编辑和测试。
5. 项目页没有清晰显示草稿、已验证、已发布、已激活、运行异常等生命周期状态。
6. 创建完成后直接进入复杂画布；普通用户不知道下一步应验证、补配置还是激活。
7. Dashboard 的快捷入口仍把工作拆成“编排、接源、调度、看结果”，强化了系统资源视角，而不是项目闭环。
8. “工作项、运行、记录、通知”之间缺少项目级跳转和统一时间线。

## 建议的信息架构

侧栏保留四组，但用户主任务只从“项目”开始：

- 工作台：概览、待我处理
- 构建：项目、Agent 团队
- 运行：运行与成果
- 管理：资源与设置

`数据源 / 调度 / 通知 / Worker / Provider` 作为管理资源仍可独立访问，但日常创建流程从项目详情完成。

项目详情固定提供五个阶段：

1. 需求：Agent 对话和项目目标
2. 配置：来源、频率、邮箱
3. 工作流：节点编排与验证
4. 激活：部署状态、下一次运行、手动试跑
5. 结果：运行、记录、邮件投递和异常

## 协同任务拆分

### P0：打通第一个闭环

| ID | 任务 | 本机前端 | 5090 | 联调验收 |
| --- | --- | --- | --- | --- |
| FE-P0-01 | 项目生命周期壳 | 新增项目详情/状态条，显示草稿、待验证、已发布、待激活、运行中、异常 | 返回统一生命周期状态 | 一个项目只显示一个明确主动作 |
| FE-P0-02 | Agent 配置确认 | 把对话结果整理为可编辑的来源、频率、邮箱确认区 | 提供需求解析后的规范化配置或接受前端提交的配置 | 创建前可检查三项必填配置 |
| BE-P0-01 | 项目部署接口 | 调用部署接口并展示逐步结果 | 原子或可补偿地创建/绑定 Source、Schedule、Email Rule | 重试不会创建重复资源 |
| BE-P0-02 | 项目关联模型 | 所有详情和跳转携带 project id | Source、Schedule、Notification Rule、Run 可按 project id 查询 | 项目详情可汇总所有资源 |
| FE-P0-03 | 激活确认页 | 发布后进入激活检查，不直接把“发布”当成运行 | 返回阻塞项、警告项、可激活状态 | 缺凭证或 SMTP 时明确阻塞且可定位 |
| FE-P0-04 | 首次试跑 | 提供“激活并试跑”和实时状态 | 创建部署后触发一次 run，返回 run id | 用户能看到采集、处理、邮件投递各阶段 |
| FE-P0-05 | 项目结果页 | 项目内展示最近运行、记录数、邮件状态、下一次运行 | 提供项目摘要与最近运行接口 | 无需跳转全局页即可判断是否成功 |
| FE-P0-06 | 错误回路 | 错误提示给出修复动作并链接配置项 | 使用稳定错误码和 resource pointer | 失败不会只显示 500 或原始英文信息 |

### P1：让操作顺畅

| ID | 任务 | 负责人 | 验收 |
| --- | --- | --- | --- |
| FE-P1-01 | 重做 Dashboard 快捷动作 | 本机前端 | 主动作是“创建监测项目”，次动作是“处理异常” |
| FE-P1-02 | 合并运行信息架构 | 本机前端 | 项目内统一显示工作项、运行、记录、投递；全局页用于跨项目查询 |
| FE-P1-03 | 项目级面包屑与返回路径 | 本机前端 | 从资源详情返回原项目，不丢 workspace/project 上下文 |
| FE-P1-04 | 模板与 Agent 衔接 | 本机前端 | 选模板后仍进入 Agent 确认，而不是直接生成不可理解的画布 |
| FE-P1-05 | 空白创建引导 | 本机前端 | 空白画布提供来源、处理、交付三步引导和推荐节点 |
| BE-P1-01 | 邮件测试与投递诊断 | 5090 | 可单独测试 SMTP，区分连接、认证、收件人和内容错误 |
| BE-P1-02 | 项目运行摘要 | 5090 | 汇总 next_run、last_run、record_count、delivery_status、health |

### P2：扩展交付与智能化

| ID | 任务 | 负责人 | 验收 |
| --- | --- | --- | --- |
| P2-01 | 多渠道发送 | 双方 | 邮件之外可扩展 Webhook、飞书、钉钉等，复用同一交付步骤 |
| P2-02 | Agent 自动修复建议 | 双方 | 根据运行错误生成修改建议，必须经过用户确认后应用 |
| P2-03 | 趋势与专题报告 | 5090 主、本机展示 | 跨来源聚合、去重、趋势历史和周期报告形成产品级能力 |
| P2-04 | 发布渠道调用 | 5090 主、本机审批 | 外部发布动作具备预览、审批、审计和幂等保障 |

## 5090 接口契约建议

### 1. 部署预检

`POST /api/v1/workspaces/{workspace_id}/projects/{project_id}/deployment-check`

输入：`workflow_id`、`workflow_version`、来源配置、schedule、delivery。

输出：

```json
{
  "ready": false,
  "blockers": [
    { "code": "SMTP_NOT_CONFIGURED", "field": "delivery.email", "message": "邮件服务尚未配置" }
  ],
  "warnings": [],
  "resolved_resources": []
}
```

### 2. 激活项目

`POST /api/v1/workspaces/{workspace_id}/projects/{project_id}/deployments`

要求：支持 `Idempotency-Key`；创建或更新项目绑定的 Source、Schedule、Notification Rule；返回 deployment id 和资源映射。

### 3. 项目运行摘要

`GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/operations-summary`

至少返回：`lifecycle_status`、`next_run_at`、`last_run`、`records_count`、`delivery_status`、`health`、`blockers`。

### 4. 激活并试跑

`POST /api/v1/workspaces/{workspace_id}/projects/{project_id}/runs`

返回统一 `run_id`，前端复用现有 run event/trace 能力展示阶段进度。

### 5. 稳定错误结构

所有项目部署相关错误统一为：

```json
{
  "code": "SOURCE_CREDENTIAL_MISSING",
  "message": "数据源缺少访问凭证",
  "resource_type": "source",
  "resource_id": null,
  "field": "source.credentials",
  "retryable": false
}
```

## 并行顺序

### 本机现在可以独立推进

1. FE-P0-01 项目生命周期壳和项目详情布局。
2. FE-P0-02 Agent 结果确认区。
3. FE-P0-03 激活检查页，先接 mock contract / feature flag。
4. FE-P1-01 Dashboard 和导航动作收敛。

### 5090 现在可以独立推进

1. BE-P0-02 项目关联字段和查询。
2. BE-P0-01 deployment-check / deployments。
3. FE-P0-04 所需的项目 run 入口。
4. BE-P1-01 SMTP test 和稳定错误码。

### 第一轮联调门槛

- 5090 提供 OpenAPI 或真实响应样例。
- 双方固定 workspace/project/workflow/version 四个标识的传递规则。
- 部署接口具备幂等性，前端才能安全重试。
- 邮件未配置时必须返回业务阻塞，不返回泛化 500。
- 试跑返回的 run id 能被现有事件和 trace 接口读取。

## 暂不做

- P0 不做多渠道发送。
- P0 不把“发布 WorkflowVersion”包装成“已经上线”。
- P0 不从项目创建全局、无 source 绑定的邮件规则。
- P0 不重写现有工作流画布或运行时。
