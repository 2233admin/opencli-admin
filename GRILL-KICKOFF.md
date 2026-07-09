# Grill Kickoff — opencli-admin 收口定调

> 用法:新 session,cwd=`D:\projects\opencli-admin`,跑 `/grill-with-docs`,把本文件当输入喂进去。
> 目的:对齐收口目标 → 裁剪残留清单 → 出 CONTEXT.md/ADR 收口宪法。收口 = 裁剪,不是做完。

## 现成输入(盘问前先读)

- `AUDIT-cybernetic-remediation.md` — 控制论审核残留账
- `docs/CONTROL_THEORY_ARCHITECTURE.md` — 控制回路架构
- Memory: `opencli-admin-cybernetic-audit`(Control-4 硬规格:recovery rate 阈值 per-state gate automatic mode)、`opencli-admin-channel-runner-refactor`(留白清单)

## 已定事实(不许在盘问里重新翻案)

- PR-Control-3(advisory 决策引擎)+ 3.5(证据台账 `control_actions` + outcome 判定 + recovery 报表)已推 fork = 4f3b2fe
- 控制回路语义已定:Advisory-Gated Automatic Execution;recovery 阈值 per-state 门禁 automatic
- PR#4(薄渠道+厚 runner)已合 main = f731897
- 回测/画布等其他摊子与本收口无关

## 盘问必须逼出答案的问题

1. **收口线定义**:Control-4 actuator 落地算完?还是 advisory 攒证据阶段就封版?证据要攒几天(天然分界)?
2. **残留裁剪**(每项:进收口 / 弃权写 ADR):
   - crawl4ai call-time SSRF
   - per-source objective 存储
   - odp-store 心跳 producer(Rust)
   - error_kinds histogram
   - trend fallback
   - 前端 3 处遗留 / CLI ctrl+c / opencli_channel 路由(channel-runner 留白)
3. **悬而未决**:
   - 部署面:纯本机 vs LAN(→鉴权 P1/P2)
   - gitea push 凭证
   - topology ODP 节点
4. **每项验收标准**:测试断言级,不是"做了"。

## 收口后流程(同一窗,不 compact 不断窗)

grill → `/to-prd` → `/to-issues`。多 session build(Control-4 单 PR 都嫌大)。

## Issue 模板硬规则(写死进每个 issue,喂 Sonnet 5 子 agent)

- 契约 pin 死:endpoint schema、复用 `control_actions` 表(mode=automatic / executed=True)、零变异测试:原断言不许动
- HARD RULE:禁 Agent 工具、禁 commit(主模型验收后统一 commit)
- 验收闸门写进 issue:全量 pytest + cov≥80 + alembic 单 head
- 复用现成机制,不手搓(memory: feedback-reuse-wheels)

## 不走的岔路

- `/triage` 不用(issue 全自产)
- `/prototype` 不用(控制回路语义已定,没有跑起来才能答的问题)
