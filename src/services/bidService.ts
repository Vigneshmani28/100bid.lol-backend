import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import { BID_PAYMENT_WINDOW_MINUTES } from "../config/constants";
import { fetchBrandMetadata, type BrandMetadata } from "./metadataFetcher";
import { minimumNextBidCents } from "./slotService";
import { assertDisplaySafeUrl, normalizeUrl, UnsafeUrlError } from "./urlSafety";

export interface PrepareBidInput {
  slotNumber: number;
  email: string;
  websiteUrl: string;
  bidAmountCents: number;
  /** Optional manual overrides — fall back to scraped metadata when omitted. */
  brandName?: string;
  description?: string;
  imageUrl?: string;
}

/**
 * Prepares a bid: fetches + previews the brand's metadata, then reserves a
 * PENDING bid row for payment. This does NOT change slot ownership — only a
 * confirmed (PAID) bid can ever do that. Fast-fails on an obviously stale
 * bid amount, but the authoritative check happens again, inside a locked
 * transaction, when the payment is confirmed.
 */
export async function prepareBid(input: PrepareBidInput) {
  const slot = await prisma.slot.findUnique({ where: { number: input.slotNumber } });
  if (!slot) throw new ApiError("SLOT_NOT_FOUND", `Spot #${input.slotNumber} does not exist.`);

  const occupied = Boolean(slot.currentAdvertiserId);
  const minimum = minimumNextBidCents(slot.currentBidAmount, occupied);

  if (input.bidAmountCents < minimum) {
    throw new ApiError(
      "BID_TOO_LOW",
      occupied
        ? `Your bid must be at least $${(minimum / 100).toFixed(2)}.`
        : `The minimum bid to claim this spot is $${(minimum / 100).toFixed(2)}.`,
      { minimumBidCents: minimum },
    );
  }

  let metadata: BrandMetadata;
  try {
    metadata = await fetchBrandMetadata(input.websiteUrl);
  } catch (err) {
    // Plenty of real sites can't be scraped — they block bots, require JS, or
    // are briefly down. That shouldn't cost someone their bid, and the client
    // already collects every field the scrape would have filled, so fall back
    // to what the user typed instead of failing. Only the brand name is
    // required; the rest of the ad is allowed to be sparse.
    const manualBrandName = input.brandName?.trim();
    if (!manualBrandName) {
      throw new ApiError(
        "METADATA_FETCH_FAILED",
        err instanceof UnsafeUrlError
          ? err.message
          : "Couldn't automatically read this website. Add your brand details and try again.",
      );
    }

    // The URL is still screened, but as display data — from here on nothing
    // about this website is ever fetched server-side.
    let url: URL;
    try {
      url = assertDisplaySafeUrl(input.websiteUrl);
    } catch (urlErr) {
      throw new ApiError(
        "UNSAFE_URL",
        urlErr instanceof UnsafeUrlError ? urlErr.message : "That website URL doesn't look valid.",
      );
    }

    metadata = {
      brandName: manualBrandName,
      description: null,
      imageUrl: null,
      faviconUrl: null,
      canonicalUrl: url.toString(),
      websiteUrl: url.toString(),
    };
  }

  // Manual overrides are display-only (never fetched server-side), so they only need
  // lightweight format validation — not the full SSRF-safe fetch check used for websiteUrl.
  let imageUrlOverride: string | undefined;
  if (input.imageUrl && input.imageUrl.trim().length > 0) {
    try {
      imageUrlOverride = normalizeUrl(input.imageUrl.trim()).toString();
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        throw new ApiError("UNSAFE_URL", err.message);
      }
      throw new ApiError("UNSAFE_URL", "That image URL doesn't look valid.");
    }
  }

  const brandNameOverride = input.brandName?.trim();
  const descriptionOverride = input.description?.trim();

  const email = input.email.trim().toLowerCase();

  const advertiser = await prisma.advertiser.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  const advertisement = await prisma.advertisement.create({
    data: {
      advertiserId: advertiser.id,
      websiteUrl: metadata.websiteUrl,
      canonicalUrl: metadata.canonicalUrl,
      brandName: brandNameOverride || metadata.brandName,
      description: descriptionOverride || metadata.description,
      imageUrl: imageUrlOverride || metadata.imageUrl,
      faviconUrl: metadata.faviconUrl,
      status: "PENDING",
    },
  });

  // Everything from here on is the seat-booking-style reservation lock: only
  // one active (PENDING, unexpired) bid may exist per slot at a time. This
  // covers claiming an empty slot AND outbidding an occupied one identically,
  // since both paths funnel through this same function. The row lock below
  // makes the "check, then reserve" sequence atomic across concurrent
  // requests — without it, two requests could both pass the check before
  // either had written its bid.
  const bid = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Row-level lock on the slot so concurrent reservation attempts for the
    // same slot serialize: the second request blocks here until the first
    // request's transaction commits or rolls back.
    await tx.$queryRaw`SELECT id FROM "Slot" WHERE id = ${slot.id} FOR UPDATE`;

    // Re-read the slot's live state now that we hold the lock — another
    // request may have won the slot (raising currentBidAmount) in the time
    // it took to fetch metadata above, so the earlier minimum-bid check was
    // only a fast-fail, not authoritative.
    const freshSlot = await tx.slot.findUniqueOrThrow({ where: { id: slot.id } });
    const freshOccupied = Boolean(freshSlot.currentAdvertiserId);
    const freshMinimum = minimumNextBidCents(freshSlot.currentBidAmount, freshOccupied);

    if (input.bidAmountCents < freshMinimum) {
      throw new ApiError(
        "BID_TOO_LOW",
        freshOccupied
          ? `Your bid must be at least $${(freshMinimum / 100).toFixed(2)}.`
          : `The minimum bid to claim this spot is $${(freshMinimum / 100).toFixed(2)}.`,
        { minimumBidCents: freshMinimum },
      );
    }

    const now = new Date();

    // Opportunistically clear reservations that have simply timed out, so
    // the check below only ever sees genuinely active holds.
    await tx.bid.updateMany({
      where: { slotId: slot.id, status: "PENDING", expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });

    const activeReservation = await tx.bid.findFirst({
      where: { slotId: slot.id, status: "PENDING", expiresAt: { gt: now } },
    });

    if (activeReservation) {
      if (activeReservation.advertiserId === advertiser.id) {
        // The same bidder is renewing their own still-open attempt (e.g.
        // they went back and changed the bid amount) — supersede it rather
        // than lock them out of their own reservation.
        await tx.bid.update({ where: { id: activeReservation.id }, data: { status: "CANCELLED" } });
      } else {
        const minutesLeft = Math.max(
          1,
          Math.ceil((activeReservation.expiresAt.getTime() - now.getTime()) / 60_000),
        );
        throw new ApiError(
          "SLOT_RESERVED",
          `Someone else is currently completing a purchase for this spot. Please try again in about ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`,
          { reservedUntil: activeReservation.expiresAt },
        );
      }
    }

    const expiresAt = new Date(now.getTime() + BID_PAYMENT_WINDOW_MINUTES * 60 * 1000);

    return tx.bid.create({
      data: {
        slotId: slot.id,
        advertiserId: advertiser.id,
        advertisementId: advertisement.id,
        amount: input.bidAmountCents,
        status: "PENDING",
        expiresAt,
      },
    });
  });

  return { bid, advertisement, advertiser, slotNumber: slot.number };
}

/**
 * Explicit release of a reservation: called when the bidder cancels out of
 * the payment step (closes the checkout modal, clicks back, etc.) instead of
 * letting the hold run out the clock. Idempotent — cancelling a bid that has
 * already resolved (paid, failed, or expired) is a harmless no-op, since the
 * client may race a webhook that just settled it.
 */
/**
 * Read-only outcome of a bid, for the page the customer lands back on after
 * a hosted checkout. Deliberately says nothing a bidId holder shouldn't see,
 * and it never *decides* anything — only the verified webhook can move a bid
 * to PAID, so a customer polling this simply waits for that to land.
 */
export async function getBidStatus(bidId: string) {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: { slot: true, advertisement: true },
  });
  if (!bid) throw new ApiError("NOT_FOUND", "Bid not found.");

  return {
    bidId: bid.id,
    status: bid.status,
    slotNumber: bid.slot.number,
    amountCents: bid.amount,
    brandName: bid.advertisement.brandName,
    // Whether this bid is the one currently holding the slot. A bid can be
    // PAID yet not hold the spot if it was outraced — see confirmPaymentResult.
    holdsSlot: bid.status === "PAID" && bid.slot.currentAdId === bid.advertisementId,
  };
}

export async function cancelBid(bidId: string) {
  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
  if (!bid) throw new ApiError("NOT_FOUND", "Bid not found.");

  if (bid.status !== "PENDING") {
    return { cancelled: false };
  }

  await prisma.bid.update({ where: { id: bidId }, data: { status: "CANCELLED" } });
  return { cancelled: true };
}
