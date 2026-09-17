#!/bin/sh
set -e

# =============================================================================
# Docker API 启动脚本
# 在启动 Fastify API 服务器之前运行数据库迁移。
# =============================================================================

echo "=== AI Aggregate API ==="
echo "Running database migrations..."

# 运行 Prisma 迁移（生产安全：只应用未执行的迁移，不会删除数据）
npx prisma migrate deploy

echo "Migrations complete."

# 可选：如果需要种子数据，取消下面一行的注释
# 注意：seed 是幂等的（upsert），不会覆盖已有数据，也不会标记 setupCompleted
# npx prisma db seed

echo "Starting API server on port ${API_PORT:-4000}..."
exec node apps/api/dist/index.js
