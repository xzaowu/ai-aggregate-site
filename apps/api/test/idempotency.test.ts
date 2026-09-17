import { describe, expect, it } from "vitest";
import {
  IDEMPOTENCY_CLAIM_TTL_MS,
  IDEMPOTENCY_TERMINAL_TTL_MS,
  IMAGE_GENERATE_IDEMPOTENCY_SCOPE,
  buildImageGenerationRequestFingerprint,
  buildReferenceImageFingerprint,
  buildReferenceImageFingerprints,
  canonicalizeImageGenerationFingerprintInput,
  getIdempotencyClaimExpiresAt,
  getIdempotencyTerminalExpiresAt,
  hashIdempotencyClaimToken,
  hashIdempotencyKey,
  hashImageRequestFingerprint,
  hashUserIdempotencyOwner,
  parseIdempotencyKeyHeader,
  validateIdempotencyKey
} from "../src/idempotency";
import type { ImageGenerationFingerprintInput } from "../src/idempotency";

describe("idempotency helpers", () => {
  it("exports the frozen image scope and TTLs", () => {
    expect(IMAGE_GENERATE_IDEMPOTENCY_SCOPE).toBe("POST /image/generate:v1");
    expect(IDEMPOTENCY_CLAIM_TTL_MS).toBe(120_000);
    expect(IDEMPOTENCY_TERMINAL_TTL_MS).toBe(86_400_000);
  });

  it("accepts a UUID v4 key and exact length boundaries", () => {
    expect(validateIdempotencyKey("9c56d5d0-61f8-4d52-bae4-41f84db8c73f")).toBe(
      "9c56d5d0-61f8-4d52-bae4-41f84db8c73f"
    );
    expect(validateIdempotencyKey("a".repeat(16))).toBe("a".repeat(16));
    expect(validateIdempotencyKey("Z".repeat(128))).toBe("Z".repeat(128));
  });

  it.each([
    "a".repeat(15),
    "a".repeat(129),
    "contains space key",
    "contains\tcontrol",
    "contains\ncontrol",
    "invalid+character"
  ])("rejects invalid key without echoing it: %j", (rawKey) => {
    expect(() => validateIdempotencyKey(rawKey)).toThrow(
      "INVALID_IDEMPOTENCY_KEY"
    );
    try {
      validateIdempotencyKey(rawKey);
    } catch (error) {
      expect(String(error)).not.toContain(rawKey);
    }
  });

  it("does not trim and silently accept a changed key", () => {
    const rawKey = ` ${"a".repeat(16)}`;
    expect(() => validateIdempotencyKey(rawKey)).toThrow(
      "INVALID_IDEMPOTENCY_KEY"
    );
  });

  it("returns stable domain-separated 32-byte hashes", () => {
    const key = "9c56d5d0-61f8-4d52-bae4-41f84db8c73f";
    const keyHash = hashIdempotencyKey(key);
    const secondKeyHash = hashIdempotencyKey(key);
    const ownerHash = hashUserIdempotencyOwner(key);
    const tokenHash = hashIdempotencyClaimToken(key);
    const fingerprint = hashImageRequestFingerprint(key);

    expect(keyHash).toEqual(secondKeyHash);
    for (const hash of [keyHash, ownerHash, tokenHash, fingerprint]) {
      expect(Buffer.isBuffer(hash)).toBe(true);
      expect(hash).toHaveLength(32);
    }
    expect(
      new Set(
        [keyHash, ownerHash, tokenHash, fingerprint].map((hash) =>
          hash.toString("hex")
        )
      )
    ).toHaveLength(4);
  });

  it("does not expose a raw claim token in validation errors", () => {
    const rawToken = { raw: "some-raw-secret-token" };
    try {
      hashIdempotencyClaimToken(rawToken as unknown as string);
      throw new Error("TEST_EXPECTED_TOKEN_VALIDATION_ERROR");
    } catch (error) {
      expect(String(error)).toContain("INVALID_IDEMPOTENCY_CLAIM_TOKEN");
      expect(String(error)).not.toContain(rawToken.raw);
    }
  });

  it("derives deterministic claim and terminal expiries from injected time", () => {
    const now = new Date("2026-07-14T00:00:00.000Z");
    expect(getIdempotencyClaimExpiresAt(now).getTime() - now.getTime()).toBe(
      IDEMPOTENCY_CLAIM_TTL_MS
    );
    expect(getIdempotencyTerminalExpiresAt(now).getTime() - now.getTime()).toBe(
      IDEMPOTENCY_TERMINAL_TTL_MS
    );
  });
});

describe("Idempotency-Key header parsing", () => {
  it("reports a missing header only for undefined", () => {
    expect(parseIdempotencyKeyHeader(undefined)).toEqual({
      ok: false,
      reason: "MISSING"
    });
  });

  it("accepts exact lower and upper length boundaries", () => {
    expect(parseIdempotencyKeyHeader("a".repeat(16))).toEqual({
      ok: true,
      key: "a".repeat(16)
    });
    expect(parseIdempotencyKeyHeader("Z".repeat(128))).toEqual({
      ok: true,
      key: "Z".repeat(128)
    });
  });

  it("accepts UUID v4 keys and preserves case", () => {
    const key = "9C56D5D0-61F8-4D52-BAE4-41F84DB8C73F";
    expect(parseIdempotencyKeyHeader(key)).toEqual({ ok: true, key });
  });

  it("rejects an empty header value", () => {
    expect(parseIdempotencyKeyHeader("")).toEqual({
      ok: false,
      reason: "INVALID"
    });
  });

  it.each([
    "a".repeat(15),
    "a".repeat(129),
    "secret-invalid-key+value",
    `key,${"a".repeat(16)}`,
    ` ${"a".repeat(16)}`,
    `${"a".repeat(16)} `,
    `${"a".repeat(8)}\t${"a".repeat(8)}`,
    `${"a".repeat(8)}\r\n${"a".repeat(8)}`,
    `${"a".repeat(8)}中文${"a".repeat(8)}`
  ])("rejects invalid scalar header values without echoing them", (value) => {
    const result = parseIdempotencyKeyHeader(value);
    expect(result).toEqual({ ok: false, reason: "INVALID" });
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it.each([
    {
      name: "a single-member array",
      value: ["abcdefghijklmnop"]
    },
    {
      name: "multiple values",
      value: ["abcdefghijklmnop", "qrstuvwxyzabcdef"]
    }
  ])("rejects $name without echoing a member", ({ value }) => {
      const result = parseIdempotencyKeyHeader(value);
      expect(result).toEqual({ ok: false, reason: "INVALID" });
      expect(JSON.stringify(result)).not.toContain(value[0] ?? "");
    });

  it.each([null, 42, true, {}])(
    "rejects non-string header values without coercion",
    (value) => {
      expect(parseIdempotencyKeyHeader(value)).toEqual({
        ok: false,
        reason: "INVALID"
      });
    }
  );
});

describe("reference image fingerprint", () => {
  const pngReference = {
    dataUrl: "data:image/png;base64,AQID",
    mimeType: "image/png"
  };

  it("returns undefined when no reference image is present", () => {
    expect(buildReferenceImageFingerprint(undefined)).toBeUndefined();
  });

  it("normalizes MIME casing while preserving a stable fingerprint", () => {
    expect(
      buildReferenceImageFingerprint({
        dataUrl: "data:IMAGE/PNG;base64,AQID",
        mimeType: " IMAGE/PNG "
      })
    ).toBe(buildReferenceImageFingerprint(pngReference));
  });

  it("distinguishes MIME types and decoded bytes", () => {
    const fingerprint = buildReferenceImageFingerprint(pngReference);
    expect(
      buildReferenceImageFingerprint({
        dataUrl: "data:image/jpeg;base64,AQID",
        mimeType: "image/jpeg"
      })
    ).not.toBe(fingerprint);
    expect(
      buildReferenceImageFingerprint({
        dataUrl: "data:image/png;base64,BAUG",
        mimeType: "image/png"
      })
    ).not.toBe(fingerprint);
  });

  it("returns lowercase 64-character hexadecimal", () => {
    expect(buildReferenceImageFingerprint(pngReference)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds an ordered collection by reusing the scalar fingerprint contract", () => {
    const jpegReference = {
      dataUrl: "data:image/jpeg;base64,BAUG",
      mimeType: "image/jpeg"
    };

    expect(buildReferenceImageFingerprints(undefined)).toBeUndefined();
    expect(buildReferenceImageFingerprints([pngReference, jpegReference])).toEqual([
      buildReferenceImageFingerprint(pngReference),
      buildReferenceImageFingerprint(jpegReference)
    ]);
  });

  it.each([
    { referenceImages: [] },
    { referenceImages: Array.from({ length: 5 }, () => pngReference) }
  ])(
    "rejects invalid reference image collection lengths",
    ({ referenceImages }) => {
      expect(() => buildReferenceImageFingerprints(referenceImages)).toThrow(
        "INVALID_REFERENCE_IMAGE_FINGERPRINT_INPUT"
      );
    }
  );

  it.each([
    { dataUrl: "data:image/png;base64,AQ!D", mimeType: "image/png" },
    { dataUrl: "data:image/png;base64,", mimeType: "image/png" },
    { dataUrl: "data:image/png, AQID", mimeType: "image/png" }
  ])("rejects invalid independent inputs without exposing their data URL", (value) => {
    try {
      buildReferenceImageFingerprint(value);
      throw new Error("TEST_EXPECTED_REFERENCE_IMAGE_FINGERPRINT_ERROR");
    } catch (error) {
      expect(String(error)).toBe(
        "TypeError: INVALID_REFERENCE_IMAGE_FINGERPRINT_INPUT"
      );
      expect(String(error)).not.toContain(value.dataUrl);
    }
  });
});

describe("image generation request fingerprint", () => {
  type FingerprintVariationCase = {
    name: string;
    mutate: (
      input: ImageGenerationFingerprintInput
    ) => ImageGenerationFingerprintInput;
  };

  const referenceImageFingerprintA = "a".repeat(64);
  const referenceImageFingerprintB = "b".repeat(64);
  const input: ImageGenerationFingerprintInput = {
    modelId: "image-model",
    prompt: "paint a quiet lake",
    size: "1024x1024",
    count: 1,
    mode: "image-to-image",
    imageSessionId: "session-1",
    clientEntryId: "entry-1",
    imageSessionTitle: "Lake studies",
    referenceImageFingerprints: [referenceImageFingerprintA]
  };

  const fingerprintVariationCases = [
    {
      name: "prompt",
      mutate: (current) => ({ ...current, prompt: "paint a stormy lake" })
    },
    {
      name: "model ID",
      mutate: (current) => ({ ...current, modelId: "other-image-model" })
    },
    {
      name: "size",
      mutate: (current) => ({ ...current, size: "1280x720" })
    },
    {
      name: "count",
      mutate: (current) => ({ ...current, count: 2 })
    },
    {
      name: "mode",
      mutate: (current) => ({
        ...current,
        mode: "text-to-image",
        referenceImageFingerprints: undefined
      })
    },
    {
      name: "image session ID",
      mutate: (current) => ({ ...current, imageSessionId: "session-2" })
    },
    {
      name: "client entry ID",
      mutate: (current) => ({ ...current, clientEntryId: "entry-2" })
    },
    {
      name: "image session title",
      mutate: (current) => ({ ...current, imageSessionTitle: "Storm studies" })
    },
    {
      name: "reference image fingerprint",
      mutate: (current) => ({
        ...current,
        referenceImageFingerprints: [referenceImageFingerprintB]
      })
    }
  ] satisfies readonly FingerprintVariationCase[];

  it("is deterministic for the same canonical input and request fingerprint", () => {
    expect(canonicalizeImageGenerationFingerprintInput(input)).toBe(
      canonicalizeImageGenerationFingerprintInput({ ...input })
    );
    expect(buildImageGenerationRequestFingerprint(input)).toEqual(
      buildImageGenerationRequestFingerprint({ ...input })
    );
  });

  it("keeps the single-reference canonical JSON backward compatible", () => {
    const canonical = JSON.parse(
      canonicalizeImageGenerationFingerprintInput(input)
    ) as Record<string, unknown>;

    expect(canonical.referenceImageFingerprint).toBe(referenceImageFingerprintA);
    expect(canonical).not.toHaveProperty("referenceImageFingerprints");
  });

  it("keeps ordered multi-reference fingerprints deterministic and order-sensitive", () => {
    const orderedInput: ImageGenerationFingerprintInput = {
      ...input,
      referenceImageFingerprints: [
        referenceImageFingerprintA,
        referenceImageFingerprintB
      ]
    };
    const reversedInput: ImageGenerationFingerprintInput = {
      ...orderedInput,
      referenceImageFingerprints: [
        referenceImageFingerprintB,
        referenceImageFingerprintA
      ]
    };

    expect(buildImageGenerationRequestFingerprint(orderedInput)).toEqual(
      buildImageGenerationRequestFingerprint({
        ...orderedInput,
        referenceImageFingerprints: [...orderedInput.referenceImageFingerprints!]
      })
    );
    expect(buildImageGenerationRequestFingerprint(orderedInput)).not.toEqual(
      buildImageGenerationRequestFingerprint(reversedInput)
    );
    expect(
      JSON.parse(canonicalizeImageGenerationFingerprintInput(orderedInput))
    ).toMatchObject({
      referenceImageFingerprints: [
        referenceImageFingerprintA,
        referenceImageFingerprintB
      ]
    });
  });

  it("supports Precision Edit only with the image-to-image reference contract", () => {
    const precisionInput: ImageGenerationFingerprintInput = {
      ...input,
      workflow: "precision-edit"
    };

    expect(
      buildImageGenerationRequestFingerprint(precisionInput)
    ).not.toEqual(buildImageGenerationRequestFingerprint(input));
    expect(() =>
      buildImageGenerationRequestFingerprint({
        ...precisionInput,
        referenceImageFingerprints: undefined
      })
    ).toThrow("INVALID_IMAGE_FINGERPRINT_INPUT");
  });

  it("keeps Transcript to Images text-only and workflow-scoped", () => {
    const transcriptInput: ImageGenerationFingerprintInput = {
      ...input,
      mode: "text-to-image",
      referenceImageFingerprints: undefined,
      workflow: "transcript-images"
    };

    expect(
      buildImageGenerationRequestFingerprint(transcriptInput)
    ).not.toEqual(buildImageGenerationRequestFingerprint(input));
    expect(() =>
      buildImageGenerationRequestFingerprint({
        ...transcriptInput,
        mode: "image-to-image"
      })
    ).toThrow("INVALID_IMAGE_FINGERPRINT_INPUT");
    expect(() =>
      buildImageGenerationRequestFingerprint({
        ...transcriptInput,
        referenceImageFingerprints: [referenceImageFingerprintA]
      })
    ).toThrow("INVALID_IMAGE_FINGERPRINT_INPUT");
  });

  it.each([2, 4] as const)(
    "rejects Transcript to Images count=%i in canonicalization",
    (count) => {
      const transcriptInput: ImageGenerationFingerprintInput = {
        ...input,
        mode: "text-to-image",
        referenceImageFingerprints: undefined,
        workflow: "transcript-images"
      };
      expect(() =>
        buildImageGenerationRequestFingerprint({
          ...transcriptInput,
          count
        })
      ).toThrow("INVALID_IMAGE_FINGERPRINT_INPUT");
    }
  );

  it.each(fingerprintVariationCases)(
    "changes the hash when $name changes",
    ({ mutate }) => {
      const changed = mutate(input);
    expect(
        buildImageGenerationRequestFingerprint(changed)
    ).not.toEqual(buildImageGenerationRequestFingerprint(input));
    }
  );

  it("omits optional undefined fields from the canonical object", () => {
    const canonical = JSON.parse(
      canonicalizeImageGenerationFingerprintInput({
        modelId: input.modelId,
        prompt: input.prompt,
        size: input.size,
        count: input.count,
        mode: "text-to-image"
      })
    ) as Record<string, unknown>;
    expect(Object.hasOwn(canonical, "imageSessionId")).toBe(false);
    expect(Object.hasOwn(canonical, "clientEntryId")).toBe(false);
    expect(Object.hasOwn(canonical, "imageSessionTitle")).toBe(false);
    expect(Object.hasOwn(canonical, "referenceImageFingerprint")).toBe(false);
    expect(Object.hasOwn(canonical, "referenceImageFingerprints")).toBe(false);
  });

  it.each([
    { imageSessionId: null },
    { clientEntryId: null },
    { imageSessionTitle: null },
    { referenceImageFingerprints: null },
    { referenceImageFingerprints: [] },
    { referenceImageFingerprints: Array.from({ length: 5 }, () => "a".repeat(64)) },
    { referenceImageFingerprints: ["A".repeat(64)] },
    { referenceImageFingerprints: ["a".repeat(63)] },
    { referenceImageFingerprints: [42] },
    { count: "1" },
    { size: 1024 },
    { mode: "image" }
  ])("rejects null, non-business scalar, and invalid fingerprint values", (change) => {
    expect(() =>
      canonicalizeImageGenerationFingerprintInput({ ...input, ...change } as never)
    ).toThrow("INVALID_IMAGE_FINGERPRINT_INPUT");
  });

  it("rejects internal provider fields instead of canonicalizing them", () => {
    expect(() =>
      canonicalizeImageGenerationFingerprintInput({
        ...input,
        providerAccountId: "provider-account"
      } as never)
    ).toThrow("INVALID_IMAGE_FINGERPRINT_INPUT");
  });

  it("returns the existing 32-byte request hash contract", () => {
    const fingerprint = buildImageGenerationRequestFingerprint(input);
    expect(Buffer.isBuffer(fingerprint)).toBe(true);
    expect(fingerprint).toHaveLength(32);
  });
});
