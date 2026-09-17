import { isIP } from "node:net";
import type { FastifyServerOptions } from "fastify";

const namedProxyRanges = new Set(["loopback", "linklocal", "uniquelocal"]);
const forbiddenRanges = new Set(["0.0.0.0/0", "::/0"]);

function isValidCidr(value: string): boolean {
  const separator = value.lastIndexOf("/");
  if (separator <= 0) return false;

  const address = value.slice(0, separator);
  const prefixText = value.slice(separator + 1);
  if (!/^\d+$/.test(prefixText)) return false;

  const family = isIP(address);
  const prefix = Number(prefixText);
  return family === 4
    ? prefix >= 0 && prefix <= 32
    : family === 6 && prefix >= 0 && prefix <= 128;
}

export function resolveTrustProxy(
  rawValue: string | undefined
): FastifyServerOptions["trustProxy"] {
  if (!rawValue?.trim()) return false;

  const values = rawValue
    .split(",")
    .map((value) => value.trim().toLowerCase());

  if (
    values.some(
      (value) =>
        !value ||
        value === "true" ||
        value === "*" ||
        forbiddenRanges.has(value) ||
        (!namedProxyRanges.has(value) && !isIP(value) && !isValidCidr(value))
    )
  ) {
    throw new Error("TRUST_PROXY contains an unsafe or invalid value");
  }

  return [...new Set(values)];
}
