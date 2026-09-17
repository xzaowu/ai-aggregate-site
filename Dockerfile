# =============================================================================
# AI Aggregate Site — Production Dockerfile
#
# 多阶段构建，适用于 pnpm monorepo。
# 通过 docker-compose command 覆盖来选择运行 web 或 api。
#
# 修复点：
# - 不复制不存在的 packages/*/dist（shared/ai-adapters 源码包，无 dist 输出）
# - 不复制 apps/web/public（可选目录，可能不存在）
# - 不在跨阶段复制 .prisma；在 runner 中生成，保证平台兼容
# - API 构建时将 workspace 包打包进 dist，避免运行时依赖 TS 源码
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Builder — 安装依赖、构建所有包
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app

# 利用 Docker 层缓存：先只复制依赖声明文件
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ai-adapters/package.json ./packages/ai-adapters/
COPY tsconfig.base.json ./

# 安装全部依赖（含 devDependencies，构建需要）
# 使用 --prod=false 强制安装 devDependencies：
#   镜像内无 NODE_ENV/CI/NPM_CONFIG_PRODUCTION 等环境变量，但 pnpm v10 仍会按生产模式解析
#   workspace 依赖的 .pnpm 子目录 hash，导致 ai-adapters 的 vitest symlink 指向不存在的目录
#   进而使 `pnpm build` 在 `tsc -p tsconfig.json --noEmit` 阶段报 TS2307。
RUN pnpm install --frozen-lockfile --prod=false

# 复制 Prisma schema（generate 需要）
COPY prisma/schema.prisma ./prisma/

# 生成 Prisma Client
RUN npx prisma generate

# Next.js 在构建时将 NEXT_PUBLIC_* 变量嵌入 JS 产物。
# 默认 /api 用于单域名 Docker 部署（Nginx 代理 /api/ → API 容器）。
# docker-compose build args 可覆盖此默认值。
ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

# 复制全部源码
COPY . .

# 构建所有包。
# - shared/ai-adapters: tsc 类型检查（无输出产物）
# - web: Next.js 构建 → apps/web/.next（使用上述 NEXT_PUBLIC_API_BASE_URL）
# - api: tsup 构建 → apps/api/dist（通过 tsup.config.ts 将 workspace 包打包进 dist）
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 2: Runner — 生产运行时
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app

# 复制 workspace 配置和依赖声明
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ai-adapters/package.json ./packages/ai-adapters/

# 安装全部依赖（保留 prisma CLI 用于 migrate deploy + generate）
# 使用完整安装而非 --prod：prisma CLI 需要 devDependencies 中的 prisma 包
# 使用 --prod=false 强制安装 devDependencies：与 builder 阶段同因，
#   否则 ai-adapters 下的 devDep 链接会因 .pnpm hash 不一致而 broken，
#   影响 runner 中 `pnpm db seed` 等走 workspace devDep 解析的命令。
RUN pnpm install --frozen-lockfile --prod=false

# 复制 Prisma schema 和迁移文件（generate + migrate deploy 需要）
COPY --from=builder /app/prisma ./prisma/

# API 正常运行使用已打包的 dist，不依赖 workspace TypeScript 源码。
# Prisma seed 是例外：@ai-aggregate/shared 当前导出指向 src/index.ts，
# 因此 runner 需要携带 shared 源码。
COPY --from=builder /app/packages/shared/src ./packages/shared/src/

# 在 runner 中生成 Prisma Client（确保平台兼容性）
RUN npx prisma generate

# 从 builder 复制构建产物（只复制确定存在的路径）
COPY --from=builder /app/apps/api/dist ./apps/api/dist/
COPY --from=builder /app/apps/web/.next ./apps/web/.next/
COPY --from=builder /app/apps/web/next.config.ts ./apps/web/

# public/ 目录可选 — Next.js 在缺失时也能正常运行
# 如果项目中有 public/ 目录，取消下一行注释：
# COPY --from=builder /app/apps/web/public ./apps/web/public/

# 复制启动脚本
COPY scripts/docker-api-start.sh ./scripts/
COPY scripts/docker-web-start.sh ./scripts/
RUN chmod +x ./scripts/docker-api-start.sh ./scripts/docker-web-start.sh

# 健康检查（API 默认端口 4000）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${API_PORT:-4000}/health || exit 1

# 默认启动 API；通过 docker-compose command 覆盖为 web
CMD ["node", "apps/api/dist/index.js"]
