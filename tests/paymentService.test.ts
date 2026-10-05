import { beforeEach, describe, expect, it, vi } from "vitest";

const { txMock, prismaMock, issueManagementTokenMock, sendOwnershipConfirmationMock } = vi.hoisted(() => {
  const txMock = {
    $queryRaw: vi.fn(),
    slot: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    bid: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    payment: { update: vi.fn() },
    ownershipHistory: { updateMany: vi.fn(), create: vi.fn() },
    advertisement: { update: vi.fn() },
  };

  const prismaMock = {
    bid: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    payment: { findUnique: vi.fn(), update: vi.fn() },
    slot: { findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  };

  return {
    txMock,
    prismaMock,
    issueManagementTokenMock: vi.fn(),
    sendOwnershipConfirmationMock: vi.fn(),
  };
});

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/services/managementTokenService", () => ({
  issueManagementToken: issueManagementTokenMock,
}));
vi.mock("../src/services/emailService", () => ({
  emailService: { sendOwnershipConfirmation: sendOwnershipConfirmationMock },
}));

import { confirmPaymentResult } from "../src/services/paymentService";

function basePayment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "payment-1",
    bidId: "bid-1",
    status: "CREATED",
    bid: {
      id: "bid-1",
      slotId: "slot-1",
      advertiserId: "adv-1",
      advertisementId: "ad-1",
      amount: 10100,
      status: "PENDING",
      slot: { id: "slot-1", number: 5, currentBidAmount: 10000 },
      advertiser: { id: "adv-1", email: "a@b.com" },
      advertisement: { id: "ad-1", brandName: "Brand Co" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: typeof txMock) => Promise<unknown>)(txMock);
  });
});

describe("confirmPaymentResult", () => {
  it("throws PAYMENT_NOT_FOUND for an unknown provider order id", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null);

    await expect(
      confirmPaymentResult({
        status: "PAID",
        providerPaymentId: "pay_1",
        providerOrderId: "order_unknown",
        amountCents: 100,
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND" });
  });

  it("is idempotent: a payment already PAID or FAILED is not reprocessed", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(
      basePayment({ status: "PAID", bid: { ...basePayment().bid, status: "PAID" } }),
    );

    const result = await confirmPaymentResult({
      status: "PAID",
      providerPaymentId: "pay_1",
      providerOrderId: "order_1",
      amountCents: 10100,
    });

    expect(result).toEqual({ alreadyProcessed: true, won: true });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("marks payment and bid FAILED without touching ownership when the provider reports FAILED", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(basePayment());

    const result = await confirmPaymentResult({
      status: "FAILED",
      providerPaymentId: "pay_1",
      providerOrderId: "order_1",
      amountCents: 10100,
    });

    expect(result).toEqual({ alreadyProcessed: false, won: false });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    expect(prismaMock.bid.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } }),
    );
    expect(txMock.slot.update).not.toHaveBeenCalled();
    expect(txMock.ownershipHistory.create).not.toHaveBeenCalled();
  });

  it("records a PENDING provider status without changing ownership", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(basePayment());

    const result = await confirmPaymentResult({
      status: "PENDING",
      providerPaymentId: null,
      providerOrderId: "order_1",
      amountCents: 10100,
    });

    expect(result).toEqual({ alreadyProcessed: false, won: false });
    expect(txMock.slot.update).not.toHaveBeenCalled();
  });

  it("marks a PAID-but-outraced bid FAILED and leaves ownership untouched (no automatic refund)", async () => {
    const payment = basePayment();
    prismaMock.payment.findUnique.mockResolvedValue(payment);

    // Someone else already won the slot at a higher price while this payment was in flight.
    txMock.slot.findUniqueOrThrow.mockResolvedValue({ id: "slot-1", currentBidAmount: 20000 });
    txMock.bid.findUniqueOrThrow.mockResolvedValue({ id: "bid-1", status: "PENDING", amount: 10100 });

    const result = await confirmPaymentResult({
      status: "PAID",
      providerPaymentId: "pay_1",
      providerOrderId: "order_1",
      amountCents: 10100,
    });

    expect(result.won).toBe(false);
    expect(txMock.bid.update).toHaveBeenCalledWith({ where: { id: "bid-1" }, data: { status: "FAILED" } });
    expect(txMock.slot.update).not.toHaveBeenCalled();
    expect(txMock.ownershipHistory.create).not.toHaveBeenCalled();
    expect(sendOwnershipConfirmationMock).not.toHaveBeenCalled();
  });

  it("does nothing further when the bid was already resolved by the time payment confirms", async () => {
    const payment = basePayment();
    prismaMock.payment.findUnique.mockResolvedValue(payment);

    txMock.slot.findUniqueOrThrow.mockResolvedValue({ id: "slot-1", currentBidAmount: 10000 });
    txMock.bid.findUniqueOrThrow.mockResolvedValue({ id: "bid-1", status: "EXPIRED", amount: 10100 });

    const result = await confirmPaymentResult({
      status: "PAID",
      providerPaymentId: "pay_1",
      providerOrderId: "order_1",
      amountCents: 10100,
    });

    expect(result.won).toBe(false);
    expect(txMock.bid.update).not.toHaveBeenCalled();
    expect(txMock.slot.update).not.toHaveBeenCalled();
  });

  it("transfers slot ownership, closes prior history, and issues a management link on a winning PAID payment", async () => {
    const payment = basePayment();
    prismaMock.payment.findUnique.mockResolvedValue(payment);

    txMock.slot.findUniqueOrThrow.mockResolvedValue({ id: "slot-1", currentBidAmount: 10000 });
    txMock.bid.findUniqueOrThrow.mockResolvedValue({ id: "bid-1", status: "PENDING", amount: 10100 });
    prismaMock.bid.findUniqueOrThrow.mockResolvedValue({ id: "bid-1", advertiserId: "adv-1", slotId: "slot-1" });
    issueManagementTokenMock.mockResolvedValue("raw-token-abc");
    prismaMock.slot.findUniqueOrThrow.mockResolvedValue({ id: "slot-1", number: 5 });

    const result = await confirmPaymentResult({
      status: "PAID",
      providerPaymentId: "pay_1",
      providerOrderId: "order_1",
      amountCents: 10100,
    });

    expect(result.won).toBe(true);

    // Row lock acquired before reading fresh state.
    expect(txMock.$queryRaw).toHaveBeenCalled();

    // Previous open ownership period closed, new one opened.
    expect(txMock.ownershipHistory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slotId: "slot-1", endedAt: null }, data: { endedAt: expect.any(Date) } }),
    );
    expect(txMock.ownershipHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slotId: "slot-1", advertiserId: "adv-1", amount: 10100, endedAt: null }),
      }),
    );

    expect(txMock.slot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentAdvertiserId: "adv-1",
          currentAdId: "ad-1",
          currentBidAmount: 10100,
        }),
      }),
    );
    expect(txMock.advertisement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ACTIVE" } }),
    );
    expect(txMock.bid.update).toHaveBeenCalledWith({ where: { id: "bid-1" }, data: { status: "PAID" } });

    expect(issueManagementTokenMock).toHaveBeenCalledWith("adv-1", "slot-1");
    expect(sendOwnershipConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@b.com",
        brandName: "Brand Co",
        slotNumber: 5,
        amountCents: 10100,
        managementUrl: expect.stringContaining("raw-token-abc"),
      }),
    );
  });
});
