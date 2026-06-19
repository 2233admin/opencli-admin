# opencli-admin 项目管理

> 版本: v0.1.0
> 日期: 2026-06-19

---

## 1. GitHub Projects

### 1.1 Projects 链接

**Board**: https://github.com/users/2233admin/projects/1

### 1.2 列设计

| 列 | 状态 | 说明 |
|---|------|------|
| **Backlog** | 待处理 | 收集的想法和需求 |
| **To Do** | 规划中 | 确认要做的任务 |
| **In Progress** | 开发中 | 正在进行的任务 |
| **In Review** | 审核中 | PR 审核中 |
| **Done** | 已完成 | 已合并的任务 |

---

## 2. 任务看板

### 2.1 Phase 1: 基础设施 ⚡

| 任务 | 标签 | 优先级 | 状态 |
|------|------|--------|------|
| 创建 Monorepo 结构 (Turborepo) | `infrastructure` | 🔴 高 | ✅ Done |
| 配置 Next.js App Router | `frontend` | 🔴 高 | ✅ Done |
| 配置 Turborepo CI/CD | `infrastructure` | 🔴 高 | 🔄 In Progress |
| 添加 Docker 支持 | `infrastructure` | 🔴 高 | ✅ Done |
| 配置 ESLint + Prettier | `infrastructure` | 🟡 中 | ⬜ To Do |
| 配置 GitHub Actions | `infrastructure` | 🔴 高 | ⬜ To Do |

### 2.2 Phase 2: 前端现代化 🎨

| 任务 | 标签 | 优先级 | 状态 |
|------|------|--------|------|
| 迁移现有组件到 Next.js | `frontend` | 🔴 高 | ⬜ To Do |
| 添加 shadcn/ui 组件 | `frontend` | 🟡 中 | ⬜ To Do |
| 实现 DataTable 虚拟滚动 | `frontend` `performance` | 🟡 中 | ⬜ To Do |
| 添加 ErrorBoundary | `frontend` | 🟡 中 | ⬜ To Do |
| 实现表单验证 (Zod) | `frontend` | 🟡 中 | ⬜ To Do |
| 添加 Framer Motion 动画 | `frontend` | 🟢 低 | ⬜ To Do |

### 2.3 Phase 3: API 现代化 ⚡

| 任务 | 标签 | 优先级 | 状态 |
|------|------|--------|------|
| 创建 Hono API 骨架 | `backend` | 🔴 高 | ⬜ To Do |
| 配置 Drizzle ORM | `backend` | 🔴 高 | ⬜ To Do |
| 实现认证系统 (Better Auth) | `backend` `auth` | 🔴 高 | ⬜ To Do |
| API 限流中间件 | `backend` | 🟡 中 | ⬜ To Do |
| 添加 OpenAPI 文档 | `backend` | 🟡 中 | ⬜ To Do |
| 实现 WebSocket 实时 | `backend` | 🟡 中 | ⬜ To Do |

### 2.4 Phase 4: 可观测性 🔍

| 任务 | 标签 | 优先级 | 状态 |
|------|------|--------|------|
| 添加 Pino 日志 | `observability` | 🟡 中 | ⬜ To Do |
| 集成 OpenTelemetry | `observability` | 🟡 中 | ⬜ To Do |
| 添加 Prometheus 指标 | `observability` | 🟡 中 | ⬜ To Do |
| E2E 测试 (Playwright) | `testing` | 🟡 中 | ⬜ To Do |
| 单元测试覆盖率 >80% | `testing` | 🟡 中 | ⬜ To Do |

### 2.5 Phase 5: 文档和发布 📝

| 任务 | 标签 | 优先级 | 状态 |
|------|------|--------|------|
| 完善 README | `documentation` | 🔴 高 | ⬜ To Do |
| 添加 CONTRIBUTING.md | `documentation` | 🔴 高 | ⬜ To Do |
| 创建 API 文档 | `documentation` | 🟡 中 | ⬜ To Do |
| 部署指南 | `documentation` | 🟡 中 | ⬜ To Do |
| 发布 v0.1.0 | `release` | 🔴 高 | ⬜ To Do |
| 设置 CHANGELOG 自动生成 | `infrastructure` | 🟢 低 | ⬜ To Do |

---

## 3. Issue 模板

### 3.1 功能请求

```markdown
---
name: 🚀 Feature Request
about: 提出新功能建议
title: "[Feature] "
labels: enhancement
assignees: ''
---

## 描述
清晰描述你想要的功能。

## 动机
为什么需要这个功能？

## 建议的解决方案
你有什么想法？

## 其他
其他补充信息。
```

### 3.2 Bug 报告

```markdown
---
name: 🐛 Bug Report
about: 报告 bug
title: "[Bug] "
labels: bug
assignees: ''
---

## 描述
简明描述问题。

## 复现步骤
1. Go to '...'
2. Click on '...'
3. See error

## 预期行为
应该发生什么？

## 实际行为
实际发生了什么？

## 环境
- OS:
- Version:
```

### 3.3 任务

```markdown
---
name: 📋 Task
about: 普通任务
title: "[Task] "
labels: task
assignees: ''
---

## 任务描述
清晰描述任务。

## 验收标准
- [ ] 标准 1
- [ ] 标准 2

## 相关资源
链接到设计稿、文档等。
```

---

## 4. 里程碑

### v0.1.0 - MVP (1周)
- [x] Monorepo 结构
- [x] Next.js 骨架
- [x] Docker 支持
- [ ] Turborepo CI/CD
- [ ] GitHub Actions
- [ ] README

### v0.2.0 - 前端现代化 (2周)
- [ ] 组件迁移
- [ ] shadcn/ui
- [ ] 虚拟列表
- [ ] 表单验证

### v0.3.0 - API 现代化 (2周)
- [ ] Hono API
- [ ] Drizzle ORM
- [ ] 认证系统

### v1.0.0 - 正式发布 (3周)
- [ ] 可观测性
- [ ] 测试覆盖
- [ ] 完整文档
- [ ] 开源发布

---

## 5. 标签定义

### 类型
| 标签 | 颜色 | 说明 |
|------|------|------|
| `enhancement` | 🟢 绿色 | 新功能 |
| `bug` | 🔴 红色 | Bug 修复 |
| `documentation` | 🔵 蓝色 | 文档 |
| `infrastructure` | 🟠 橙色 | 基础设施 |
| `frontend` | 🟣 紫色 | 前端 |
| `backend` | 🟡 黄色 | 后端 |

### 优先级
| 标签 | 颜色 | 说明 |
|------|------|------|
| `priority:high` | 🔴 红色 | 高优先级 |
| `priority:medium` | 🟡 黄色 | 中优先级 |
| `priority:low` | 🟢 绿色 | 低优先级 |

### 状态
| 标签 | 颜色 | 说明 |
|------|------|------|
| `blocked` | ⚫ 黑色 | 被阻塞 |
| `help wanted` | 💬 蓝色 | 需要帮助 |
| `good first issue` | 🌟 绿色 | 适合新手 |

---

## 6. 工作流

### 6.1 开发流程

```
1. 创建 Issue / Task
   ↓
2. 分配到 Backlog
   ↓
3. 移动到 To Do (确认要做)
   ↓
4. 创建 Branch (feature/xxx)
   ↓
5. 开发 (移动到 In Progress)
   ↓
6. 提交 PR (移动到 In Review)
   ↓
7. Code Review
   ↓
8. 合并到 main (移动到 Done)
```

### 6.2 Branch 命名

```
feature/add-auth           # 新功能
fix/data-table-scroll      # Bug 修复
refactor/api-client        # 重构
docs/api-reference        # 文档
chore/update-deps         # 依赖更新
```

### 6.3 Commit 规范

```
feat(auth): add JWT authentication
fix(api): handle timeout error
docs(readme): update installation steps
refactor(dashboard): simplify state management
test(records): add pagination tests
chore(deps): upgrade react to 19
```

---

## 7. GitHub Actions CI/CD

### 7.1 工作流

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build
```

### 7.2 发布工作流

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - uses: goreleaser/goreleaser-action@v5
```

---

## 8. 团队协作

### 8.1 维护者

| 角色 | GitHub | 职责 |
|------|--------|------|
| Owner | @2233admin | 项目负责人 |

### 8.2 贡献者

欢迎提交 PR！请参考 [CONTRIBUTING.md](./CONTRIBUTING.md)

### 8.3 响应时间

| 类型 | SLA |
|------|-----|
| Issue 回复 | 48h |
| PR Review | 24h |
| Bug 修复 | 1周 |
| 功能请求 | 讨论后决定 |
