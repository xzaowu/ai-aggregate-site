# AI 聚合站 product brief

AI 聚合站 / AI Aggregate Site is a self-hostable multi-modal AI workspace.
Users bring their own Provider accounts and credentials, then use the
workspace to review and manage AI-assisted work.

## Primary product surfaces

- AI Chat and conversation history
- Image generation and image tools
- Video generation and video tools
- Creator Canvas for connected multimodal work

## Supporting platform surfaces

- Provider accounts, models, and routes
- Tasks and assets
- Credits and account views
- Administrative configuration

## Repository shape

```text
apps/web/              Next.js frontend
apps/api/              Fastify API
packages/shared/       Shared contracts and domain types
packages/ai-adapters/  Provider adapters
prisma/                MySQL schema, migrations, and seed
```

The product is self-hosted. Deployment operators provide their own database,
Provider credentials, optional payment account, and applicable service terms.
