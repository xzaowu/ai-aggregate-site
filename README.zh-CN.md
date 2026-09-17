# AI 聚合站 / AI Aggregate Site

[English](README.md) | 简体中文

AI 聚合站是一个可自托管的多模态 AI 工作空间。它将工作空间体验连接到
自行配置的 Provider / 服务提供方账户，同时在应用中保留模型选择、路由、积分、任务、资产
以及账户边界。

## 产品功能

- AI 对话和对话历史
- 图像生成和图像工具
- 视频生成和视频工具
- 用于多模态工作的创作画布
- Provider / 服务提供方、模型和路由配置
- 任务、资产、积分、账户和管理后台界面

## 仓库

```text
apps/web/              Next.js 用户和管理后台 UI
apps/api/              Fastify API 和运行时
packages/shared/       共享 TypeScript 契约
packages/ai-adapters/  Provider / 服务提供方传输适配器
prisma/                MySQL schema、迁移和种子数据
docs/                  公开的产品、安装和部署指南
```

## 本地开发

```bash
corepack pnpm install --frozen-lockfile
cp .env.example .env
corepack pnpm prisma:generate
corepack pnpm exec prisma migrate deploy
corepack pnpm dev
```

默认本地服务分别运行在 Web 的 `http://localhost:3000` 和 API 的
`http://localhost:4000`。请将真实 API keys、数据库凭据、支付密钥和用户媒体保存在 Git 之外。

发布候选版本使用 Node.js `v22.23.0`、pnpm `10.12.1`、MySQL `8.4` 和 Redis `7` 完成验证。
这些是验证参考，并非严格的最低版本。有关本地设置，请参阅
[docs/INSTALL.md](docs/INSTALL.md)；有关通用 Docker 路径，请参阅
[docs/DOCKER_DEPLOY.md](docs/DOCKER_DEPLOY.md)。

SMTP 在首次启动时是可选的。不配置邮件时，请保持 SMTP 变量未设置；使用 setup-token 引导创建的管理员创建时即为已验证状态，并且无需邮件投递即可登录。普通注册在完成邮箱验证前仍保持未验证状态，因此在使用这些流程前，请配置完整的 SMTP 配置块。Provider / 服务提供方凭据采用自带密钥（BYOK）方式，启动 UI 并不需要这些凭据。

常用检查：

```bash
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm -r build
```

## Docker

OSS v0.1 支持使用源码加通用本地构建 Dockerfile：

```bash
cp .env.docker.example .env
docker compose up -d --build
```

不会分发官方预构建项目镜像。请为自己的部署配置反向代理、数据库、Redis 和密钥；通用 Compose 文件不会配置 MySQL 或 Redis。

## 第三方服务 / 自带密钥（BYOK）

自托管用户配置自己的 Provider / 服务提供方账户和凭据，并接受相应 Provider / 服务提供方的条款、定价、费用和使用权利。项目不附带任何 Provider / 服务提供方凭据，Apache-2.0 许可证不授予任何第三方 API、模型或支付权利。如果启用支付，请使用自己的支付或商户账户，并遵守适用条款。特定供应商的集成仍为可选项。

## 许可证

项目源代码采用 Apache-2.0 许可证；详见 [LICENSE](LICENSE)。第三方组件仍受其各自许可证约束；详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
