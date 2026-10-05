import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { resolveManagementToken } from "../services/managementTokenService";
import { fetchBrandMetadata } from "../services/metadataFetcher";
import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import { normalizeUrl, UnsafeUrlError } from "../services/urlSafety";
import { formatCentsAsUsd } from "../lib/money";

/**
 * A management token only proves "you are advertiser X" — it doesn't by
 * itself say which Advertisement X may edit. If X currently holds the slot,
 * that's `slot.currentAdId`. If X has since been outbid, X should still be
 * able to edit *their own* listing (the immutable per-bid Advertisement
 * snapshot preserved on their OwnershipHistory row) — editing it can never
 * affect the slot's live content, since the current holder has their own
 * separate Advertisement row. We use the advertiser's most recent ownership
 * period on this slot in case they've won it more than once.
 *
 * Throws MANAGEMENT_TOKEN_INVALID if this advertiser has no relationship to
 * the slot at all (shouldn't happen in practice, but defends against a token
 * for the wrong slot).
 */
async function resolveManageTarget(
  record: { advertiserId: string; slotId: string },
  slot: { currentAdvertiserId: string | null; currentAdId: string | null; currentBidAmount: number; ownershipStartedAt: Date | null },
) {
  if (slot.currentAdvertiserId === record.advertiserId && slot.currentAdId) {
    return {
      isCurrentOwner: true as const,
      advertisementId: slot.currentAdId,
      startedAt: slot.ownershipStartedAt,
      endedAt: null as Date | null,
      bidAmountCents: slot.currentBidAmount,
    };
  }

  const ownershipRow = await prisma.ownershipHistory.findFirst({
    where: { slotId: record.slotId, advertiserId: record.advertiserId },
    orderBy: { startedAt: "desc" },
  });

  if (!ownershipRow) {
    throw new ApiError("MANAGEMENT_TOKEN_INVALID", "This management link is no longer valid for this spot.");
  }

  return {
    isCurrentOwner: false as const,
    advertisementId: ownershipRow.advertisementId,
    startedAt: ownershipRow.startedAt as Date | null,
    endedAt: ownershipRow.endedAt,
    bidAmountCents: ownershipRow.amount,
  };
}

export const getManage = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const record = await resolveManagementToken(token);

  const slot = await prisma.slot.findUnique({ where: { id: record.slotId } });
  if (!slot) {
    throw new ApiError("MANAGEMENT_TOKEN_INVALID", "This management link is no longer valid for this spot.");
  }

  const { isCurrentOwner, advertisementId, startedAt, endedAt, bidAmountCents } = await resolveManageTarget(
    record,
    slot,
  );
  const advertisement = await prisma.advertisement.findUnique({ where: { id: advertisementId } });

  res.json({
    success: true,
    data: {
      slotNumber: slot.number,
      // The slot's live price — what it'd currently take to win/reclaim it.
      // Shown regardless of ownership so a past holder knows what they're up
      // against if they want to bid again.
      currentBidCents: slot.currentBidAmount,
      currentBidDisplay: formatCentsAsUsd(slot.currentBidAmount),
      isCurrentOwner,
      // Current owner: when their (still-ongoing) ownership period began.
      // Past holder: their own ownership period's start/end, from the
      // OwnershipHistory row — not the slot's current period.
      ownershipStartedAt: startedAt,
      ownershipEndedAt: endedAt,
      yourBidCents: bidAmountCents,
      yourBidDisplay: formatCentsAsUsd(bidAmountCents),
      advertisement: advertisement
        ? {
            brandName: advertisement.brandName,
            description: advertisement.description,
            imageUrl: advertisement.imageUrl,
            faviconUrl: advertisement.faviconUrl,
            websiteUrl: advertisement.websiteUrl,
            status: advertisement.status,
          }
        : null,
    },
  });
});

export const postRefreshMetadata = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const record = await resolveManagementToken(token);

  const slot = await prisma.slot.findUnique({ where: { id: record.slotId } });
  if (!slot) {
    throw new ApiError("MANAGEMENT_TOKEN_INVALID", "This management link is no longer valid for this spot.");
  }
  const { advertisementId } = await resolveManageTarget(record, slot);

  const currentAd = await prisma.advertisement.findUniqueOrThrow({ where: { id: advertisementId } });

  let metadata;
  try {
    metadata = await fetchBrandMetadata(currentAd.websiteUrl);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new ApiError("METADATA_FETCH_FAILED", err.message);
    throw err;
  }

  const updated = await prisma.advertisement.update({
    where: { id: currentAd.id },
    data: {
      canonicalUrl: metadata.canonicalUrl,
      brandName: metadata.brandName,
      description: metadata.description,
      imageUrl: metadata.imageUrl,
      faviconUrl: metadata.faviconUrl,
    },
  });

  res.json({
    success: true,
    data: {
      brandName: updated.brandName,
      description: updated.description,
      imageUrl: updated.imageUrl,
      faviconUrl: updated.faviconUrl,
      websiteUrl: updated.websiteUrl,
    },
  });
});

/**
 * Manual edit of the current listing's display fields. Distinct from
 * postRefreshMetadata (which re-scrapes the source site) — this is the
 * holder directly typing in what they want shown, same as the manual
 * overrides ClaimModal collects at claim time. The image URL is display-only
 * (never fetched server-side), so it only needs the lightweight format check
 * used everywhere else manual overrides are accepted — not the full
 * SSRF-safe fetch check reserved for URLs we actually retrieve.
 */
export const postUpdateAdvertisement = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const { brandName, description, imageUrl } = req.body as {
    brandName: string;
    description: string;
    imageUrl: string;
  };
  const record = await resolveManagementToken(token);

  const slot = await prisma.slot.findUnique({ where: { id: record.slotId } });
  if (!slot) {
    throw new ApiError("MANAGEMENT_TOKEN_INVALID", "This management link is no longer valid for this spot.");
  }
  const { advertisementId } = await resolveManageTarget(record, slot);

  let imageUrlValue: string | null = null;
  if (imageUrl.trim().length > 0) {
    try {
      imageUrlValue = normalizeUrl(imageUrl.trim()).toString();
    } catch (err) {
      throw new ApiError(
        "UNSAFE_URL",
        err instanceof UnsafeUrlError ? err.message : "That image URL doesn't look valid.",
      );
    }
  }

  const updated = await prisma.advertisement.update({
    where: { id: advertisementId },
    data: {
      brandName,
      description: description.trim().length > 0 ? description.trim() : null,
      imageUrl: imageUrlValue,
    },
  });

  res.json({
    success: true,
    data: {
      brandName: updated.brandName,
      description: updated.description,
      imageUrl: updated.imageUrl,
      faviconUrl: updated.faviconUrl,
      websiteUrl: updated.websiteUrl,
    },
  });
});
