# OpenCLI Admin 前端视觉改版（立项）

> **状态：立项**（2026-06-18）  
> **优先级**：P2 — 功能稳定后再做，不阻塞 NAS 部署与采集链路  
> **仓库**：本地 fork `opencli-admin`（当前 `origin` 仍指向上游 `xjh1994/opencli-admin`，改版分支建议在自有 remote 上开）

## 背景

完整版已在 NAS 跑通（`8030` / `8031`），数据库已从精简版迁入。  
当前前端**能用但观感差**：默认 Tailwind 蓝灰后台、shadcn token 未贯通、页面样式两套混写、看板/stat 卡偏「内部运维面板」气质。

我们已 fork，具备长期维护自己的 UI 的前提；**本期只立项，不实施**。

## 设计方向（已锁定）

**参考**：Linear（结构与交互克制）+ SpaceX（任务控制台气质）+ Grok（深色、干净、偏未来感）。

一句话：**深色为主的任务控制台 — 信息密度高、装饰极少、强调色只出现在「可点击 / 当前态」。**

### 气质对照

| 来源 | 吸收什么 | 明确不要什么 |
|------|----------|--------------|
| **Linear** | 侧栏层级清晰、紧凑间距、细边框分层、单一强调色用于 active/focus | 大面积紫渐变、过度圆角糖果风 |
| **SpaceX** | 黑白灰主调、数字/状态像遥测读数、表格像任务清单 | 工业风过度粗犷、纯黑刺眼无层次 |
| **Grok** | 默认深色、面板干净、正文清晰、少量高光 | 花哨动效、拟物、彩虹 KPI 卡 |

### 默认主题

- **默认暗色**（首次访问 / 无 localStorage 时）；亮色作为可选，不是主设计稿。
- 背景分层（示意，落地进 CSS token）：
  - `canvas` `#09090b`（近 Grok 底）
  - `surface` `#111113`
  - `elevated` `#18181b`
  - `border` `rgba(255,255,255,0.08)`（Linear 式 hairline）
- **强调色**：冷紫 `hsl(252 56% 58%)` — 仅 nav active、primary button、focus ring、图表主线；**禁止** stat 卡底部 `bg-blue-500` 一类色块。

### 字体

| 用途 | 字体 |
|------|------|
| UI | **Inter**（或 Geist Sans 二选一，全站统一） |
| 遥测/ID | **JetBrains Mono** — `task_id`、时间戳、端点 URL、日志片段 |

字号偏小一档（`text-sm` 为正文默认），行高略紧，对齐 Linear 密度。

### 组件规则

- **侧栏**：窄、图标 + 文案；active = 左侧 2px 强调条 + 微亮背景，不用整块 `bg-blue-600`。
- **页头**：标题 `text-xl font-semibold tracking-tight`；描述 `text-muted` 一行即可。
- **卡片**：`border` + 微透明底，**不用** `shadow-lg`；stat 数字大号单色，图标灰阶。
- **表格**：斑马纹可选但极淡；hover 一行高亮；表头 `text-xs uppercase tracking-wider text-muted`。
- **图表**：网格线 `#ffffff10`；系列色 ≤2（主线强调紫 + 次要灰）；去掉 Recharts 默认Legend 大块色。
- **品牌区**：字标 `OpenCLI` + 小写 `Admin` 或几何 monogram；**去掉** ⚡ emoji。

### 反模式清单（改版时对照删）

- [ ] Tailwind 默认 `blue-600` 当主色铺满
- [ ] 彩虹 stat 图标底（蓝/紫/绿/红各一块）
- [ ] 页面级手写 `inputCls` 与 shadcn `Input` 并存
- [ ] 面包屑/导航中文硬编码与 i18n 两套文案

## 目标

1. **统一设计语言**：shadcn CSS 变量 ↔ `tailwind.config` ↔ 组件，消灭页面级 `bg-blue-600` / 手写 `inputCls` 混用。
2. **提升产品感**：侧栏、字体、间距、表格/空状态、图表配色 — 一眼不像脚手架 demo。
3. **保持功能等价**：不改 API 契约、不删路由；i18n（中/英）继续可用。
4. **可部署到 NAS**：`frontend` 自建镜像替换 `xjh1994/opencli-admin-frontend:0.3.6`。

## 非目标（本期不做）

- 不重写业务逻辑 / 不拆 `SourcesPage` 800 行（可放到 Phase 2+）
- 不追求与上游 PR 合并（fork 自用为主；可选 cherry-pick 上游功能）
- 不做移动端专用适配（响应式修好即可）
- 不引入新框架（继续 Vite + React 18 + Tailwind 3 + 现有 shadcn 组件）

## 现状摘要（改版前基线）

| 项 | 现状 |
|----|------|
| 组件库 | shadcn/ui 已装，大量页面仍用原生 class |
| 主题 | `index.css` 有 token，`tailwind.config.js` 未接 `hsl(var(--primary))` |
| 布局 | `Layout.tsx` 侧栏 `gray-900` + emoji logo；面包屑中文硬编码 |
| 看板 | 彩虹 stat 图标底 + Recharts 默认色 |
| 暗色模式 | `useEffect` 仅 mount 同步，存在刷新后主题不一致风险 |
| 部署 | 官方 frontend 镜像；本地 `npm run build` 已通过 |

## 成功标准（验收）

- [ ] 全站主色/圆角/边框/ focus 环来自同一套 token
- [ ] 侧栏 + 页头有明确品牌区（非 emoji 占位）
- [ ] 视觉符合上文「设计方向」；看板 stat/图表 ≤2 强调色
- [ ] 默认暗色；遥测字段使用等宽字体
- [ ] 暗色模式切换后刷新仍正确
- [ ] `npm run build` 无报错；NAS 上自建镜像 UI 200、核心流程可点通（数据源列表、任务、节点）
- [ ] 截图对比：改版前后各 1 张存档于 `docs/ui-reskin/`

## 分期计划

### Phase 0 — 准备（0.5d，开工时做）

- [ ] 确认 fork remote（Gitea/GitHub）与默认分支策略
- [ ] 建分支 `feat/ui-reskin`
- [ ] 抓基线截图：`dashboard` / `sources` / `nodes` 亮暗各一套
- [x] 选定参考方向：**Linear + SpaceX + Grok**（见「设计方向」）
- [ ] 在 `frontend/index.html` 引入 Inter + JetBrains Mono（或 npm `@fontsource`）
- [ ] 起草 token 草稿：`frontend/src/index.css` + `tailwind.config.js` 对照表

### Phase 1 — 设计系统落地（1–2d）

- [ ] `tailwind.config.js` 接入 shadcn 语义色 + `fontFamily`
- [ ] `Layout.tsx`：侧栏、nav 激活态、底栏控件改用 `Button` / token
- [ ] 修复暗色模式持久化逻辑
- [ ] 面包屑走 i18n，去掉 `ROUTE_LABELS` 硬编码

### Phase 2 — 高频页面抛光（2–3d）

- [ ] `DashboardPage`：stat 卡、图表主题、表格样式
- [ ] `SourcesPage` / `TasksPage`：表单与列表统一组件
- [ ] `EmptyState` / `PageHeader` / `DataTable` 统一间距 rhythm

### Phase 3 — 部署与文档（0.5d）

- [ ] `frontend/Dockerfile` 本地 build tag，例如 `opencli-admin-frontend:curry-ui`
- [ ] NAS `docker-compose` 改镜像名；保留官方 tag 可回滚
- [ ] 本文件状态改为 **已完成** 或拆 `CHANGELOG` 条目

## 风险与约束

- **上游合并**：UI 大 diff 难 upstream；功能修复尽量独立 commit，UI 单独分支。
- **NAS**：Compose v2.20.1，继续避免 `env_file: path/required` 新语法。
- **范围蔓延**：Phase 1 只做「看起来像一套产品」；巨型页面重构单列 backlog。

## Backlog（改版后可选）

- 拆分 `SourcesPage.tsx` 为 wizard + 列表子模块
- 导航分组（采集 / 运行 / 系统）
- 上游有 UI 更新时 diff 合并策略

## 相关路径

- 前端源码：`frontend/src/`
- NAS 完整版：`/volume1/docker/opencli-admin/`
- 本地 env 模板：`~/.omc/opencli-admin-nas.env`

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-06-18 | 立项，NAS 完整版已上线，UI 改版推迟 |
| 2026-06-18 | 设计方向锁定：Linear + SpaceX + Grok，默认暗色任务控制台 |