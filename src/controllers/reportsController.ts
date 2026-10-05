import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { createReport } from "../services/reportService";

export const postReport = asyncHandler(async (req: Request, res: Response) => {
  const { slotNumber, reason, details, reporterEmail } = req.body as {
    slotNumber: number;
    reason: string;
    details?: string;
    reporterEmail?: string;
  };

  const report = await createReport({ slotNumber, reason, details, reporterEmail });
  res.status(201).json({ success: true, data: { reportId: report.id } });
});
