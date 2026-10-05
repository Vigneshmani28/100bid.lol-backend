import crypto from "node:crypto";
import { env } from "../../config/env";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  VerifyPaymentResult,
  WebhookVerificationInput,
} from "./PaymentProvider";

/**
 * Razorpay implementation of the PaymentProvider abstraction.
 *
 * Requires RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET.
 * Order creation calls Razorpay's REST API directly (no SDK dependency
 * needed for this surface area). Webhook verification implements Razorpay's
 * documented HMAC-SHA256 signature scheme — this is the server-side source
 * of truth for payment confirmation; the frontend's checkout callback is
 * never trusted on its own.
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = "razorpay";

  private requireCredentials() {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      throw new Error(
        "Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, " +
          "or set PAYMENT_PROVIDER=mock for local development.",
      );
    }
    return { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const { keyId, keySecret } = this.requireCredentials();

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        amount: input.amountCents,
        currency: input.currency,
        receipt: input.bidId,
        notes: { bidId: input.bidId, email: input.receiptEmail },
      }),
    });

    if (!response.ok) {
      throw new Error(`Razorpay order creation failed: ${response.status}`);
    }

    const order = (await response.json()) as { id: string };

    return {
      providerOrderId: order.id,
      clientPayload: {
        provider: "razorpay",
        keyId,
        orderId: order.id,
        amount: input.amountCents,
        currency: input.currency,
      },
    };
  }

  async verifyPayment(providerOrderId: string): Promise<VerifyPaymentResult> {
    const { keyId, keySecret } = this.requireCredentials();

    const response = await fetch(`https://api.razorpay.com/v1/orders/${providerOrderId}/payments`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      },
    });

    if (!response.ok) {
      return { status: "PENDING", providerPaymentId: null, providerOrderId, amountCents: 0 };
    }

    const data = (await response.json()) as {
      items: Array<{ id: string; status: string; amount: number }>;
    };

    const captured = data.items.find((p) => p.status === "captured");
    if (captured) {
      return {
        status: "PAID",
        providerPaymentId: captured.id,
        providerOrderId,
        amountCents: captured.amount,
      };
    }

    const failed = data.items.find((p) => p.status === "failed");
    if (failed) {
      return { status: "FAILED", providerPaymentId: failed.id, providerOrderId, amountCents: failed.amount };
    }

    return { status: "PENDING", providerPaymentId: null, providerOrderId, amountCents: 0 };
  }

  async handleWebhook(input: WebhookVerificationInput): Promise<VerifyPaymentResult> {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      throw new Error("RAZORPAY_WEBHOOK_SECRET is not configured");
    }

    const signature = input.headers["x-razorpay-signature"];
    if (!signature || Array.isArray(signature)) {
      throw new Error("Missing Razorpay webhook signature");
    }

    const expected = crypto
      .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
      .update(input.rawBody)
      .digest("hex");

    const valid =
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

    if (!valid) {
      throw new Error("Invalid Razorpay webhook signature");
    }

    const event = JSON.parse(input.rawBody.toString("utf-8")) as {
      event: string;
      payload: {
        payment: {
          entity: { id: string; order_id: string; amount: number; status: string };
        };
      };
    };

    const payment = event.payload.payment.entity;
    const status =
      event.event === "payment.captured"
        ? "PAID"
        : event.event === "payment.failed"
          ? "FAILED"
          : "PENDING";

    return {
      status,
      providerPaymentId: payment.id,
      providerOrderId: payment.order_id,
      amountCents: payment.amount,
    };
  }
}
