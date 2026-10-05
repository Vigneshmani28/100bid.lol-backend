import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { ApiError } from "../lib/errors";
import { UPLOADS_DIR } from "../lib/uploadsDir";
import { detectImageType } from "../services/imageValidation";

export const postUploadImage = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    throw new ApiError("VALIDATION_ERROR", "No image file was provided.");
  }

  // Never trust the client-supplied mimetype/filename — sniff the real
  // format from the file's own bytes before writing anything to disk.
  const detected = detectImageType(file.buffer);
  if (!detected) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "That file doesn't look like a supported image (PNG, JPEG, WEBP, or GIF).",
    );
  }

  await mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `${randomUUID()}.${detected.ext}`;
  await writeFile(path.join(UPLOADS_DIR, filename), file.buffer);

  // Build the URL from the actual request rather than a configured "public
  // URL" env var, since APP_URL points at the frontend, not this API.
  const origin = `${req.protocol}://${req.get("host")}`;
  res.status(201).json({
    success: true,
    data: { url: `${origin}/uploads/${filename}` },
  });
});
