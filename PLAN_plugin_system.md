# PLAN: Dify 式插件系统 (方向记录, 待讨论)

2026-07-18 口述方向, 未排期。本文只固化共识, 不是实施承诺。

## 方向

系统学 Dify 的插件架构: **工作流管线里的每种能力都是插件** —— 工具节点 (JoyAI-VL、OKX 行情、opencli 采集)、Agent (对话/富化/研判)、通知渠道、数据源渠道, 全部同一套插件契约装卸。

现状已经半路在这个形态上:

| 现状机制 | 插件化后 |
|---|---|
| `backend/workflow/tool_capabilities.py` 硬编码注册表 | 插件 manifest 声明 capability, 装载时注册 |
| executor mode = schema Literal 白名单 (改一次动三处: schema/registry/tracer) | executor 随插件包提供, 运行时发现 |
| chat.py agent 工具面硬编码 4 类 | agent = 插件, 工具面由已装插件聚合 (全局对话 agent 控制整个工作台的前提) |
| channel_type (rss/opencli/cli/...) if-else 分发 | 渠道插件 |

## 为什么是 Dify 模式

- 已有 Dify 工作流导入 (`import/external-runtime`), 概念对齐降低映射成本
- Dify 插件 = manifest (声明 capability/权限/配置 schema) + 运行时包, 与本仓 tool capability `manifest` 字段现有形状接近
- 装卸不动核心: 新增一个 JoyAI 级别的节点不应该再改 `schemas/workflow.py` 的 Literal (本次 PR #19 实际改了 5 处 — 这就是要消掉的摩擦)

## 最小起步 (讨论后再动)

1. executor mode 从 schema Literal 放开为 str + 运行时注册校验 (消掉三处联动)
2. tool capability 注册表改声明式加载 (entry-point / 目录扫描)
3. chat agent 工具面从插件注册表聚合, 而不是手写 TOOLS 列表

## 未决问题 (拉 5080 一起定)

- 插件边界: 进程内 Python 包, 还是 Dify 那种独立进程/沙箱?
- 前端 palette 与插件 manifest 的目录联动 (节点实时查找痛点一并解)
- 权限模型: 插件声明 permissions, 谁批?

## UI 分组铁律 (2026-07-18 走查补充)

**目录 (可安装的生态) 与实例 (已接入的配置) 必须分开成组** — Dify 插件市场 vs 应用内引用的关系:

- 「RSS 源库」= provider 目录 → 独立源库/生态分组, 不挂在自动化与 Agent 页 (issue #22)
- 「项目内模板推荐」= 模板目录 → 独立模板分组, 项目内只留轻量引用入口 (issue #23)
- 「项目内任务通知」= 跨项目全局信息流 → 独立通知中心分组, 项目内最多未读角标 (issue #24)
- 判定法: 一个面板回答"有什么可装" → 目录组; 回答"我装了什么/跑得怎样" → 实例组; 回答"系统在告诉我什么" → 通知组。混在一页 = 违反本原则
