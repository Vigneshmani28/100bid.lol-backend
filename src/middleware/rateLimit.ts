import rateLimit from "express-rate-limit";

/** General API traffic. */
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
});

/** Metadata fetching is expensive (outbound requests) and abusable for SSRF probing. */
export const metadataLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many preview requests. Please wait a moment." } },
});

/** Bidding + payment creation — tighter limit, keyed by IP by default. */
export const bidLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many bid attempts. Please wait a moment." } },
});

/** Management link + report endpoints. */
export const lightLimiter = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a moment." } },
});

/** Image uploads — writes to disk, so kept tighter than general traffic. */
export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: "RATE_LIMITED", message: "Too many uploads. Please wait a moment." } },
});
