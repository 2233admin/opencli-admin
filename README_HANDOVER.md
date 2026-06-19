# opencli-admin 接盘侠指南

> 给任何接手这个项目的 AI 或开发者的完整指引
> 最后更新: 2026-06-19

---

## 🚀 快速开始

### 5 分钟了解项目

```bash
# 1. 克隆项目
git clone https://github.com/2233admin/opencli-admin.git
cd opencli-admin

# 2. 查看项目结构
cat .claude-project.md    # 项目配置
cat PONYTAIL.md           # 开发规范摘要
ls -la apps/ packages/ docs/

# 3. 启动开发环境
docker compose --profile nas up -d
```

### 30 分钟上手开发

```bash
# 1. 查看文档
cat docs/ARCHITECTURE.md    # 架构设计
cat docs/SURVEY_superset.md # 技术选型

# 2. 查看任务看板
cat docs/PROJECT_MANAGEMENT.md

# 3. 启动前端开发
cd apps/web && npm run dev

# 4. 启动后端开发
cd backend && ./start.sh
```

---

## 📋 项目状态

### 已完成 ✅

| 模块 | 状态 | 说明 |
|------|------|------|
| Monorepo 结构 | ✅ | Turborepo 配置 |
| Next.js 骨架 | ✅ | App Router |
| Docker 支持 | ✅ | 多阶段构建 |
| 架构文档 | ✅ | ARCHITECTURE.md v0.2.0 |
| 调研文档 | ✅ | SURVEY_superset.md |
| 开发规范 | ✅ | PONYTAIL.md |
| 项目管理 | ✅ | PROJECT_MANAGEMENT.md |
| CI/CD | ✅ | GitHub Actions |
| Issue 模板 | ✅ | Bug/Feature |

### 进行中 🔄

| 模块 | 状态 | 说明 |
|------|------|------|
| Turborepo CI/CD | 🔄 | 需要完善 |
| ESLint/Prettier | 🔄 | 待配置 |

### 待开发 ⬜

| 模块 | 优先级 | 说明 |
|------|--------|------|
| 组件迁移 | 🔴 高 | Vite SPA → Next.js |
| Hono API | 🔴 高 | FastAPI → Hono |
| 认证系统 | 🔴 高 | Better Auth |
| Drizzle ORM | 🟡 中 | SQLAlchemy → Drizzle |
| API 文档 | 🟡 中 | OpenAPI |
| 单元测试 | 🟡 中 | 覆盖率 >80% |
| E2E 测试 | 🟢 低 | Playwright |

---

## 🏗️ 技术栈

### 当前技术栈

```
opencli-admin/
├── frontend/           # React 18 + Vite + Tailwind (现有)
├── backend/            # FastAPI + SQLAlchemy (现有)
├── iii/               # Python 调度控制面 (我们有)
├── odp-rs/            # Rust 数据面 (我们有)
└── docker-compose.yml  # Docker 部署
```

### 目标技术栈

```
opencli-admin/
├── apps/
│   ├── web/           # Next.js 15 + React 19 (新)
│   └── api/            # Hono (新)
├── packages/
│   ├── shared/        # 共享类型 (新)
│   └── db/             # Drizzle ORM (新)
├── frontend/           # React 18 (待迁移)
├── backend/            # FastAPI (待迁移)
├── iii/               # Python 调度 (保留)
└── odp-rs/            # Rust 数据面 (保留)
```

### 技术选型参考

详见 `docs/SURVEY_superset.md` 的 Better-Fullstack 对比分析。

---

## 📁 目录结构

```
opencli-admin/
├── apps/
│   └── web/                    # 🆕 Next.js App Router
│       ├── src/
│       │   ├── app/          # App Router
│       │   ├── components/     # 组件
│       │   └── lib/          # 工具
│       ├── Dockerfile
│       └── package.json
├── packages/
│   └── shared/                # 🆕 共享类型
│       ├── src/
│       └── package.json
├── frontend/                     # 现有 Vite SPA
│   └── src/
├── backend/                     # 现有 FastAPI
│   ├── api/v1/               # API 路由
│   ├── channels/              # 采集渠道
│   ├── pipeline/              # 采集流水线
│   ├── processors/            # AI 处理器
│   └── models/               # 数据库模型
├── iii/                       # 🆕 III 调度控制面
│   ├── config.yaml           # III 配置
│   ├── lib/                  # 共享库
│   ├── schedules/             # 定时配置
│   ├── workers/              # Worker
│   └── scripts/              # 运维脚本
├── odp-rs/                    # 🆕 Rust 数据面
│   ├── crates/
│   │   ├── odp-ingest/     # 摄入服务
│   │   ├── odp-store/       # 存储服务
│   │   └── odp-bus/         # Redis Streams
│   └── Cargo.toml
├── contracts/                    # 🆕 数据契约
│   └── record_v2.schema.json
├── docs/                       # 文档
│   ├── ARCHITECTURE.md       # 架构文档
│   ├── SURVEY_superset.md     # 调研报告
│   ├── PROJECT_MANAGEMENT.md  # 项目管理
│   └── DEVELOPMENT_STANDARD.md # 开发规范
├── .github/
│   ├── workflows/ci.yml      # CI/CD
│   └── ISSUE_TEMPLATE/       # Issue 模板
├── docker-compose.yml         # Docker 配置
├── turbo.json                # Turborepo 配置
├── package.json              # Workspace root
└── PONYTAIL.md              # 开发规范摘要
```

---

## 🔧 开发环境

### 前置要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥20 | 前端开发 |
| Python | ≥3.11 | 后端开发 |
| Docker | Latest | 容器化 |
| Rust | Latest | odp-rs |
| Git | Latest | 版本控制 |

### 本地开发

```bash
# 后端 (FastAPI)
cd backend
pip install -e ".[dev]"
uvicorn backend.main:app --reload

# 前端 (Next.js)
cd apps/web
npm install
npm run dev

# 或者用 Docker
docker compose --profile nas up -d
```

### 开发端口

| 服务 | 端口 | URL |
|------|------|-----|
| Next.js | 3000 | http://localhost:3000 |
| FastAPI | 8000 | http://localhost:8000 |
| FastAPI Docs | 8000 | http://localhost:8000/docs |
| III Engine | 49134 | ws://localhost:49134 |
| PostgreSQL | 5432 | localhost:5432 |
| Redis | 6379 | localhost:6379 |
| odp-ingest | 8040 | http://localhost:8040 |

---

## 📜 开发规范

### Ponytail 法则

在写代码之前，停在第一层满足的地方：

```
1. 这个需要存在吗？     → 否：跳过
2. 标准库能做吗？       → 用它
3. 平台原生特性？       → 用它
4. 已安装的依赖？       → 用它
5. 一行能搞定吗？       → 一行
6. 最后才写：最小可用的代码
```

详见 `PONYTAIL.md`

### 文件限制

- 单文件不超过 200 行
- 超过 200 行才拆分
- 目录结构扁平化

### Commit 规范

```
feat(sources): add validation
fix(api): handle timeout
chore: update deps
```

---

## 🚢 部署

### 开发环境

```bash
docker compose --profile nas up -d
```

### 生产环境 (NAS)

```bash
docker compose --profile nas --profile nextjs up -d
```

### 独立部署前端

```bash
cd apps/web
docker build -t opencli-admin-web .
docker run -p 3000:3000 opencli-admin-web
```

---

## 🔍 调试

### 查看日志

```bash
# Docker logs
docker compose logs -f api
docker compose logs -f web
docker compose logs -f postgres

# III logs
docker compose logs -f iii-engine
```

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| 端口占用 | `docker compose down` 后重试 |
| 数据库迁移 | `alembic upgrade head` |
| 依赖安装失败 | `pip install --no-cache-dir` |
| Node 版本不对 | 使用 `nvm use` 或 `nvm use 20` |

---

## 📚 文档索引

| 文档 | 内容 |
|------|------|
| `ARCHITECTURE.md` | 系统架构、组件设计、数据流 |
| `SURVEY_superset.md` | 与原版对比、技术选型 |
| `PROJECT_MANAGEMENT.md` | 任务看板、里程碑、CI/CD |
| `DEVELOPMENT_STANDARD.md` | 详细开发规范 |
| `PONYTAIL.md` | 开发规范摘要 |
| `docker-compose.yml` | 部署配置 |

---

## 🤝 贡献指南

### 分支命名

```
feature/add-auth           # 新功能
fix/data-table-scroll      # Bug 修复
refactor/api-client        # 重构
docs/api-reference        # 文档
chore/update-deps         # 依赖更新
```

### PR 流程

1. Fork 项目
2. 创建分支 `git checkout -b feature/xxx`
3. 开发并测试
4. 提交 PR
5. Code Review
6. 合并到 main

### Issue 模板

使用 `.github/ISSUE_TEMPLATE/` 中的模板提交 Issue。

---

## 📞 联系方式

- **GitHub Issues**: https://github.com/2233admin/opencli-admin/issues
- **GitHub Discussions**: https://github.com/2233admin/opencli-admin/discussions

---

*遵循 Ponytail 法则：写必要的代码，不写多余的代码。*
