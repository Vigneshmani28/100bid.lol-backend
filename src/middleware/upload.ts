import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors";
import { UPLOAD_MAX_IMAGE_BYTES } from "../config/constants";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_IMAGE_BYTES, files: 1 },
});

/**
 * Parses a single `image` field from a multipart/form-data request into
 * `req.file` (kept in memory, never touching disk until the content is
 * verified). Wraps multer so its failures surface as a normal ApiError
 * instead of falling through to the generic 500 handler.
 */
export function uploadSingleImage(req: Request, res: Response, next: NextFunction) {
  upload.single("image")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? `Image must be smaller than ${Math.floor(UPLOAD_MAX_IMAGE_BYTES / (1024 * 1024))}MB.`
          : "Could not process the uploaded file.";
      next(new ApiError("VALIDATION_ERROR", message));
      return;
    }
    next(err);
  });
}
