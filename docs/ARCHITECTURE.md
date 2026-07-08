# opencli-admin 架构文档

> 版本: 0.2.0
> 日期: 2026-06-19
> 状态: 进行中
> 基于: api-design patterns + frontend-patterns

---

## 当前实现基线（v0.4 前）

- 生产前端主线是 `frontend/`：React + Vite + nginx Dockerfile。
- `experiments/next-web/` 是 Next.js 实验壳，不参与默认 Docker、CI 或导航。
- 默认 `docker-compose.yml` 会从 `./frontend` 构建前端镜像。
- 本文后续关于 Next.js/Hono/Turborepo 的章节属于历史目标架构或迁移设想，不能覆盖当前实现事实。

## 1. 概述

### 1.1 项目定位

opencli-admin 是一个现代化的多渠道数据采集管理系统，支持 AI 智能体处理、分布式节点调度和实时通知推送。

### 1.2 核心能力

- 多渠道数据采集 (opencli / RSS / API / Web 爬虫 / CLI)
- 定时计划调度 (Cron)
- AI 智能体处理 (Claude / OpenAI / DeepSeek 等)
- 分布式边缘节点管理
- 通知推送 (Webhook / 飞书 / 钉钉 / 企微 / Email)

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| **模块化** | 每个功能独立部署，按需启停 |
| **类型安全** | 前后端共享类型定义 |
| **可观测性** | 结构化日志、链路追踪、指标监控 |
| **容错性** | 重试、降级、超时处理 |
| **可扩展性** | 边缘节点按需扩缩 |

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           用户层                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│   │  Web 管理界面   │    │  Tauri 桌面端   │    │    CLI 工具     │  │
│   │  (Next.js)     │    │   (Rust+Web)    │    │   (Rust)       │  │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘  │
│            │                      │                      │              │
│            └──────────────────────┼──────────────────────┘              │
│                                   │                                       │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │ HTTPS/WSS
┌───────────────────────────────────┼─────────────────────────────────────┐
│                           边缘计算层                                     │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                     API 网关层 (Hono)                            │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │  │
│   │  │  Auth    │  │  CRUD    │  │  实时    │  │  Webhook │       │  │
│   │  │  中间件   │  │  操作    │  │  SSE/WS  │  │  回调    │       │  │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│   ┌────────────────────────────────┼────────────────────────────────┐  │
│   │                        控制面 (Python)                         │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
│   │  │   III    │  │ Scheduler │  │  AI      │  │ Notifier │   │  │
│   │  │  调度    │  │  定时器   │  │ Processors│  │  推送    │   │  │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│   ┌────────────────────────────────┼────────────────────────────────┐  │
│   │                        数据面 (Rust)                            │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
│   │  │ odp-     │  │  Dedup   │  │ odp-     │  │  Redis  │   │  │
│   │  │ ingest   │  │  去重     │  │ store    │  │  Streams│   │  │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────┐
│                           存储层                                          │
├────────────────────────────────────┼────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │
│   │   PostgreSQL     │    │     Redis      │    │    DuckDB      │   │
│   │  (关系数据)     │    │  (缓存/队列)   │    │   (冷存储)     │   │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘   │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                        文件存储                                   │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │  │
│   │  │ Chrome   │  │  采集    │  │  AI      │  │  备份    │     │  │
│   │  │ Profiles │  │  缓存    │  │  模型    │  │  文件    │     │  │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────┐
│                           采集节点层                                     │
├────────────────────────────────────┼────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │
│   │   NAS 节点      │    │   PC 边缘       │    │   云服务器      │   │
│   │  (主控节点)     │    │  (Discord)      │    │  (高并发)       │   │
│   │                 │    │                 │    │                 │   │
│   │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │   │
│   │ │ opencli    │ │    │ │ Discord CLI│ │    │ │ opencli    │ │   │
│   │ │ + Chrome   │ │    │ │ + opencli  │ │    │ │ + Chrome   │ │   │
│   │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │   │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           采集流程                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 触发源                                                               │
│     ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│     │  定时    │  │  手动    │  │  Webhook │  │  API     │           │
│     │  Cron    │  │  触发    │  │  回调    │  │  调用    │           │
│     └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│          │              │              │              │                 │
│          └──────────────┴──────────────┴──────────────┘               │
│                                │                                        │
│                                ▼                                        │
│  2. 任务调度 (III)                                                   │
│     ┌─────────────────────────────────────────────────────────────┐   │
│     │  - 解析 cron 表达式                                           │   │
│     │  - 节点路由 (按站点/优先级/空闲度)                          │   │
│     │  - 任务分发 (WS / HTTP)                                      │   │
│     └─────────────────────────────────────────────────────────────┘   │
│                                │                                        │
│                                ▼                                        │
│  3. 节点执行 (odp-rs)                                               │
│     ┌────────────┐    ┌────────────┐    ┌────────────┐                │
│     │  opencli  │───▶│  Bridge/   │───▶│  目标平台  │                │
│     │  CLI      │    │  CDP       │    │  (抓取)   │                │
│     └────────────┘    └────────────┘    └────────────┘                │
│                                │                                        │
│                                ▼                                        │
│  4. 数据归一化                                                         │
│     ┌─────────────────────────────────────────────────────────────┐   │
│     │  - 字段映射 (title/url/content/author/published_at)         │   │
│     │  - 数据清洗 (HTML 解析/敏感词过滤)                         │   │
│     │  - SHA-256 内容哈希 (去重)                                 │   │
│     └─────────────────────────────────────────────────────────────┘   │
│                                │                                        │
│                                ▼                                        │
│  5. 存储写入                                                         │
│     ┌────────────┐    ┌────────────┐    ┌────────────┐                │
│     │  Redis    │───▶│  PostgreSQL │───▶│  DuckDB    │                │
│     │  (实时)   │    │  (热数据)   │    │  (冷数据)   │                │
│     └────────────┘    └────────────┘    └────────────┘                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 组件架构

### 3.1 API 网关层 (Hono)

```
apps/api/
├── src/
│   ├── index.ts                 # 入口
│   ├── routes/
│   │   ├── auth.ts             # 认证
│   │   ├── sources.ts          # 数据源
│   │   ├── schedules.ts         # 定时计划
│   │   ├── records.ts          # 采集记录
│   │   ├── nodes.ts            # 节点管理
│   │   ├── notifications.ts     # 通知
│   │   └── webhooks.ts         # Webhook
│   ├── middleware/
│   │   ├── auth.ts            # JWT 验证
│   │   ├── cors.ts            # CORS
│   │   ├── rate-limit.ts      # 限流
│   │   └── logger.ts          # 请求日志
│   ├── services/                # 业务逻辑
│   └── types/                  # 类型定义
```

**职责**:
- HTTP 请求处理
- 请求验证 (Zod)
- 认证授权
- 限流熔断
- 请求日志

### 3.2 控制面 (Python/III)

```
iii/
├── config.yaml                  # III 引擎配置
├── lib/                        # 共享库
│   ├── odp_record.py          # ODP 数据格式
│   ├── discord_cli.py          # Discord CLI 封装
│   ├── opencli_cli.py         # opencli CLI 封装
│   └── schedules.py            # 计划管理
├── schedules/                   # 定时配置
│   ├── discord.yaml            # Discord 采集计划
│   └── opencli.yaml           # opencli 采集计划
├── workers/                     # III Worker
│   ├── odp-ingest-bridge/    # ODP 摄入桥接
│   ├── collector-discord/      # Discord 采集器
│   ├── collector-opencli/      # opencli 采集器
│   └── schedule-bootstrap/     # 计划引导
└── scripts/                    # 运维脚本
    ├── start-local.ps1        # 本地启动
    ├── deploy-nas.sh          # NAS 部署
    └── restart-workers.ps1     # 重启 Worker
```

**职责**:
- 定时任务调度
- 任务分发路由
- 节点健康检查
- 失败重试

### 3.3 数据面 (Rust)

```
odp-rs/
├── crates/
│   ├── odp-bus/              # Redis Streams 总线
│   │   ├── lib.rs
│   │   └── redis_streams.rs
│   ├── odp-contracts/        # 数据契约
│   │   └── src/lib.rs        # ODP Record v2
│   ├── odp-ingest/           # 摄入服务
│   │   ├── src/
│   │   │   ├── main.rs       # 入口
│   │   │   ├── handlers.rs   # HTTP 处理
│   │   │   ├── dedup.rs     # 去重
│   │   │   └── state.rs     # 状态管理
│   │   └── Cargo.toml
│   ├── odp-store/            # 存储服务
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   └── writer.rs    # PostgreSQL 写入
│   │   └── Cargo.toml
│   └── odp-egress/          # 导出服务 (待实现)
│       └── src/lib.rs
├── Dockerfile.ingest
├── Dockerfile.store
└── Cargo.toml
```

**职责**:
- 高并发数据摄入
- 幂等去重
- PostgreSQL 写入
- Redis Streams 缓冲

### 3.4 前端实验壳 (Next.js, 非生产主线)

```
experiments/next-web/
├── src/
│   ├── app/                   # App Router
│   │   ├── (auth)/           # 认证路由组
│   │   │   ├── login/
│   │   │   └── register/
│   │   ├── (dashboard)/      # Dashboard 路由组
│   │   │   ├── layout.tsx    # 侧边栏布局
│   │   │   ├── page.tsx      # 首页
│   │   │   ├── sources/      # 数据源
│   │   │   ├── schedules/    # 定时计划
│   │   │   ├── records/      # 采集记录
│   │   │   ├── nodes/        # 节点管理
│   │   │   ├── settings/     # 设置
│   │   │   └── providers/    # AI 提供商
│   │   └── api/             # API Routes (可选)
│   ├── components/
│   │   ├── ui/              # shadcn/ui 组件
│   │   └── features/         # 业务组件
│   │       ├── sources/
│   │       ├── schedules/
│   │       ├── records/
│   │       └── nodes/
│   ├── hooks/                # 自定义 Hooks
│   ├── lib/                 # 工具库
│   │   ├── api.ts           # API 客户端
│   │   └── utils.ts         # 工具函数
│   └── types/               # 前端类型
└── public/                   # 静态资源
```

---

## 4. 数据模型

### 4.1 ODP Record v2

```typescript
// contracts/record_v2.schema.json
interface ODPRecord {
  schema_version: 1;
  provider: string;           // e.g., "opencli/bilibili"
  source_id: string;         // UUID5 from channel_id
  event_id: string;           // Stable id for idempotency
  ingest_mode: "snapshot" | "stream";
  source_ts: string;         // ISO 8601
  cursor?: string;            // Pagination cursor
  payload: {
    title?: string;
    url?: string;
    content?: string;
    author?: string;
    published_at?: string;
    [key: string]: unknown;  // Provider-specific fields
  };
  raw_data?: object;          // Original data
  trace_id?: string;         // For distributed tracing
  task_id?: string;          // Collection task reference
}
```

### 4.2 数据库 Schema (Drizzle)

```typescript
// packages/db/src/schema.ts
import { pgTable, uuid, text, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(),  // opencli, rss, api, web, cli
  config: jsonb('config').notNull(),
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id),
  cron: text('cron').notNull(),
  timezone: text('timezone').default('Asia/Shanghai'),
  enabled: boolean('enabled').default(true),
  nodeId: uuid('node_id').references(() => nodes.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const records = pgTable('records', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id),
  taskId: uuid('task_id').references(() => tasks.id),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),  // For dedup
  title: text('title'),
  url: text('url'),
  content: text('content'),
  author: text('author'),
  rawData: jsonb('raw_data'),
  aiSummary: text('ai_summary'),
  aiTags: text('ai_tags').array(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const nodes = pgTable('nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: text('port').notNull(),
  status: text('status').default('offline'),  // online, offline, busy
  capabilities: text('capabilities').array(),
  lastSeen: timestamp('last_seen'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id),
  scheduleId: uuid('schedule_id').references(() => schedules.id),
  nodeId: uuid('node_id').references(() => nodes.id),
  status: text('status').notNull(),  // pending, running, success, failed
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

---

## 5. API 设计

### 5.1 RESTful 端点

```
认证:
POST   /api/v1/auth/login          # 登录
POST   /api/v1/auth/register       # 注册
POST   /api/v1/auth/logout        # 登出
POST   /api/v1/auth/refresh       # 刷新 Token

数据源:
GET    /api/v1/sources             # 列表
POST   /api/v1/sources            # 创建
GET    /api/v1/sources/:id        # 详情
PUT    /api/v1/sources/:id        # 更新
DELETE /api/v1/sources/:id        # 删除
POST   /api/v1/sources/:id/test   # 测试连接

定时计划:
GET    /api/v1/schedules          # 列表
POST   /api/v1/schedules          # 创建
GET    /api/v1/schedules/:id      # 详情
PUT    /api/v1/schedules/:id      # 更新
DELETE /api/v1/schedules/:id      # 删除

采集记录:
GET    /api/v1/records             # 列表 (分页/搜索)
GET    /api/v1/records/:id         # 详情
DELETE /api/v1/records/:id        # 删除
POST   /api/v1/records/batch-delete # 批量删除

节点管理:
GET    /api/v1/nodes              # 列表
POST   /api/v1/nodes              # 注册
GET    /api/v1/nodes/:id          # 详情
DELETE /api/v1/nodes/:id         # 删除
POST   /api/v1/nodes/:id/heartbeat # 心跳

任务:
GET    /api/v1/tasks              # 列表
GET    /api/v1/tasks/:id          # 详情
POST   /api/v1/tasks/:id/cancel  # 取消

通知:
GET    /api/v1/notifications      # 列表
POST   /api/v1/notifications      # 创建
PUT    /api/v1/notifications/:id  # 更新
DELETE /api/v1/notifications/:id # 删除

Webhook:
POST   /api/v1/webhooks/:id/trigger  # 手动触发
```

### 5.2 响应格式

```typescript
// 成功响应
interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    hasMore?: boolean;
  };
}

// 错误响应
interface ApiError {
  error: {
    code: string;           // e.g., "VALIDATION_ERROR"
    message: string;
    details?: Array<{
      field: string;
      issue: string;
    }>;
  };
}
```

---

## 6. 部署架构

### 6.1 开发环境

```
┌─────────────────────────────────────────────────────────────┐
│                     开发机器 (本地)                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Next.js    │  │   Hono     │  │   III       │        │
│  │  Dev Server │  │   API      │  │   Engine   │        │
│  │  :3000      │  │   :8000    │  │   :49134   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  PostgreSQL │  │   Redis    │  │  odp-rs    │        │
│  │   :5432     │  │   :6379    │  │   :8040    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 生产环境 (NAS)

```
┌─────────────────────────────────────────────────────────────┐
│                        NAS (192.168.50.130)                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    Docker Compose                     │    │
│  │                                                       │    │
│  │  ┌─────────────┐  ┌─────────────┐                 │    │
│  │  │   Nginx     │  │   Hono     │                 │    │
│  │  │   端口 80   │  │   API      │                 │    │
│  │  └─────────────┘  └─────────────┘                 │    │
│  │         │                 │                          │    │
│  │         ▼                 ▼                          │    │
│  │  ┌─────────────────────────────────────────────┐   │    │
│  │  │           III 调度 + Workers                │   │    │
│  │  │  (schedule-bootstrap, collector-*)          │   │    │
│  │  └─────────────────────────────────────────────┘   │    │
│  │         │                                           │    │
│  │         ▼                                           │    │
│  │  ┌─────────────┐  ┌─────────────┐                 │    │
│  │  │  odp-ingest │  │  odp-store │                 │    │
│  │  └─────────────┘  └─────────────┘                 │    │
│  │         │                 │                          │    │
│  │         ▼                 ▼                          │    │
│  │  ┌─────────────┐  ┌─────────────┐                 │    │
│  │  │  PostgreSQL │  │   Redis    │                 │    │
│  │  │  + TimescaleDB              │                 │    │
│  │  └─────────────┘  └─────────────┘                 │    │
│  │                                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   opencli-agent                       │    │
│  │  ┌─────────────┐  ┌─────────────┐                 │    │
│  │  │   Chrome    │  │  opencli   │                 │    │
│  │  │   Profile   │  │  Daemon    │                 │    │
│  │  └─────────────┘  └─────────────┘                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 分布式环境

```
┌─────────────────────────────────────────────────────────────────────┐
│                           控制中心 (NAS)                              │
├─────────────────────────────────────────────────────────────────────┤
│  Hono API + III + PostgreSQL + Redis + odp-rs                       │
└─────────────────────────────────────────────────────────────────────┘
                    │                    │                    │
         WS/HTTP    │                    │                    │ WS/HTTP
                    ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   PC 边缘       │  │   云服务器      │  │   移动设备      │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ Discord CLI     │  │ opencli + Chrome│  │ (监控/查看)     │
│ opencli + Chrome│  │ (高并发采集)    │  │                │
│ (实时任务)      │  │ (公开数据)      │  │                │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 7. 安全

### 7.1 认证流程

```
┌─────────────────────────────────────────────────────────────┐
│                     认证流程                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 登录请求                                                │
│     ┌──────────┐                                            │
│     │  用户    │──▶ /api/v1/auth/login                     │
│     └──────────┘       │                                    │
│                        ▼                                    │
│  2. 验证凭证                                                │
│     ┌────────────────────────────────────────────────┐    │
│     │  - 邮箱/密码 → bcrypt 验证                       │    │
│     │  - OAuth → 第三方验证                            │    │
│     │  - API Key → 签名验证                           │    │
│     └────────────────────────────────────────────────┘    │
│                        │                                    │
│                        ▼                                    │
│  3. 生成 Token                                              │
│     ┌────────────────────────────────────────────────┐    │
│     │  - Access Token (15min, JWT)                   │    │
│     │  - Refresh Token (7d, HttpOnly Cookie)           │    │
│     └────────────────────────────────────────────────┘    │
│                        │                                    │
│                        ▼                                    │
│  4. 返回响应                                                │
│     ┌────────────────────────────────────────────────┐    │
│     │  { accessToken, expiresIn, user }             │    │
│     └────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 权限模型

| 角色 | 权限 |
|------|------|
| **Admin** | 全部权限 |
| **Operator** | 源/计划/记录 CRUD，节点查看 |
| **Viewer** | 只读访问 |

---

## 8. 监控与可观测性

### 8.1 日志层级

```typescript
// 使用 Pino 结构化日志
logger.info({
  level: "info",
  service: "opencli-api",
  requestId: "req-123",
  userId: "user-456",
  action: "source.create",
  duration: 150,
}, "Source created");

// 级别:
enum LogLevel {
  TRACE = 10,  // 调试详情
  DEBUG = 20,  // 开发调试
  INFO = 30,   // 业务事件
  WARN = 40,   // 可恢复问题
  ERROR = 50,  // 失败
}
```

### 8.2 指标

| 指标 | 类型 | 说明 |
|------|------|------|
| `http_requests_total` | Counter | HTTP 请求总数 |
| `http_request_duration_seconds` | Histogram | 请求延迟 |
| `task_queue_size` | Gauge | 任务队列大小 |
| `task_success_total` | Counter | 成功任务数 |
| `task_failed_total` | Counter | 失败任务数 |
| `node_online_count` | Gauge | 在线节点数 |
| `collection_rate` | Gauge | 采集速率 (records/s) |

### 8.3 链路追踪

```
Trace: task-abc123
├── Span: iii.schedule.tick (100ms)
│   └── Span: iii.route.select_node (10ms)
│       └── Span: node.dispatch (50ms)
│           └── Span: odp.collect (500ms)
│               ├── Span: opencli.execute (400ms)
│               └── Span: odp.ingest (100ms)
│                   └── Span: postgres.insert (50ms)
└── Span: notifier.dispatch (20ms)
```

---

## 9. 扩展阅读

- [调研报告](./SURVEY_superset.md) - 完整技术选型分析
- [API 文档](./API.md) - 详细 API 参考
- [部署指南](./DEPLOYMENT.md) - 部署配置
- [开发指南](./DEVELOPMENT.md) - 开发环境配置

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 0.2.0 | 2026-06-19 | 补充 api-design + frontend-patterns 最佳实践 |
| 0.1.0 | 2026-06-19 | 初始架构文档 |

---

## 10. API 设计增强 (api-design patterns)

### 10.1 标准响应格式

```typescript
// 成功响应 (符合 api-design skill)
interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    hasMore?: boolean;
  };
  links?: {
    self: string;
    next?: string;
    prev?: string;
    first?: string;
    last?: string;
  };
}

// 错误响应 (符合 api-design skill)
interface ApiError {
  error: {
    code: string;           // validation_error / not_found / forbidden / conflict
    message: string;
    details?: Array<{
      field: string;
      message: string;
      code: string;        // invalid_format / out_of_range / required
    }>;
  };
}

// HTTP 状态码规范 (api-design skill)
enum StatusCode {
  // 2xx 成功
  OK = 200,
  CREATED = 201,
  NO_CONTENT = 204,

  // 4xx 客户端错误
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  UNPROCESSABLE_ENTITY = 422,  // 语义错误
  TOO_MANY_REQUESTS = 429,

  // 5xx 服务端错误
  INTERNAL_ERROR = 500,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
}
```

### 10.2 查询参数规范 (api-design skill)

```typescript
// 过滤语法
GET /api/v1/records
  ?status=success                    // 等于
  ?created_at[gte]=2026-01-01     // 大于等于
  ?created_at[lte]=2026-06-19     // 小于等于
  ?provider=opencli/bilibili        // 精确匹配
  ?tags[contains]=ai                // 数组包含

// 排序语法
GET /api/v1/records?sort=-created_at,provider
  // - 前缀表示降序

// 稀疏字段集 (减少 payload)
GET /api/v1/records?fields=id,title,url,created_at
GET /api/v1/sources?fields=id,name,type,enabled

// 全量删除 (带条件)
DELETE /api/v1/records?before=2026-01-01&provider=opencli/test
```

### 10.3 分页规范 (api-design skill)

```typescript
// 光标分页 (推荐用于大数据量)
GET /api/v1/records?cursor=eyJpZCI6MTIzfQ&limit=20

// 响应
{
  "data": [...],
  "meta": {
    "has_next": true,
    "next_cursor": "eyJpZCI6MTQzfQ"
  }
}

// 偏移分页 (适用于小数据集)
GET /api/v1/records?page=2&per_page=20

// 响应
{
  "data": [...],
  "meta": {
    "total": 142,
    "page": 2,
    "pageSize": 20,
    "totalPages": 8
  },
  "links": {
    "self": "/api/v1/records?page=2&per_page=20",
    "next": "/api/v1/records?page=3&per_page=20",
    "prev": "/api/v1/records?page=1&per_page=20",
    "first": "/api/v1/records?page=1&per_page=20",
    "last": "/api/v1/records?page=8&per_page=20"
  }
}
```

### 10.4 批量操作

```typescript
// 批量创建
POST /api/v1/sources/batch
Request: { "sources": [{ "name": "...", "type": "..." }, ...] }
Response: {
  "data": {
    "created": 5,
    "failed": 1,
    "errors": [{ "index": 2, "error": "Name already exists" }]
  }
}

// 批量更新
PATCH /api/v1/sources/batch
Request: { "ids": ["uuid1", "uuid2"], "updates": { "enabled": false } }

// 批量删除
DELETE /api/v1/records/batch
Request: { "ids": ["uuid1", "uuid2"] }
Response: { "data": { "deleted": 2 } }
```

### 10.5 限流规范 (api-design skill)

```typescript
// 限流响应头
Response Headers:
  X-RateLimit-Limit: 100
  X-RateLimit-Remaining: 95
  X-RateLimit-Reset: 1640000000

// 超限响应
HTTP/1.1 429 Too Many Requests
Retry-After: 60
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded. Try again in 60 seconds."
  }
}

// 限流分层
| Tier | Limit | Window | Use Case |
|------|-------|--------|----------|
| Anonymous | 30/min | Per IP | 公开端点 |
| Authenticated | 100/min | Per user | 标准 API |
| Premium | 1000/min | Per API key | 付费用户 |
| Internal | 10000/min | Per service | 服务间调用 |
```

---

## 11. 前端模式增强 (frontend-patterns)

### 11.1 组件设计模式 (frontend-patterns)

```typescript
// Compound Components 模式 (frontend-patterns)
interface CardProps {
  children: React.ReactNode
  variant?: 'default' | 'outlined' | 'elevated'
}

export function Card({ children, variant = 'default' }: CardProps) {
  return <div className={cn('card', `card-${variant}`)}>{children}</div>
}

export function CardHeader({ children }: { children: React.ReactNode }) {
  return <div className="card-header">{children}</div>
}

export function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="card-body">{children}</div>
}

export function CardFooter({ children }: { children: React.ReactNode }) {
  return <div className="card-footer">{children}</div>
}

// 使用
<Card variant="elevated">
  <CardHeader>数据源配置</CardHeader>
  <CardBody>
    <SourceForm />
  </CardBody>
  <CardFooter>
    <Button>保存</Button>
  </CardFooter>
</Card>
```

### 11.2 自定义 Hooks (frontend-patterns)

```typescript
// packages/web/src/hooks/useDebounce.ts
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

// packages/web/src/hooks/useToggle.ts
export function useToggle(initialValue = false): [boolean, () => void] {
  const [value, setValue] = useState(initialValue)
  const toggle = useCallback(() => setValue(v => !v), [])
  return [value, toggle]
}

// packages/web/src/hooks/useClickOutside.ts
export function useClickOutside(
  ref: RefObject<HTMLElement>,
  handler: () => void
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return
      handler()
    }
    document.addEventListener('mousedown', listener)
    document.addEventListener('touchstart', listener)
    return () => {
      document.removeEventListener('mousedown', listener)
      document.removeEventListener('touchstart', listener)
    }
  }, [ref, handler])
}

// packages/web/src/hooks/useLocalStorage.ts
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch { return initialValue }
  })

  const setValue = (value: T) => {
    setStoredValue(value)
    window.localStorage.setItem(key, JSON.stringify(value))
  }

  return [storedValue, setValue]
}
```

### 11.3 错误边界 (frontend-patterns)

```typescript
// packages/web/src/components/ui/error-boundary.tsx
interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
    // 可发送到 Sentry
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="error-fallback">
          <h2>出错了</h2>
          <p>{this.state.error?.message}</p>
          <Button onClick={() => this.setState({ hasError: false })}>
            重试
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

// 使用
<ErrorBoundary fallback={<GlobalErrorPage />}>
  <Dashboard />
</ErrorBoundary>
```

### 11.4 虚拟列表 (frontend-patterns)

```typescript
// packages/web/src/components/ui/virtual-list.tsx
import { useVirtualizer } from '@tanstack/react-virtual'

interface VirtualListProps<T> {
  items: T[]
  estimateSize: number
  renderItem: (item: T, index: number) => React.ReactNode
}

export function VirtualList<T>({
  items,
  estimateSize,
  renderItem
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 5,
  })

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualRow => (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: virtualRow.size,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderItem(items[virtualRow.index], virtualRow.index)}
          </div>
        ))}
      </div>
    </div>
  )
}

// 使用 (采集记录列表)
<VirtualList
  items={records}
  estimateSize={80}
  renderItem={(record) => <RecordCard record={record} />}
/>
```

### 11.5 动画模式 (frontend-patterns)

```typescript
// packages/web/src/components/ui/animate-list.tsx
import { motion, AnimatePresence } from 'framer-motion'

interface AnimateListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  getKey: (item: T) => string
}

export function AnimateList<T>({
  items,
  renderItem,
  getKey
}: AnimateListProps<T>) {
  return (
    <AnimatePresence mode="popLayout">
      {items.map((item, index) => (
        <motion.div
          key={getKey(item)}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3, delay: index * 0.05 }}
          layout
        >
          {renderItem(item, index)}
        </motion.div>
      ))}
    </AnimatePresence>
  )
}

// Modal 动画 (frontend-patterns)
export function AnimatedModal({
  isOpen,
  onClose,
  children
}: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="modal-content"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25 }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

### 11.6 表单验证 (frontend-patterns)

```typescript
// packages/web/src/lib/validations.ts
import { z } from 'zod'

export const createSourceSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100, '名称最长 100 字符'),
  type: z.enum(['opencli', 'rss', 'api', 'web', 'cli']),
  config: z.object({
    command: z.string().optional(),
    url: z.string().url('请输入有效的 URL').optional(),
    interval: z.number().min(60).optional(),
  }),
  enabled: z.boolean().default(true),
})

export type CreateSourceInput = z.infer<typeof createSourceSchema>

// packages/web/src/components/features/sources/source-form.tsx
export function SourceForm() {
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = async (data: unknown) => {
    const result = createSourceSchema.safeParse(data)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      result.error.issues.forEach(issue => {
        const path = issue.path.join('.')
        fieldErrors[path] = issue.message
      })
      setErrors(fieldErrors)
      return
    }
    // 提交
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* 表单字段 */}
      <Input
        {...register('name')}
        error={errors.name}
      />
      <Select {...register('type')} error={errors.type} />
      {/* ... */}
    </form>
  )
}
```

### 11.7 性能优化 (frontend-patterns)

```typescript
// 代码分割 (frontend-patterns)
const SourceConfigForm = lazy(() => import('./SourceConfigForm'))
const NodeDetail = lazy(() => import('./NodeDetail'))

export function SourcesPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <SourceConfigForm />
    </Suspense>
  )
}

// React.memo 优化纯组件 (frontend-patterns)
export const SourceCard = React.memo<SourceCardProps>(({ source }) => {
  return (
    <Card>
      <CardHeader>{source.name}</CardHeader>
      <CardBody>{source.type}</CardBody>
    </Card>
  )
}, (prev, next) => prev.source.id === next.source.id)

// useMemo 缓存计算 (frontend-patterns)
const sortedRecords = useMemo(() => {
  return [...records].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}, [records])

// useCallback 稳定回调 (frontend-patterns)
const handleSelect = useCallback((id: string) => {
  setSelectedIds(prev =>
    prev.includes(id)
      ? prev.filter(i => i !== id)
      : [...prev, id]
  )
}, [])
```

### 11.8 可访问性 (frontend-patterns)

```typescript
// 键盘导航 (frontend-patterns)
export function CommandMenu({ items }: CommandMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex(i => Math.min(i + 1, items.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        selectItem(items[activeIndex])
        break
      case 'Escape':
        setIsOpen(false)
        break
    }
  }

  return (
    <div
      role="combobox"
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      onKeyDown={handleKeyDown}
    >
      {/* ... */}
    </div>
  )
}

// Focus 管理 (frontend-patterns)
export function Modal({ isOpen, onClose }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement
      modalRef.current?.focus()
    } else {
      previousFocusRef.current?.focus()
    }
  }, [isOpen])

  return isOpen ? (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={e => e.key === 'Escape' && onClose()}
    >
      {children}
    </div>
  ) : null
}
```

---

## 12. 前端组件清单

### 12.1 UI 原语组件 (shadcn/ui)

| 组件 | 用途 |
|------|------|
| `Button` | 按钮 |
| `Card` | 卡片容器 |
| `Dialog` | 对话框 |
| `Input` | 输入框 |
| `Select` | 选择器 |
| `Badge` | 标签 |
| `Tooltip` | 提示 |
| `Separator` | 分隔线 |
| `Skeleton` | 加载占位 |
| `AlertDialog` | 确认对话框 |

### 12.2 业务组件

| 组件 | 用途 |
|------|------|
| `DataTable` | 数据表格 (虚拟滚动) |
| `AnimateList` | 动画列表 |
| `ErrorBoundary` | 错误边界 |
| `VirtualList` | 虚拟列表 |
| `AnimatedModal` | 动画模态框 |
| `SourceForm` | 数据源表单 |
| `ScheduleForm` | 定时计划表单 |
| `RecordCard` | 记录卡片 |
| `NodeCard` | 节点卡片 |
| `StatsChart` | 统计图表 |

### 12.3 自定义 Hooks

| Hook | 用途 |
|------|------|
| `useDebounce` | 防抖 |
| `useToggle` | 开关状态 |
| `useClickOutside` | 点击外部 |
| `useLocalStorage` | 本地存储 |
| `useMediaQuery` | 媒体查询 |
| `useAsync` | 异步状态 |
| `usePagination` | 分页 |

---

## 13. API 缓存策略

### 13.1 缓存配置

```typescript
// API 路由缓存 (Next.js)
export const dynamic = 'force-dynamic'

// GET 端点缓存
GET /api/v1/sources           // Cache: 60s (stale-while-revalidate)
GET /api/v1/sources/:id      // Cache: 300s
GET /api/v1/nodes            // Cache: 30s (节点状态经常变化)
GET /api/v1/stats            // No cache (实时数据)

// POST/PUT/DELETE 端点
// 自动失效相关 GET 缓存
POST /api/v1/sources         // Invalidate: /api/v1/sources
PUT /api/v1/sources/:id      // Invalidate: /api/v1/sources/:id
DELETE /api/v1/sources/:id   // Invalidate: /api/v1/sources
```

### 13.2 前端缓存策略

```typescript
// TanStack Query 配置
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,      // 1 分钟内认为新鲜
      gcTime: 5 * 60 * 1000,    // 5 分钟后垃圾回收
      retry: 3,                   // 重试 3 次
      refetchOnWindowFocus: true, // 窗口聚焦时重新获取
    },
  },
})

// 特定查询配置
useQuery({
  queryKey: ['sources'],
  queryFn: fetchSources,
  staleTime: 30 * 1000,  // 数据源 30s 过期
})

useQuery({
  queryKey: ['records', cursor],
  queryFn: () => fetchRecords(cursor),
  staleTime: 0,  // 记录列表始终获取最新
})
```

---

## 14. 扩展阅读

- [调研报告](./SURVEY_superset.md) - 完整技术选型分析
- [api-design patterns skill](../.claude/skills/api-design) - API 设计规范
- [frontend-patterns skill](../.claude/skills/frontend-patterns) - 前端开发模式
