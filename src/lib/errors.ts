export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "SLOT_NOT_FOUND"
  | "BID_TOO_LOW"
  | "SLOT_ALREADY_TAKEN"
  | "SLOT_RESERVED"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_ALREADY_PROCESSED"
  | "PAYMENT_VERIFICATION_FAILED"
  | "BID_EXPIRED"
  | "METADATA_FETCH_FAILED"
  | "UNSAFE_URL"
  | "MANAGEMENT_TOKEN_INVALID"
  | "MANAGEMENT_TOKEN_EXPIRED"
  | "ADMIN_UNAUTHORIZED"
  | "DATAFAST_REQUEST_FAILED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  SLOT_NOT_FOUND: 404,
  BID_TOO_LOW: 409,
  SLOT_ALREADY_TAKEN: 409,
  SLOT_RESERVED: 409,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_ALREADY_PROCESSED: 409,
  PAYMENT_VERIFICATION_FAILED: 402,
  BID_EXPIRED: 410,
  METADATA_FETCH_FAILED: 422,
  UNSAFE_URL: 400,
  MANAGEMENT_TOKEN_INVALID: 401,
  MANAGEMENT_TOKEN_EXPIRED: 401,
  ADMIN_UNAUTHORIZED: 401,
  DATAFAST_REQUEST_FAILED: 502,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

/** A well-formed, user-safe API error. Never leaks internal details. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
