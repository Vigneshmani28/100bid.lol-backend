import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import { CURRENCY } from "../config/constants";
import { paymentProvider } from "./payment";
import type { VerifyPaymentResult } from "./payment/PaymentProvider";
import { emailService } from "./emailService";
import { issueManagementToken } from "./managementTokenService";
import { env } from "../config/env";

export async function createPaymentForBid(bidId: string, datafastVisitorId?: string | null) {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: { advertiser: true, advertisement: true, slot: true },
  });

  if (!bid) throw new ApiError("NOT_FOUND", "Bid not found.");
  if (bid.status !== "PENDING") {
    throw new ApiError("PAYMENT_ALREADY_PROCESSED", "This bid has already been processed.");
  }
  if (bid.expiresAt.getTime() < Date.now()) {
    await prisma.bid.update({ where: { id: bid.id }, data: { status: "EXPIRED" } });
    throw new ApiError("BID_EXPIRED", "This bid attempt expired. Please start again.");
  }

  const existingPayment = await prisma.payment.findUnique({ where: { bidId: bid.id } });
  if (existingPayment) {
    return { payment: existingPayment, clientPayload: null as Record<string, unknown> | null };
  }

  const result = await paymentProvider.createPayment({
    bidId: bid.id,
    amountCents: bid.amount,
    currency: CURRENCY,
    receiptEmail: bid.advertiser.email,
    datafastVisitorId,
  });

  const payment = await prisma.payment.create({
    data: {
      bidId: bid.id,
      provider: paymentProvider.name,
      providerOrderId: result.providerOrderId,
      amount: bid.amount,
      currency: CURRENCY,
      status: "CREATED",
    },
  });

  return { payment, clientPayload: result.clientPayload };
}

/**
 * The single source of truth for confirming a payment and, if it wins,
 * transferring slot ownership. Called only from a verified webhook (never
 * from a frontend "payment succeeded" callback).
 */
export async function confirmPaymentResult(result: VerifyPaymentResult) {
  const payment = await prisma.payment.findUnique({
    where: { providerOrderId: result.providerOrderId },
    include: { bid: { include: { slot: true, advertiser: true, advertisement: true } } },
  });

  if (!payment) throw new ApiError("PAYMENT_NOT_FOUND", "Unknown payment order.");

  // Idempotency: webhooks may be retried by the provider.
  if (payment.status === "PAID" || payment.status === "FAILED") {
    return { alreadyProcessed: true, won: payment.bid.status === "PAID" };
  }

  if (result.status === "FAILED") {
    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", providerPaymentId: result.providerPaymentId } }),
      prisma.bid.update({ where: { id: payment.bidId }, data: { status: "FAILED" } }),
    ]);
    return { alreadyProcessed: false, won: false };
  }

  if (result.status === "PENDING") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "PENDING" } });
    return { alreadyProcessed: false, won: false };
  }

  // result.status === "PAID" — attempt to win the slot, inside a locked transaction.
  const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Row-level lock on the slot so concurrent winning payments serialize.
    await tx.$queryRaw`SELECT id FROM "Slot" WHERE id = ${payment.bid.slotId} FOR UPDATE`;

    const freshSlot = await tx.slot.findUniqueOrThrow({ where: { id: payment.bid.slotId } });
    const freshBid = await tx.bid.findUniqueOrThrow({ where: { id: payment.bidId } });

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", providerPaymentId: result.providerPaymentId },
    });

    if (freshBid.status !== "PENDING") {
      // Already resolved (e.g. expired concurrently). Nothing more to do.
      return { won: false, reason: "BID_NOT_PENDING" as const };
    }

    if (freshBid.amount <= freshSlot.currentBidAmount) {
      // Payment succeeded but another bid already won the slot in the
      // meantime. Per product rules there is no automatic refund for the
      // outbid mechanism; this specific "paid but lost the race" case is
      // flagged for manual admin review via the FAILED bid + PAID payment
      // combination, rather than silently losing the paid amount.
      await tx.bid.update({ where: { id: freshBid.id }, data: { status: "FAILED" } });
      return { won: false, reason: "OUTRACED" as const };
    }

    const now = new Date();

    // Close out the previous owner's open ownership record, if any.
    await tx.ownershipHistory.updateMany({
      where: { slotId: freshSlot.id, endedAt: null },
      data: { endedAt: now },
    });

    await tx.ownershipHistory.create({
      data: {
        slotId: freshSlot.id,
        advertiserId: payment.bid.advertiserId,
        advertisementId: payment.bid.advertisementId,
        bidId: freshBid.id,
        amount: freshBid.amount,
        startedAt: now,
        endedAt: null,
      },
    });

    await tx.slot.update({
      where: { id: freshSlot.id },
      data: {
        currentAdvertiserId: payment.bid.advertiserId,
        currentAdId: payment.bid.advertisementId,
        currentBidAmount: freshBid.amount,
        ownershipStartedAt: now,
      },
    });

    await tx.advertisement.update({
      where: { id: payment.bid.advertisementId },
      data: { status: "ACTIVE" },
    });

    await tx.bid.update({ where: { id: freshBid.id }, data: { status: "PAID" } });

    return { won: true, reason: "WON" as const };
  });

  if (outcome.won) {
    const managementUrl = await issueManagementUrlForWin(payment.bidId);
    void emailService.sendOwnershipConfirmation({
      to: payment.bid.advertiser.email,
      brandName: payment.bid.advertisement.brandName,
      slotNumber: (await prisma.slot.findUniqueOrThrow({ where: { id: payment.bid.slotId } })).number,
      amountCents: payment.bid.amount,
      managementUrl,
    });
  }

  return { alreadyProcessed: false, won: outcome.won };
}

async function issueManagementUrlForWin(bidId: string): Promise<string> {
  const bid = await prisma.bid.findUniqueOrThrow({ where: { id: bidId } });
  const rawToken = await issueManagementToken(bid.advertiserId, bid.slotId);
  return `${env.APP_URL.replace(/\/$/, "")}/manage/${rawToken}`;
}
