import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { listSlots, getSlotDetail, listRecentClaims } from "../services/slotService";

export const getSlots = asyncHandler(async (_req: Request, res: Response) => {
  const slots = await listSlots();
  res.json({ success: true, data: { slots } });
});

export const getSlot = asyncHandler(async (req: Request, res: Response) => {
  const { number } = req.params as unknown as { number: number };
  const detail = await getSlotDetail(number);
  res.json({ success: true, data: detail });
});

export const getRecentClaims = asyncHandler(async (_req: Request, res: Response) => {
  const claims = await listRecentClaims(10);
  res.json({ success: true, data: { claims } });
});
