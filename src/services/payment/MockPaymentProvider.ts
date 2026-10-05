import crypto from "node:crypto";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  VerifyPaymentResult,
  WebhookVerificationInput,
} from "./PaymentProvider";

/**
 * Local-development payment provider. Simulates a real provider's flow
 * (create order -> client "pays" -> webhook confirms) without any external
 * dependency, so the app is fully runnable without payment credentials.
 *
 * The mock "signs" its own webhook payloads with an HMAC using a fixed dev
 * secret, and handleWebhook() verifies that signature exactly like a real
 * provider integration would — so the security shape of the code matches
 * production even though the flow is simulated.
 */

const MOCK_WEBHOOK_SECRET = "dev-mock-webhook-secret";

// In-memory order book. Fine for local dev; a real provider holds this state.
const orders = new Map<string, { amountCents: number; bidId: string }>();

function sign(payload: string): string {
  return crypto.createHmac("sha256", MOCK_WEBHOOK_SECRET).update(payload).digest("hex");
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerOrderId = `mock_order_${crypto.randomUUID()}`;
    orders.set(providerOrderId, { amountCents: input.amountCents, bidId: input.bidId });

    return {
      providerOrderId,
      clientPayload: {
        provider: "mock",
        orderId: providerOrderId,
        amount: input.amountCents,
        currency: input.currency,
        // The dev checkout page calls POST /api/payments/mock/:orderId/complete
        // which synthesizes a signed webhook, mirroring how a real checkout
        // redirects into the provider's own confirmation step.
      },
    };
  }

  async verifyPayment(providerOrderId: string): Promise<VerifyPaymentResult> {
    const order = orders.get(providerOrderId);
    if (!order) {
      return { status: "FAILED", providerPaymentId: null, providerOrderId, amountCents: 0 };
    }
    return {
      status: "PENDING",
      providerPaymentId: null,
      providerOrderId,
      amountCents: order.amountCents,
    };
  }

  async handleWebhook(input: WebhookVerificationInput): Promise<VerifyPaymentResult> {
    const signature = input.headers["x-mock-signature"];
    const payload = input.rawBody.toString("utf-8");

    if (!signature || Array.isArray(signature) || sign(payload) !== signature) {
      throw new Error("Invalid mock webhook signature");
    }

    const body = JSON.parse(payload) as {
      providerOrderId: string;
      status: "PAID" | "FAILED";
      providerPaymentId: string;
    };

    const order = orders.get(body.providerOrderId);
    if (!order) throw new Error("Unknown mock order");

    return {
      status: body.status,
      providerPaymentId: body.providerPaymentId,
      providerOrderId: body.providerOrderId,
      amountCents: order.amountCents,
    };
  }

  /** Test/dev helper: builds a validly-signed webhook body for a successful payment. */
  static buildSignedWebhookBody(providerOrderId: string, status: "PAID" | "FAILED") {
    const body = {
      providerOrderId,
      status,
      providerPaymentId: `mock_pay_${crypto.randomUUID()}`,
    };
    const payload = JSON.stringify(body);
    return { payload, signature: sign(payload) };
  }
}
