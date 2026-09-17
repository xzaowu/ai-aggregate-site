#!/bin/sh
set -e

# =============================================================================
# Docker Web 启动脚本
# 启动 Next.js 生产服务器。
# =============================================================================

echo "=== AI Aggregate Web ==="
echo "Starting Next.js server on port 3000..."

# Next.js 构建产物在 apps/web/.next 目录
# 从 web 目录启动以确保 Next.js 正确加载配置
cd apps/web
exec npx next start -p 3000
