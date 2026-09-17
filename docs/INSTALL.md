# Installation guide

This guide describes a generic self-hosted installation. Replace all example
domains, database values, and secrets with values for your environment.

## Prerequisites

- Node.js 22 LTS or compatible
- Corepack and pnpm 10 (the validated environment used pnpm 10.12.1)
- MySQL 8 or a compatible MySQL deployment
- Redis 7 or a compatible deployment when Redis-backed rate limiting or
  concurrency is enabled
- A self-configured AI Provider account and API credential for generation; it
  is not required merely to boot the UI or complete bootstrap
- Docker, if using the local-build Compose path

The validated local database used MySQL 8.4. These versions are validation
references, not strict minimums.

## Local development

```bash
corepack pnpm install --frozen-lockfile
cp .env.example .env
```

Set at least `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_API_BASE_URL`, and
`CORS_ORIGINS` in `.env`. Configure `AI_BASE_URL` and `AI_API_KEY` only with
your own Provider values.

SMTP is optional for initial startup. Leave all `SMTP_*` variables unset when
mail is not configured. The setup-token bootstrap admin is created as verified
and can log in without email delivery. Ordinary registrations remain
unverified until email verification, so configure the complete SMTP block
before relying on those flows. Provider credentials are not required merely to
boot the UI.

Initialize the database and start the services:

```bash
corepack pnpm prisma:generate
corepack pnpm exec prisma migrate deploy
corepack pnpm dev
```

Web runs on `http://localhost:3000`; API runs on `http://localhost:4000`.
Complete `/setup` when the installation requires first-run configuration.

## Docker local build

```bash
cp .env.docker.example .env
docker compose up -d --build
```

The Compose file builds from the checked-out source. OSS v0.1 does not publish
an official prebuilt image.

The Docker example runs in production mode, so provide a Redis service and set
the `REDIS_URL` block from `.env.docker.example` in addition to MySQL. The
generic Compose file does not provision either external service.

## BYOK and payment

Users and operators are responsible for Provider terms, pricing, usage rights,
and costs. No Provider credentials are included in this repository. Payment is
optional and requires the operator's own merchant account and applicable terms.
Keep `.env` and all real credentials outside Git.
