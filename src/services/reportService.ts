import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";

export interface CreateReportInput {
  slotNumber: number;
  reason: string;
  details?: string;
  reporterEmail?: string;
}

export async function createReport(input: CreateReportInput) {
  const slot = await prisma.slot.findUnique({ where: { number: input.slotNumber } });
  if (!slot || !slot.currentAdId) {
    throw new ApiError("SLOT_NOT_FOUND", "This spot has no active advertisement to report.");
  }

  const report = await prisma.report.create({
    data: {
      advertisementId: slot.currentAdId,
      reporterEmail: input.reporterEmail?.trim().toLowerCase(),
      reason: input.reason,
      details: input.details,
      status: "OPEN",
    },
  });

  return report;
}
