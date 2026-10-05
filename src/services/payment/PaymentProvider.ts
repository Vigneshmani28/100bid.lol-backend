/**
 * Provider-agnostic payment abstraction. Business logic (bid/ownership
 * transitions) must never talk to a payment SDK directly — only to this
 * interface — so swapping Razorpay <-> Cashfree <-> anything else never
 * touches the transaction/ownership code.
 *
 * CRITICAL: the frontend's claim of "payment succeeded" is never trusted.
 * Only verifyPayment()/handleWebhook() — which check the provider's own
 * signature or server-to-server status — may mark a payment PAID.
 */

export interface CreatePaymentInput {
  bidId: string;
  amountCents: number;
  currency: string;
  receiptEmail: string;
  /**
   * DataFast's first-party visitor id (from the `datafast_visitor_id`
   * cookie), forwarded to the payment provider as checkout metadata so
   * DataFast's Dodo Payments webhook can attribute the eventual revenue back
   * to a marketing channel. Optional — absent for API callers with no
   * DataFast cookie (e.g. no consent, ad blocker, or DataFast not
   * configured).
   */
  datafastVisitorId?: string | null;
}

export interface CreatePaymentResult {
  providerOrderId: string;
  /** Opaque data the frontend needs to open the provider's checkout (key id, order id, etc). */
  clientPayload: Record<string, unknown>;
}

export type VerifiedPaymentStatus = "PAID" | "FAILED" | "PENDING";

export interface VerifyPaymentResult {
  status: VerifiedPaymentStatus;
  providerPaymentId: string | null;
  providerOrderId: string;
  amountCents: number;
}

export interface WebhookVerificationInput {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export interface PaymentProvider {
  readonly name: string;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /** Server-to-server check against the provider (polling fallback / manual verification). */
  verifyPayment(providerOrderId: string): Promise<VerifyPaymentResult>;

  /**
   * Verifies a webhook's authenticity (signature) and extracts the payment
   * result. Throws if the signature is invalid. This is the source of
   * truth for confirming a payment server-side.
   */
  handleWebhook(input: WebhookVerificationInput): Promise<VerifyPaymentResult>;
}
