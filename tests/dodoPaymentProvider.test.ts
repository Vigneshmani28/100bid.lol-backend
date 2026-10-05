import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Webhook } from "standardwebhooks";

vi.mock("../src/config/env", () => ({
  env: {
    APP_URL: "https://100bid.lol",
    DODO_MODE: "test",
    DODO_API_KEY: "dodo_test_key",
    DODO_PRODUCT_ID: "pdt_wall_bid",
    DODO_WEBHOOK_SECRET: "whsec_dGVzdHNlY3JldHRlc3RzZWNyZXR0ZXN0c2U=",
  },
}));

import { DodoPaymentProvider } from "../src/services/payment/DodoPaymentProvider";

const provider = new DodoPaymentProvider();

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("DodoPaymentProvider.createPayment", () => {
  it("creates a test-mode checkout session with the bid amount as the PWYW price", async () => {
    const fetchMock = stubFetch({
      session_id: "cks_abc123",
      checkout_url: "https://checkout.dodopayments.com/cks_abc123",
    });

    const result = await provider.createPayment({
      bidId: "bid-1",
      amountCents: 25000,
      currency: "USD",
      receiptEmail: "bidder@example.com",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://test.dodopayments.com/checkouts");
    expect(init.headers.authorization).toBe("Bearer dodo_test_key");

    const body = JSON.parse(init.body);
    // The amount must ride on the cart item — this is the only way to charge
    // a per-bid price against a single catalog product.
    expect(body.product_cart).toEqual([
      { product_id: "pdt_wall_bid", quantity: 1, amount: 25000 },
    ]);
    expect(body.billing_currency).toBe("USD");
    expect(body.customer).toEqual({ email: "bidder@example.com" });
    expect(body.metadata).toEqual({ bidId: "bid-1" });
    expect(body.return_url).toBe("https://100bid.lol/?bid=bid-1");

    expect(result.providerOrderId).toBe("cks_abc123");
    expect(result.clientPayload.checkoutUrl).toBe("https://checkout.dodopayments.com/cks_abc123");
  });

  it("throws when Dodo rejects the session", async () => {
    stubFetch({ message: "bad product" }, false, 422);
    await expect(
      provider.createPayment({
        bidId: "bid-1",
        amountCents: 100,
        currency: "USD",
        receiptEmail: "a@b.com",
      }),
    ).rejects.toThrow(/422/);
  });
});

describe("DodoPaymentProvider.verifyPayment", () => {
  it("maps a succeeded session to PAID", async () => {
    stubFetch({ payment_id: "pay_1", payment_status: "succeeded" });
    const result = await provider.verifyPayment("cks_abc123");
    expect(result).toMatchObject({ status: "PAID", providerPaymentId: "pay_1" });
  });

  it("treats a session still collecting details as PENDING", async () => {
    stubFetch({ payment_id: null, payment_status: null });
    const result = await provider.verifyPayment("cks_abc123");
    expect(result.status).toBe("PENDING");
  });
});

describe("DodoPaymentProvider.handleWebhook", () => {
  const secret = "whsec_dGVzdHNlY3JldHRlc3RzZWNyZXR0ZXN0c2U=";

  function signed(payload: unknown) {
    const body = JSON.stringify(payload);
    const webhookId = "whk_1";
    const timestamp = new Date();
    const signature = new Webhook(secret).sign(webhookId, timestamp, body);
    return {
      rawBody: Buffer.from(body, "utf-8"),
      headers: {
        "webhook-id": webhookId,
        "webhook-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
        "webhook-signature": signature,
      },
    };
  }

  it("maps payment.succeeded back to the checkout session we stored", async () => {
    const result = await provider.handleWebhook(
      signed({
        type: "payment.succeeded",
        data: {
          payment_id: "pay_1",
          checkout_session_id: "cks_abc123",
          total_amount: 25000,
          metadata: { bidId: "bid-1" },
        },
      }),
    );

    expect(result).toEqual({
      status: "PAID",
      providerPaymentId: "pay_1",
      providerOrderId: "cks_abc123",
      amountCents: 25000,
    });
  });

  it("falls back to the bidId in metadata when no session id is present", async () => {
    const result = await provider.handleWebhook(
      signed({
        type: "payment.succeeded",
        data: { payment_id: "pay_1", checkout_session_id: null, metadata: { bidId: "bid-1" } },
      }),
    );

    expect(result.providerOrderId).toBe("bid-1");
  });

  it("maps payment.failed and payment.cancelled to FAILED", async () => {
    for (const type of ["payment.failed", "payment.cancelled"]) {
      const result = await provider.handleWebhook(
        signed({ type, data: { payment_id: "pay_1", checkout_session_id: "cks_abc123" } }),
      );
      expect(result.status).toBe("FAILED");
    }
  });

  it("keeps an in-flight payment PENDING so no slot is awarded early", async () => {
    const result = await provider.handleWebhook(
      signed({
        type: "payment.processing",
        data: { payment_id: "pay_1", checkout_session_id: "cks_abc123" },
      }),
    );
    expect(result.status).toBe("PENDING");
  });

  it("rejects a payload whose signature doesn't match", async () => {
    const input = signed({
      type: "payment.succeeded",
      data: { payment_id: "pay_1", checkout_session_id: "cks_abc123" },
    });
    // Tamper with the body after signing — the classic forged-webhook case.
    const tampered = {
      ...input,
      rawBody: Buffer.from(
        JSON.stringify({
          type: "payment.succeeded",
          data: { payment_id: "pay_evil", checkout_session_id: "cks_evil" },
        }),
        "utf-8",
      ),
    };

    await expect(provider.handleWebhook(tampered)).rejects.toThrow();
  });
});
