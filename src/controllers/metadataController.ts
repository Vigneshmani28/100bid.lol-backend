import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { fetchBrandMetadata } from "../services/metadataFetcher";
import { ApiError } from "../lib/errors";
import { UnsafeUrlError } from "../services/urlSafety";

export const previewMetadata = asyncHandler(async (req: Request, res: Response) => {
  const { websiteUrl } = req.body as { websiteUrl: string };

  try {
    const metadata = await fetchBrandMetadata(websiteUrl);
    res.json({ success: true, data: metadata });
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      throw new ApiError("METADATA_FETCH_FAILED", err.message);
    }
    throw err;
  }
});
