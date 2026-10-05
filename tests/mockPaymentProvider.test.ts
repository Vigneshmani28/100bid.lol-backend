import { beforeEach, describe, expect, it } from "vitest";
import { MockPaymentProvider } from "../src/services/payment/MockPaymentProvider";

describe("MockPaymentProvider", () => {
  let provider: MockPaymentProvider;

  beforeEach(() => {
    provider = new MockPaymentProvider();
  });

  it("creates an order and later verifies a signed webhook for it", async () => {
    const created = await provider.createPayment({
      bidId: "bid-1",
      amountCents: 10100,
      currency: "USD",
      receiptEmail: "a@b.com",
    });

    expect(created.providerOrderId).toMatch(/^mock_order_/);

    const { payload, signature } = MockPaymentProvider.buildSignedWebhookBody(
      created.providerOrderId,
      "PAID",
    );

    const result = await provider.handleWebhook({
      rawBody: Buffer.from(payload),
      headers: { "x-mock-signature": signature },
    });

    expect(result.status).toBe("PAID");
    expect(result.providerOrderId).toBe(created.providerOrderId);
    expect(result.amountCents).toBe(10100);
  });

  it("rejects a webhook with an invalid signature", async () => {
    const created = await provider.createPayment({
      bidId: "bid-1",
      amountCents: 10100,
      currency: "USD",
      receiptEmail: "a@b.com",
    });

    const { payload } = MockPaymentProvider.buildSignedWebhookBody(created.providerOrderId, "PAID");

    await expect(
      provider.handleWebhook({
        rawBody: Buffer.from(payload),
        headers: { "x-mock-signature": "not-the-real-signature" },
      }),
    ).rejects.toThrow(/signature/i);
  });

  it("rejects a webhook with no signature header at all", async () => {
    const created = await provider.createPayment({
      bidId: "bid-1",
      amountCents: 10100,
      currency: "USD",
      receiptEmail: "a@b.com",
    });
    const { payload } = MockPaymentProvider.buildSignedWebhookBody(created.providerOrderId, "PAID");

    await expect(
      provider.handleWebhook({ rawBody: Buffer.from(payload), headers: {} }),
    ).rejects.toThrow(/signature/i);
  });

  it("rejects a webhook whose payload was tampered with after signing", async () => {
    const created = await provider.createPayment({
      bidId: "bid-1",
      amountCents: 10100,
      currency: "USD",
      receiptEmail: "a@b.com",
    });
    const { payload, signature } = MockPaymentProvider.buildSignedWebhookBody(
      created.providerOrderId,
      "PAID",
    );
    const tampered = payload.replace('"status":"PAID"', '"status":"FAILED"');

    await expect(
      provider.handleWebhook({ rawBody: Buffer.from(tampered), headers: { "x-mock-signature": signature } }),
    ).rejects.toThrow(/signature/i);
  });

  it("throws for a webhook referencing an unknown order", async () => {
    const { payload, signature } = MockPaymentProvider.buildSignedWebhookBody("mock_order_unknown", "PAID");

    await expect(
      provider.handleWebhook({ rawBody: Buffer.from(payload), headers: { "x-mock-signature": signature } }),
    ).rejects.toThrow(/unknown/i);
  });
});
