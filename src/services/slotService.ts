import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import { MINIMUM_BID_CENTS, MINIMUM_BID_INCREMENT_CENTS } from "../config/constants";

// Never include the advertiser's email in public slot responses.
const slotWithCurrent = {
  include: {
    currentAd: true,
  },
} as const;

export type SlotWithCurrent = Awaited<ReturnType<typeof getSlotByNumberOrThrow>>;

export async function listSlots() {
  const slots = await prisma.slot.findMany({
    orderBy: { number: "asc" },
    ...slotWithCurrent,
  });
  return slots.map(serializeSlotSummary);
}

/** Most recent paid claims across all slots, newest first. Public-safe fields only. */
export async function listRecentClaims(limit: number) {
  const rows = await prisma.ownershipHistory.findMany({
    where: { advertisement: { status: { notIn: ["REJECTED", "FLAGGED"] } } },
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { advertisement: true, slot: true },
  });
  return rows.map((r) => ({
    brandName: r.advertisement.brandName,
    websiteUrl: r.advertisement.websiteUrl,
    faviconUrl: r.advertisement.faviconUrl,
    slotNumber: r.slot.number,
    amountCents: r.amount,
    claimedAt: r.startedAt,
  }));
}

export async function getSlotByNumberOrThrow(number: number) {
  const slot = await prisma.slot.findUnique({
    where: { number },
    ...slotWithCurrent,
  });
  if (!slot) throw new ApiError("SLOT_NOT_FOUND", `Spot #${number} does not exist.`);
  return slot;
}

export async function getSlotDetail(number: number) {
  const slot = await getSlotByNumberOrThrow(number);

  const history = await prisma.ownershipHistory.findMany({
    where: { slotId: slot.id, endedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    include: { advertisement: true },
  });

  return {
    slot: serializeSlotSummary(slot),
    history: history.map((h: {
      advertisement: {
        brandName: string;
        imageUrl: string | null;
        faviconUrl: string | null;
        websiteUrl: string;
      };
      amount: number;
      startedAt: Date;
      endedAt: Date | null;
    }) => ({
      brandName: h.advertisement.brandName,
      imageUrl: h.advertisement.imageUrl,
      faviconUrl: h.advertisement.faviconUrl,
      websiteUrl: h.advertisement.websiteUrl,
      amountCents: h.amount,
      startedAt: h.startedAt,
      endedAt: h.endedAt,
    })),
  };
}

export function minimumNextBidCents(currentBidAmount: number, isOccupied: boolean): number {
  if (!isOccupied) return MINIMUM_BID_CENTS;
  return currentBidAmount + MINIMUM_BID_INCREMENT_CENTS;
}

function serializeSlotSummary(slot: {
  number: number;
  currentBidAmount: number;
  ownershipStartedAt: Date | null;
  currentAdvertiserId: string | null;
  currentAd: {
    brandName: string;
    description: string | null;
    imageUrl: string | null;
    faviconUrl: string | null;
    websiteUrl: string;
    canonicalUrl: string | null;
  } | null;
}) {
  const occupied = Boolean(slot.currentAdvertiserId);
  return {
    number: slot.number,
    occupied,
    currentBidCents: slot.currentBidAmount,
    minimumNextBidCents: minimumNextBidCents(slot.currentBidAmount, occupied),
    ownershipStartedAt: slot.ownershipStartedAt,
    ad: slot.currentAd
      ? {
          brandName: slot.currentAd.brandName,
          description: slot.currentAd.description,
          imageUrl: slot.currentAd.imageUrl,
          faviconUrl: slot.currentAd.faviconUrl,
          websiteUrl: slot.currentAd.websiteUrl,
        }
      : null,
  };
}
