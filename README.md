# AI 聚合站 / AI Aggregate Site

AI 聚合站 is a self-hostable multi-modal AI workspace. It connects the
workspace experience to self-configured Provider accounts while keeping model
selection, routes, credits, tasks, assets, and account boundaries in the
application.

## Product surfaces

- AI Chat and conversation history
- Image generation and image tools
- Video generation and video tools
- Creator Canvas for multimodal work
- Provider, model, and route configuration
- Tasks, assets, credits, account, and admin surfaces

## Repository

```text
apps/web/              Next.js user and admin UI
apps/api/              Fastify API and runtime
packages/shared/       Shared TypeScript contracts
packages/ai-adapters/  Provider transport adapters
prisma/                MySQL schema, migrations, and seed
docs/                  Public product, installation, and deployment guidance
```

## Local development

```bash
corepack pnpm install --frozen-lockfile
cp .env.example .env
corepack pnpm prisma:generate
corepack pnpm exec prisma migrate deploy
corepack pnpm dev
```

The default local services are Web on `http://localhost:3000` and API on
`http://localhost:4000`. Keep real API keys, database credentials, payment
secrets, and user media outside Git.

The release candidate was validated with Node.js `v22.23.0`, pnpm `10.12.1`,
MySQL `8.4`, and Redis `7`. These are validation references, not strict minimum
versions. See [docs/INSTALL.md](docs/INSTALL.md) for local setup and
[docs/DOCKER_DEPLOY.md](docs/DOCKER_DEPLOY.md) for the generic Docker path.

SMTP is optional for initial startup. Leave the SMTP variables unset when mail
is not configured; the setup-token bootstrap admin is created as verified and
can log in without email delivery. Ordinary registrations remain unverified
until their email is verified, so configure a complete SMTP block before using
those flows. Provider credentials are BYOK and are not required to boot the UI.

Common checks:

```bash
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm -r build
```

## Docker

OSS v0.1 supports source plus a generic local-build Dockerfile:

```bash
cp .env.docker.example .env
docker compose up -d --build
```

No official prebuilt project image is distributed. Configure the reverse proxy,
database, Redis, and secrets for your own deployment; the generic Compose file
does not provision MySQL or Redis.

## Third-party services / BYOK

Self-hosters configure their own Provider accounts and credentials and accept
their own Provider terms, pricing, costs, and usage rights. No Provider
credentials are bundled, and the Apache-2.0 license grants no third-party API,
model, or payment rights. If payment is enabled, use your own payment or
merchant account and applicable terms. Vendor-specific integrations remain
optional.

## License

Project source is licensed under Apache-2.0; see [LICENSE](LICENSE).
Third-party components remain under their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
