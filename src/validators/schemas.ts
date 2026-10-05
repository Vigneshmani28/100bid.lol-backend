import { z } from "zod";
import { TOTAL_SLOTS } from "../config/constants";

/** Loose URL text field — full safety validation happens in urlSafety.ts (SSRF checks, DNS). */
const websiteUrlSchema = z
  .string()
  .trim()
  .min(3, "Website URL is required")
  .max(2048, "URL is too long")
  .refine((v) => !/^(javascript|data|file|vbscript):/i.test(v), "Unsupported URL scheme");

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

/** Optional client-supplied overrides for scraped brand metadata — empty strings are treated as "not provided". */
const optionalBrandNameSchema = z
  .string()
  .trim()
  .max(120, "Display name is too long")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalDescriptionSchema = z
  .string()
  .trim()
  .max(500, "Description is too long")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalImageUrlSchema = z
  .string()
  .trim()
  .max(2048, "Image URL is too long")
  .refine((v) => v === "" || !/^(javascript|data|file|vbscript):/i.test(v), "Unsupported URL scheme")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const slotNumberSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(TOTAL_SLOTS, `Slot number must be between 1 and ${TOTAL_SLOTS}`);

/** Bid amount arrives from the client as whole dollars (integer, no decimals) for simplicity. */
const bidDollarsSchema = z.coerce
  .number()
  .int("Bid must be a whole number of dollars")
  .positive("Bid must be greater than zero")
  .max(10_000_000, "Bid is too large");

export const slotNumberParamSchema = z.object({
  params: z.object({ number: slotNumberSchema }),
});

export const metadataPreviewSchema = z.object({
  body: z.object({
    websiteUrl: websiteUrlSchema,
  }),
});

export const bidPrepareSchema = z.object({
  body: z.object({
    slotNumber: slotNumberSchema,
    websiteUrl: websiteUrlSchema,
    email: emailSchema,
    bidDollars: bidDollarsSchema,
    // Optional — when omitted, the server falls back to metadata scraped from websiteUrl.
    brandName: optionalBrandNameSchema,
    description: optionalDescriptionSchema,
    imageUrl: optionalImageUrlSchema,
  }),
});

export const cancelBidParamSchema = z.object({
  params: z.object({ bidId: z.string().uuid() }),
});

export const paymentCreateSchema = z.object({
  body: z.object({
    bidId: z.string().uuid(),
  }),
});

export const mockPaymentCompleteSchema = z.object({
  params: z.object({ orderId: z.string().min(1) }),
  body: z.object({
    outcome: z.enum(["success", "failure"]).default("success"),
  }),
});

export const manageTokenParamSchema = z.object({
  params: z.object({ token: z.string().min(20).max(200) }),
});

/**
 * Manual edits from the management page. Unlike the bid-prepare overrides
 * (which fall back to scraped metadata when omitted), this is a direct edit
 * of an already-live listing — brandName is required since it's always
 * already set, and an empty description/imageUrl means "clear this field",
 * not "leave it unchanged".
 */
export const manageUpdateSchema = z.object({
  params: z.object({ token: z.string().min(20).max(200) }),
  body: z.object({
    brandName: z.string().trim().min(1, "Display name is required").max(120, "Display name is too long"),
    description: z.string().trim().max(500, "Description is too long").optional().default(""),
    imageUrl: z
      .string()
      .trim()
      .max(2048, "Image URL is too long")
      .refine((v) => v === "" || !/^(javascript|data|file|vbscript):/i.test(v), "Unsupported URL scheme")
      .optional()
      .default(""),
  }),
});

export const reportSchema = z.object({
  body: z.object({
    slotNumber: slotNumberSchema,
    reason: z.enum([
      "INAPPROPRIATE_CONTENT",
      "MISLEADING",
      "MALWARE_OR_PHISHING",
      "TRADEMARK",
      "OTHER",
    ]),
    details: z.string().trim().max(1000).optional(),
    reporterEmail: emailSchema.optional(),
  }),
});
