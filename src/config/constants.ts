import { env } from "./env";

/**
 * Global product constants. Never hardcode these values elsewhere.
 */

/** There are exactly this many advertising spots, numbered 1..TOTAL_SLOTS. */
export const TOTAL_SLOTS = 100;

/** Minimum starting bid for an empty slot, in cents. $1 = 100 cents. */
export const MINIMUM_BID_CENTS = 100;

/** Smallest allowed increment above the current bid, in cents. $1 = 100 cents. */
export const MINIMUM_BID_INCREMENT_CENTS = 100;

export const CURRENCY = "USD" as const;

/**
 * How long an unpaid bid attempt is allowed to exclusively hold its
 * "reservation" on a slot — seat-booking style: while active, no one else
 * can prepare a competing bid for the same slot. Configurable via
 * BID_RESERVATION_WINDOW_MINUTES, defaults to 5 minutes.
 */
export const BID_PAYMENT_WINDOW_MINUTES = env.BID_RESERVATION_WINDOW_MINUTES;

/** How long a management token remains valid before it must be refreshed. */
export const MANAGEMENT_TOKEN_TTL_DAYS = 30;

/** Metadata fetcher limits. */
export const METADATA_FETCH_TIMEOUT_MS = 8_000;
export const METADATA_MAX_REDIRECTS = 5;
export const METADATA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB of HTML
export const METADATA_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB image cap

export const MANAGEMENT_TOKEN_BYTES = 32;

/** Uploaded ad-image limits. */
export const UPLOAD_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
export const UPLOADS_DIR_NAME = "uploads";
