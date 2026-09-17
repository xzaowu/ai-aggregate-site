import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Derive a 32-byte key from PAYMENT_SETTINGS_SECRET using SHA-256.
 */
function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns "<iv_hex>:<authTag_hex>:<ciphertext_hex>".
 */
export function encryptPaymentSecret(
  plaintext: string,
  secret: string
): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a value produced by encryptPaymentSecret.
 * Returns null on any failure (wrong key, corrupted data, etc.).
 */
export function decryptPaymentSecret(
  encrypted: string,
  secret: string
): string | null {
  try {
    const parts = encrypted.split(":");

    if (parts.length !== 3) {
      return null;
    }

    const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
    const key = deriveKey(secret);
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      return null;
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH
    });

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final()
    ]);

    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
