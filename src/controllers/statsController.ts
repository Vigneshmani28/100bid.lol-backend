import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { getDatafastStats, getLiveVisitorStats } from "../services/datafastService";
import { ApiError } from "../lib/errors";

/**
 * GET /api/datafast/online
 * Public — a live visitor count isn't sensitive, so this deliberately skips
 * requireAdminToken (see routes/index.ts) unlike the rest of this file.
 * Returns both the live "online now" count and the all-time total visitor
 * count, for the "N online · M visitors" nav badge.
 */
export const getDatafastOnlineHandler = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await getLiveVisitorStats();
  res.json({ success: true, data: stats });
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * GET /api/admin/datafast/stats?startAt=YYYY-MM-DD&endAt=YYYY-MM-DD
 * Both params optional — defaults to the trailing 30 days. Gated by
 * requireAdminToken (see routes/index.ts), not open to the frontend at large.
 */
export const getDatafastStatsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { startAt, endAt } = req.query as { startAt?: string; endAt?: string };

  const end = endAt && DATE_RE.test(endAt) ? endAt : toDateString(new Date());
  let start: string;
  if (startAt) {
    if (!DATE_RE.test(startAt)) {
      throw new ApiError("VALIDATION_ERROR", "startAt must be formatted YYYY-MM-DD.");
    }
    start = startAt;
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    start = toDateString(d);
  }

  const stats = await getDatafastStats(start, end);
  res.json({ success: true, data: stats });
});
