export * from "./types";
export * from "./config";
export * from "./in-memory-rate-limiter";
export * from "./redis-rate-limiter";

/** Central rate-limit policies. Route-specific identity semantics are defined by their callers. */
export const RATE_LIMITS = {
  login: { limit: 20, windowMs: 15 * 60 * 1000 },
  register: { limit: 5, windowMs: 30 * 60 * 1000 },
  chatLoggedIn: { limit: 60, windowMs: 10 * 60 * 1000 },
  chatGuest: { limit: 20, windowMs: 10 * 60 * 1000 },
  ordersCreate: { limit: 20, windowMs: 10 * 60 * 1000 },
  orderPay: { limit: 30, windowMs: 10 * 60 * 1000 },
  feedback: { limit: 5, windowMs: 30 * 60 * 1000 },
  setupConfigure: { limit: 10, windowMs: 30 * 60 * 1000 }
} as const;
