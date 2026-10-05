import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { prepareBid, cancelBid, getBidStatus } from "../services/bidService";
import { dollarsToCents, formatCentsAsUsd } from "../lib/money";

export const postPrepareBid = asyncHandler(async (req: Request, res: Response) => {
  const { slotNumber, websiteUrl, email, bidDollars, brandName, description, imageUrl } = req.body as {
    slotNumber: number;
    websiteUrl: string;
    email: string;
    bidDollars: number;
    brandName?: string;
    description?: string;
    imageUrl?: string;
  };

  const { bid, advertisement } = await prepareBid({
    slotNumber,
    email,
    websiteUrl,
    bidAmountCents: dollarsToCents(bidDollars),
    brandName,
    description,
    imageUrl,
  });

  res.status(201).json({
    success: true,
    data: {
      bidId: bid.id,
      slotNumber,
      amountCents: bid.amount,
      amountDisplay: formatCentsAsUsd(bid.amount),
      expiresAt: bid.expiresAt,
      advertisement: {
        brandName: advertisement.brandName,
        description: advertisement.description,
        imageUrl: advertisement.imageUrl,
        faviconUrl: advertisement.faviconUrl,
        websiteUrl: advertisement.websiteUrl,
      },
    },
  });
});

/** Explicitly releases a reservation — e.g. the user closed the checkout modal. */
export const postCancelBid = asyncHandler(async (req: Request, res: Response) => {
  const { bidId } = req.params as { bidId: string };
  const result = await cancelBid(bidId);
  res.json({ success: true, data: result });
});

/** Outcome of a bid, polled by the page the customer returns to after checkout. */
export const getBid = asyncHandler(async (req: Request, res: Response) => {
  const { bidId } = req.params as { bidId: string };
  const status = await getBidStatus(bidId);
  res.json({
    success: true,
    data: { ...status, amountDisplay: formatCentsAsUsd(status.amountCents) },
  });
});
