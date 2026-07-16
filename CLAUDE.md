# opencli-admin

## 前端样式 — 必读

改 `frontend/src` 下任何 UI 前, 先读 [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)（锁定版设计系统, 顶部有 30 秒速查表）。

硬规则速记:
- 背景只用 `bg-ops-black/panel/raised` 三级, 禁手写近黑 hex
- 灰阶只用 zinc; 交互色只用 primary; 状态色 emerald/amber/red/sky/violet
- 字号禁 `text-[Npx]` 任意值, 用 `text-2xs`(11px)/`text-3xs`(10px)
- 圆角: 控件 `rounded-xs`, 面板 `rounded-md`; 阴影用 `shadow-panel/overlay/drag`
- 缺 ui 原语用 `npx shadcn@latest add <x>` 拉, 禁手搓

## Agent skills

### Issue tracker

规格与任务发布到公开仓库 `2233admin/opencli-admin` 的 GitHub Issues；所有 `gh` 写操作必须显式指定该仓库。See `docs/agents/issue-tracker.md`.

### Triage labels

使用默认五阶段标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

采用 single-context：根目录 `CONTEXT.md` 是领域词汇表，`docs/adr/` 保存架构决策。See `docs/agents/domain.md`.
