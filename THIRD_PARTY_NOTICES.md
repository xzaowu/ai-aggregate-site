# Third-party notices

This file records material/direct attribution for the e68e5a25 OSS source tree.
It is not an exhaustive transitive dependency license inventory. That inventory,
together with complete image/base-image notices and corresponding-source access,
is required before any official prebuilt binary or container distribution.

## Application/runtime dependencies

The following versions are supported by the package manifests and lockfile at
this baseline:

- Next.js `15.5.19` and React `19.2.7` — MIT.
- Fastify `5.8.5`, `@fastify/cors` `11.2.0`, and `@fastify/helmet` `13.1.0` — MIT.
- Prisma `6.19.3` — Apache-2.0.
- OpenAI SDK `6.49.0` — Apache-2.0.
- Anthropic SDK `0.122.0` — MIT.
- `@xyflow/react` `12.11.3` — MIT.
- `lucide-react` `1.17.0` — ISC. Lucide includes icons derived from Feather
  Icons; the applicable Feather MIT attribution remains relevant.
- `redis` `6.1.0` — MIT.

Other direct runtime and development packages retain their own upstream
licenses. This file intentionally does not reproduce every transitive npm
notice; maintainers must generate and review a complete inventory before
official prebuilt binary/container distribution.

## Icon and avatar attribution

`apps/web/components/workspace/WorkspaceIcons.tsx` contains repository-authored
inline SVGs based on its project history. No copied upstream source or
third-party attribution is identified in that file; it is treated as
repository-authored for this release.

The web application uses `@dicebear/core` `10.3.0` and
`@dicebear/styles` `10.2.0`. The exact imported style is
`notionists-neutral`. DiceBear core is MIT-licensed; style licenses are
style-specific. The Notionists Neutral style is attributed to Zoish and marked
CC0 1.0 in the DiceBear style licensing materials:
<https://www.dicebear.com/licenses/>.

## Provider and payment boundary

Provider adapters and optional payment code are source features only. No
Provider credentials or merchant credentials are bundled. Self-hosters accept
their own Provider/payment terms, pricing, costs, and usage rights.
