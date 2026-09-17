import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

interface JwtPayload {
  sub: string;
  sv: number;
  exp: number;
}

export type PasswordValidationResult =
  | "VALID"
  | "INVALID_TYPE"
  | "TOO_SHORT"
  | "TOO_LONG";

const DUMMY_BCRYPT_HASH =
  "$2b$12$3Qf.0K0PHS66gDEWF8Gsb.qaTO3WSLvCl4k59mjZrPhaLY/sJIZEC";

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64url");
}

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(JSON.stringify(value));
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBase64UrlSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function parseJwtSegment(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8")
    );
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function validatePasswordForSet(
  password: unknown
): PasswordValidationResult {
  if (typeof password !== "string") {
    return "INVALID_TYPE";
  }

  if (Array.from(password).length < 8) {
    return "TOO_SHORT";
  }

  if (Buffer.byteLength(password, "utf8") > 72) {
    return "TOO_LONG";
  }

  return "VALID";
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPasswordWithTimingProtection(
  password: string,
  passwordHashOrNull: string | null
): Promise<boolean> {
  try {
    const isMatch = await bcrypt.compare(
      password,
      passwordHashOrNull ?? DUMMY_BCRYPT_HASH
    );
    return passwordHashOrNull === null ? false : isMatch;
  } catch {
    throw new Error("PASSWORD_COMPARISON_FAILED");
  }
}

export function createJwt(
  userId: string,
  sessionVersion: number,
  secret: string
): string {
  if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 0) {
    throw new TypeError("sessionVersion must be a non-negative safe integer");
  }

  if (!secret.trim()) {
    throw new Error("JWT_SECRET is required");
  }

  const header = base64UrlJson({
    alg: "HS256",
    typ: "JWT"
  });
  const payload = base64UrlJson({
    sub: userId,
    sv: sessionVersion,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
  } satisfies JwtPayload);
  const unsigned = `${header}.${payload}`;

  return `${unsigned}.${sign(unsigned, secret)}`;
}

export function verifyJwt(
  token: string,
  secret: string
): { userId: string; sessionVersion: number } | null {
  if (!secret.trim()) {
    throw new Error("JWT_SECRET is required");
  }

  if (typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts;

  if (!header || !payload || !signature) {
    return null;
  }

  if (
    !isBase64UrlSegment(header) ||
    !isBase64UrlSegment(payload) ||
    !isBase64UrlSegment(signature)
  ) {
    return null;
  }

  const expected = sign(`${header}.${payload}`, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  const parsedHeader = parseJwtSegment(header);
  const parsedPayload = parseJwtSegment(payload);
  const userId = parsedPayload?.sub;
  const expiresAt = parsedPayload?.exp;
  const sessionVersion = parsedPayload?.sv;

  if (
    parsedHeader?.alg !== "HS256" ||
    !parsedPayload ||
    typeof userId !== "string" ||
    userId.length === 0 ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    typeof sessionVersion !== "number" ||
    !Number.isSafeInteger(sessionVersion) ||
    sessionVersion < 0
  ) {
    return null;
  }

  return {
    userId,
    sessionVersion
  };
}
