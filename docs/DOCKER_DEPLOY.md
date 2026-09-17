# Docker deployment

OSS v0.1 uses source plus a generic local Docker build. It does not distribute
an official prebuilt project image.

The Dockerfile uses Node 22 and pnpm 10.12.1 and installs from the lockfile
with `--frozen-lockfile`. R4 local validation used Node.js `v22.23.0`, MySQL
`8.4`, and Redis `7`; these are validation references, not strict minimums.

## Architecture

```text
Browser
  -> TLS / reverse proxy
    -> Web container :3000
    -> API container :4000
       -> MySQL
       -> private asset storage
```

Keep MySQL, generated assets, Redis if enabled, and `.env` under the
deployment operator's control. Do not commit secrets or private user media.

## Build and start

```bash
cp .env.docker.example .env
# Edit .env with deployment-specific values.
docker compose up -d --build
docker compose ps
```

Configure `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `AI_BASE_URL`,
`AI_API_KEY`, `NEXT_PUBLIC_API_BASE_URL`, and `CORS_ORIGINS` for the target
environment. Production rate limiting and concurrency use Redis; the generic
Compose file does not provision MySQL or Redis.
Use a strong random value for every secret.

SMTP is optional for initial startup. Leave all `SMTP_*` variables unset when
mail is not configured. The setup-token bootstrap admin is created as verified
and can log in without email delivery. Ordinary registrations remain
unverified until email verification; configure the complete SMTP block before
relying on those flows. Provider credentials are not required merely to boot
the UI.

## Reverse proxy

Expose only the reverse proxy publicly. Route `/` to the Web container and
`/api/` to the API container while preserving the API path contract. Do not
expose MySQL, Redis, private asset storage, or API management ports directly.

## Updates

1. Back up the database and generated assets when the release can change them.
2. Update the checked-out source tree.
3. Build the candidate image locally.
4. Start the candidate and verify health, logs, and restart counts.
5. Run focused smoke checks for the changed workflow.

No GHCR workflow or official image pull path is part of OSS v0.1.
