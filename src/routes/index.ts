import { Router, raw } from "express";
import { validate } from "../middleware/validate";
import { generalLimiter, metadataLimiter, bidLimiter, lightLimiter, uploadLimiter } from "../middleware/rateLimit";
import { uploadSingleImage } from "../middleware/upload";
import { requireAdminToken } from "../middleware/adminAuth";
import {
  slotNumberParamSchema,
  metadataPreviewSchema,
  bidPrepareSchema,
  cancelBidParamSchema,
  paymentCreateSchema,
  mockPaymentCompleteSchema,
  manageTokenParamSchema,
  manageUpdateSchema,
  reportSchema,
} from "../validators/schemas";

import { getSlots, getSlot, getRecentClaims } from "../controllers/slotsController";
import { previewMetadata } from "../controllers/metadataController";
import { postPrepareBid, postCancelBid, getBid } from "../controllers/bidsController";
import {
  postCreatePayment,
  postPaymentWebhook,
  postMockPaymentComplete,
} from "../controllers/paymentsController";
import { getManage, postRefreshMetadata, postUpdateAdvertisement } from "../controllers/manageController";
import { postReport } from "../controllers/reportsController";
import { postUploadImage } from "../controllers/uploadsController";
import { getDatafastStatsHandler, getDatafastOnlineHandler } from "../controllers/statsController";

export const router = Router();

router.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok" } }));

router.get("/slots", generalLimiter, getSlots);
router.get("/claims/recent", generalLimiter, getRecentClaims);
router.get("/slots/:number", generalLimiter, validate(slotNumberParamSchema), getSlot);

router.post(
  "/metadata/preview",
  metadataLimiter,
  validate(metadataPreviewSchema),
  previewMetadata,
);

router.post("/bids/prepare", bidLimiter, validate(bidPrepareSchema), postPrepareBid);
router.post("/bids/:bidId/cancel", bidLimiter, validate(cancelBidParamSchema), postCancelBid);
router.get("/bids/:bidId", lightLimiter, validate(cancelBidParamSchema), getBid);

router.post(
  "/payments/create",
  bidLimiter,
  validate(paymentCreateSchema),
  postCreatePayment,
);

// Webhook body must stay a raw Buffer for signature verification — mounted
// with its own raw parser rather than the app-wide JSON body parser.
router.post(
  "/payments/webhook",
  raw({ type: "*/*", limit: "1mb" }),
  postPaymentWebhook,
);

router.post(
  "/payments/mock/:orderId/complete",
  bidLimiter,
  validate(mockPaymentCompleteSchema),
  postMockPaymentComplete,
);

router.get(
  "/manage/:token",
  lightLimiter,
  validate(manageTokenParamSchema),
  getManage,
);

router.post(
  "/manage/:token/refresh-metadata",
  lightLimiter,
  validate(manageTokenParamSchema),
  postRefreshMetadata,
);

router.post(
  "/manage/:token/update",
  lightLimiter,
  validate(manageUpdateSchema),
  postUpdateAdvertisement,
);

router.post("/reports", lightLimiter, validate(reportSchema), postReport);

router.post("/uploads/image", uploadLimiter, uploadSingleImage, postUploadImage);

// Internal-only: DataFast analytics for the admin stats page. Gated by a
// shared secret (x-admin-token header) rather than the per-slot management
// token scheme used everywhere else — see middleware/adminAuth.ts.
router.get("/admin/datafast/stats", lightLimiter, requireAdminToken, getDatafastStatsHandler);

// Public: live "N online" count shown in the site nav. Not sensitive, so
// unlike the route above it isn't behind requireAdminToken — the df_ key
// itself still never leaves the backend.
router.get("/datafast/online", lightLimiter, getDatafastOnlineHandler);
