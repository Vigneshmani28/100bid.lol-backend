import { Webhook } from "standardwebhooks";
import { env } from "../../config/env";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  VerifiedPaymentStatus,
  VerifyPaymentResult,
  WebhookVerificationInput,
} from "./PaymentProvider";

/**
 * Dodo Payments implementation of the PaymentProvider abstraction.
 *
 * Uses Checkout Sessions (`POST /checkouts`) rather than the older
 * `POST /payments` link endpoint, which Dodo has deprecated. We create a
 * session server-side and hand the frontend the hosted `checkout_url` to
 * redirect to.
 *
 * Two Dodo-specific details shape this file:
 *
 * 1. Dodo prices against a *product*, not an arbitrary amount. A wall bid is
 *    a different amount every time, so DODO_PRODUCT_ID must point at a
 *    one-time product with "Pay What You Want" enabled; `product_cart[].amount`
 *    then overrides the price per session. Without PWYW on that product Dodo
 *    silently ignores `amount` and charges the product's list price — see the
 *    setup notes in the README.
 *
 * 2. A checkout session and a payment are different objects. We store the
 *    session id as `providerOrderId` (it is what we know at creation time),
 *    and map back from the webhook via the payment's `checkout_session_id`.
 *    `metadata.bidId` is sent as a belt-and-braces fallback, since that field
 *    is nullable in Dodo's schema.
 *
 * Webhooks follow the Standard Webhooks spec, verified with the same library
 * Dodo's own docs use. As with every provider here, only a verified webhook
 * may mark a payment PAID — the browser's return_url redirect is never
 * trusted, because a customer who closes the tab never triggers it.
 */
export class DodoPaymentProvider implements PaymentProvider {
  readonly name = "dodo";

  private get baseUrl() {
    return env.DODO_MODE === "live"
      ? "https://live.dodopayments.com"
      : "https://test.dodopayments.com";
  }

  private requireConfig() {
    if (!env.DODO_API_KEY || !env.DODO_PRODUCT_ID) {
      throw new Error(
        "Dodo Payments is not configured. Set DODO_API_KEY and DODO_PRODUCT_ID " +
          "(a one-time product with Pay What You Want enabled), or set " +
          "PAYMENT_PROVIDER=mock for local development.",
      );
    }
    return { apiKey: env.DODO_API_KEY, productId: env.DODO_PRODUCT_ID };
  }

  private async call(path: string, init?: RequestInit) {
    const { apiKey } = this.requireConfig();
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...init?.headers,
      },
    });
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const { productId } = this.requireConfig();

    const response = await this.call("/checkouts", {
      method: "POST",
      body: JSON.stringify({
        product_cart: [
          {
            product_id: productId,
            quantity: 1,
            // Lowest denomination (cents), matching how bids are stored.
            // Only honoured on a Pay What You Want product.
            amount: input.amountCents,
          },
        ],
        customer: { email: input.receiptEmail },
        minimal_address: true,
        // Pinning the currency explicitly matters: left unset, Dodo infers it
        // from the customer's IP (Adaptive Currency) and could charge a
        // different currency than the bid was placed in.
        billing_currency: input.currency,
        return_url: `${env.APP_URL.replace(/\/$/, "")}/?bid=${input.bidId}`,
        // Sent back here on an explicit back-out from Dodo's hosted checkout
        // (without this, Dodo hides the back button entirely). Same `?bid=`
        // route as return_url, but tagged `checkout=cancelled` so the
        // frontend can show an immediate "you cancelled" screen instead of
        // its usual "confirming with the payment provider" waiting state —
        // no payment was ever attempted, so there's nothing to poll for.
        cancel_url: `${env.APP_URL.replace(/\/$/, "")}/?bid=${input.bidId}&checkout=cancelled`,
        // `datafast_visitor_id` lets DataFast's Dodo Payments webhook (set up
        // in the DataFast dashboard: Developer → Webhooks → Dodo Payments)
        // attribute this payment back to the marketing channel that brought
        // the visitor in. Omitted entirely when we have no cookie for them,
        // rather than sent as an empty string.
        metadata: {
          bidId: input.bidId,
          ...(input.datafastVisitorId
            ? { datafast_visitor_id: input.datafastVisitorId }
            : {}),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Dodo checkout session creation failed: ${response.status} ${await response.text()}`,
      );
    }

    const session = (await response.json()) as {
      session_id: string;
      checkout_url?: string | null;
    };

    if (!session.checkout_url) {
      throw new Error("Dodo returned a checkout session with no checkout_url.");
    }

    return {
      providerOrderId: session.session_id,
      clientPayload: {
        provider: "dodo",
        sessionId: session.session_id,
        // The frontend redirects the browser here. Single-use, and the
        // session expires after 24h — a new attempt creates a new session.
        checkoutUrl: session.checkout_url,
        amountCents: input.amountCents,
        currency: input.currency,
      },
    };
  }

  async verifyPayment(providerOrderId: string): Promise<VerifyPaymentResult> {
    const response = await this.call(`/checkouts/${providerOrderId}`);

    if (!response.ok) {
      return { status: "PENDING", providerPaymentId: null, providerOrderId, amountCents: 0 };
    }

    const session = (await response.json()) as {
      payment_id?: string | null;
      payment_status?: string | null;
    };

    return {
      status: mapIntentStatus(session.payment_status),
      providerPaymentId: session.payment_id ?? null,
      providerOrderId,
      // The session status endpoint doesn't echo the amount. The bid's own
      // amount is authoritative for winning the slot anyway, and callers use
      // this field only for reconciliation.
      amountCents: 0,
    };
  }

  async handleWebhook(input: WebhookVerificationInput): Promise<VerifyPaymentResult> {
    if (!env.DODO_WEBHOOK_SECRET) {
      throw new Error("DODO_WEBHOOK_SECRET is not configured");
    }

    const webhook = new Webhook(env.DODO_WEBHOOK_SECRET);
    const rawBody = input.rawBody.toString("utf-8");

    // Throws on a bad signature or a timestamp outside the allowed window.
    webhook.verify(rawBody, {
      "webhook-id": headerValue(input.headers, "webhook-id"),
      "webhook-signature": headerValue(input.headers, "webhook-signature"),
      "webhook-timestamp": headerValue(input.headers, "webhook-timestamp"),
    });

    const event = JSON.parse(rawBody) as {
      type: string;
      data: {
        payment_id?: string;
        checkout_session_id?: string | null;
        status?: string | null;
        total_amount?: number | null;
        metadata?: Record<string, string> | null;
      };
    };

    // `checkout_session_id` is what we stored as providerOrderId. It is
    // nullable in Dodo's schema (a payment made outside a session has none),
    // so fall back to the bidId we attached as metadata.
    const providerOrderId = event.data.checkout_session_id ?? event.data.metadata?.bidId;
    if (!providerOrderId) {
      throw new Error(`Dodo webhook ${event.type} has no checkout session or bid reference.`);
    }

    return {
      status: mapEventType(event.type, event.data.status),
      providerPaymentId: event.data.payment_id ?? null,
      providerOrderId,
      amountCents: event.data.total_amount ?? 0,
    };
  }
}

function headerValue(headers: WebhookVerificationInput["headers"], name: string): string {
  const value = headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

/**
 * Dodo's event types are the authority on a payment's outcome; the embedded
 * `status` is only consulted for event types we don't explicitly know about.
 * Anything not clearly terminal stays PENDING so the slot is never awarded
 * (or released) on an in-flight payment.
 */
function mapEventType(type: string, status?: string | null): VerifiedPaymentStatus {
  switch (type) {
    case "payment.succeeded":
      return "PAID";
    case "payment.failed":
    case "payment.cancelled":
      return "FAILED";
    case "payment.processing":
      return "PENDING";
    default:
      return mapIntentStatus(status);
  }
}

/** Maps Dodo's IntentStatus enum onto our three-state payment result. */
function mapIntentStatus(status?: string | null): VerifiedPaymentStatus {
  switch (status) {
    case "succeeded":
      return "PAID";
    case "failed":
    case "cancelled":
      return "FAILED";
    default:
      return "PENDING";
  }
}
