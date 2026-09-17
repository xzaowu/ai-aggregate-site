# Title Cover Evaluation Baseline

Status: `TC-R6.0A IMPLEMENTED / HUMAN REVIEW FIX 1 / AWAITING HUMAN RE-REVIEW`

This directory is a non-production, versioned specification for the Title
Cover evaluation baseline. It contains case metadata, the benchmark result
contract, and a human blind A/B review template. It does not contain a runner,
package manifest, generated images, provider credentials, or production data.

## Scope

The baseline fixes the input matrix so that a future benchmark can change only
the Visual Brief logical chat model. The image model, image size, count, style,
reference behavior, and existing Canvas2D compositor remain controlled
variables.

The baseline does not change any API, Web, shared, adapter, Admin, Prisma,
Provider/Route, billing, quota, task, reservation, idempotency, or production
configuration contract.

The cases use the four existing Title Cover styles:

- `minimal-modern`
- `energetic-motion`
- `professional-business`
- `warm-editorial`

All cases use `1280x720` and `count = 1`. Reference cases point to expected
fixture paths only; no binary reference fixture is committed in this phase.

## Files

- `cases.json` — the fixed 16-case dataset and fixture metadata.
- `benchmark-result.schema.json` — one benchmark result artifact contract.
- `human-review-template.csv` — normative blind A/B review columns.

## Case matrix

The fixed matrix is:

| Category | Cases | Reference | No reference |
| --- | ---: | ---: | ---: |
| AI 工具类 | 3 | 1 | 2 |
| AI 副业类 | 3 | 2 | 1 |
| 教程类 | 3 | 1 | 2 |
| 对比类 | 3 | 2 | 1 |
| 产品类 | 2 | 1 | 1 |
| 人物/故事类 | 2 | 1 | 1 |
| Total | 16 | 8 | 8 |

Each style occurs exactly four times. Each style has two reference and two
no-reference cases. `notes` records only the test intent; it does not describe
an expected model answer.

## Human Blind A/B Rubric

Each artifact is scored independently. The A/B suffix in the review template
identifies the artifact being scored; it does not identify a model, provider,
route, or upstream model.

For every numeric dimension use the same anchors:

- `1` = clearly poor / fails the dimension
- `2` = below acceptable / materially weak
- `3` = usable / acceptable but ordinary
- `4` = above acceptable / clearly useful
- `5` = clearly strong for the dimension

Do not score based on whether the generated image reproduces the title text.
The existing Canvas2D compositor owns the final copy.

### Numeric dimensions

- **semanticRelevance**: whether the visual base accurately expresses the core
  meaning of the original title. Do not reward literal text copying.
- **compositionUsefulness**: whether the focal subject, visual hierarchy, and
  composition are useful as a Title Cover visual base.
- **copySafeZone**: whether the generated base leaves a practically usable
  area for the existing Canvas2D copy. Do not score the final typography or
  font quality here.
- **thumbnailReadability**: after reducing the image to a common content
  platform thumbnail size, whether the subject and core visual remain clear
  without harmful conflict.
- **creativeQuality**: whether the image has a specific visual idea, a
  memorable treatment, and avoids a generic or template-like scene. This is a
  **HUMAN SUBJECTIVE METRIC**, not a deterministic metric.
- **paidFeel**: the reviewer's subjective sense of professional finish and
  product value. It is not a price judgment, product SLA, or automatic
  acceptance threshold. This is a **HUMAN SUBJECTIVE METRIC**, not a
  deterministic metric.

### Incidental readable text

Record one categorical value for each artifact:

- `no`
- `suspected`
- `yes`

This is a human review label in this template. Future OCR measurement, if
authorized, remains a separate measurement layer and must not automatically
trigger regeneration.

### Blind pairing rules

- The reviewer must not see the Visual Brief model, provider, route, or
  upstream model.
- Artifact A/B order must be randomized and recorded as `AB` or `BA`.
- `decision` is pair-level metadata and must be one of `a`, `b`, `tie`, or
  `invalid`.
- `invalidSample` is pair-level boolean metadata. `decision=invalid` must use
  `invalidSample=true`; a valid review must use `invalidSample=false`.
- `tie` is allowed and must not be converted into a product conclusion.

The CSV A/B score fields map back to the single-artifact fields in
`benchmark-result.schema.json`: for example, `semanticRelevanceA` maps to
`evaluation.semanticRelevance` for artifact A. The schema's `evaluation`
object is a single-artifact evaluation contract; the CSV uses A/B suffixes to
record two artifacts independently. `decision`, `randomizedOrder`,
`blindGroupId`, and `invalidSample` are pair-level review metadata.

## Future execution protocol

Execution is not part of TC-R6.0A. When separately authorized, a benchmark
operator must:

1. Run only in an isolated non-production environment.
2. Change only the Admin-configured Visual Brief logical chat model.
3. Keep the image model, size, count, style, reference fixture, and compositor
   fixed for a comparison.
4. Record one JSON artifact per case/repeat using
   `benchmark-result.schema.json`.
5. Store generated-base images in a local temporary directory or future CI
   artifact. Do not commit them by default.
6. Produce a blind review packet whose A/B labels contain no model, provider,
   route, or upstream-model identity.
7. Use `human-review-template.csv` for reviewer input. Reviewers may select
   `tie` or `invalid`; no automatic product conclusion is produced.

The result fields `p50`, `p95`, `timeoutRate`, and `winRate` are future report
aggregates only. They must be labeled:

`BENCHMARK OBSERVATION — NOT PRODUCT SLA`

## Artifact and data policy

Allowed repository content:

- benchmark cases;
- JSON Schema;
- review template;
- execution instructions.

Do not commit API keys, provider secrets, production user data, production
private assets, raw provider error/response bodies, production title datasets,
or large generated-image collections.

Promptfoo remains `REFERENCE / EVALUATE FIRST` and is not a dependency.
Tesseract.js remains `REFERENCE / EVALUATE FIRST` and is not a dependency.
PaddleOCR is `REFERENCE ONLY`. LangGraph is `DO NOT ADD`. Native Structured
Outputs are `DEFER / REFERENCE`.

No benchmark network execution has been performed for this specification.
