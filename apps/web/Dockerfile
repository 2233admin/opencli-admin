# Next.js App Router 前端 Dockerfile
# 多阶段构建，优化体积
FROM node:22-alpine AS base

# 安装依赖阶段
FROM base AS deps
RUN apk add --no-cache libc6-compat

WORKDIR /app

# 复制 package 文件
COPY package.json package-lock.json* ./

# 安装依赖
RUN npm ci --legacy-peer-deps

# 构建阶段
FROM deps AS builder

WORKDIR /app

# 复制源码
COPY . .

# 构建
RUN npm run build

# 生产阶段
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 复制构建产物
COPY --from=builder /app/public ./public

# 设置权限
RUN mkdir .next && chown nextjs:nodejs .next

# 切换用户
USER nextjs

# 复制 next.js 服务器
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 暴露端口
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 启动
CMD ["node", "server.js"]
