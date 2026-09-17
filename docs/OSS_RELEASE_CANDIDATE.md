# AI Aggregate Site OSS v0.1 Release Candidate

## Product Baseline

Historical product baseline: `e68e5a25c9a6bdc03f5a6315b7b43532e1625803`.

The public candidate contains publication-safe documentation, metadata, and
provenance changes on top of that historical baseline, so the final source tree
is not expected to equal the historical revision byte-for-byte.

## Scope

Core surfaces:

- AI Chat
- Image
- Video
- Creator Canvas

Supporting platform capabilities:

- Providers, models, and routes
- Tasks and assets
- Credits and account
- Admin

## Release Model

Source plus local build. The project does not distribute official prebuilt
images for OSS v0.1.

## Validation

- Frozen dependency install: PASS
- Typecheck: PASS
- Lint: PASS
- Production build: PASS
- Prisma fresh migration: PASS
- Generic local Docker build: PASS
- First-run bootstrap: PASS
- Test suites: PASS

Test totals:

- Shared: 33
- AI adapters: 164
- API: 2,835
- Web: 2,324
- Database-specific suites: 453 PASS

Real Provider calls during validation: 0.

## Known Evidence Gap

Browser automation smoke was not executed because no existing browser runtime
was available during validation. This is an evidence gap, not a reported
product defect.

## License

Project source is licensed under Apache-2.0. See [LICENSE](../LICENSE).
Third-party components remain under their own licenses; see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
