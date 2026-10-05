import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { createPaymentForBid, confirmPaymentResult } from "../services/paymentService";
import { paymentProvider } from "../services/payment";
import { MockPaymentProvider } from "../services/payment/MockPaymentProvider";
import { ApiError } from "../lib/errors";
import { env } from "../config/env";
import { readCookie } from "../lib/cookies";

export const postCreatePayment = asyncHandler(async (req: Request, res: Response) => {
  const { bidId } = req.body as { bidId: string };
  // DataFast's revenue-attribution webhook matches this back to the visitor
  // who converted, so it's read here (checkout creation) rather than at
  // payment confirmation time, when the original request/cookies are gone.
  const datafastVisitorId = readCookie(req.headers.cookie, "datafast_visitor_id");
  const { payment, clientPayload } = await createPaymentForBid(bidId, datafastVisitorId);

  res.status(201).json({
    success: true,
    data: {
      paymentId: payment.id,
      provider: payment.provider,
      providerOrderId: payment.providerOrderId,
      amountCents: payment.amount,
      currency: payment.currency,
      checkout: clientPayload,
    },
  });
});

/** Real payment provider webhook (e.g. Razorpay). Source of truth for payment confirmation. */
export const postPaymentWebhook = asyncHandler(async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    throw new ApiError("VALIDATION_ERROR", "Expected raw webhook body.");
  }

  let result;
  try {
    result = await paymentProvider.handleWebhook({ rawBody, headers: req.headers });
  } catch {
    throw new ApiError("PAYMENT_VERIFICATION_FAILED", "Webhook signature verification failed.");
  }

  const outcome = await confirmPaymentResult(result);
  res.json({ success: true, data: outcome });
});

/**
 * Dev-only endpoint that simulates a payment provider's checkout completing,
 * so the whole claim -> pay -> own flow is runnable with zero external
 * credentials. Only active when PAYMENT_PROVIDER=mock. Internally builds and
 * verifies a signed webhook payload exactly like the real flow does.
 */
export const postMockPaymentComplete = asyncHandler(async (req: Request, res: Response) => {
  if (env.PAYMENT_PROVIDER !== "mock") {
    throw new ApiError("NOT_FOUND", "Mock payments are not enabled.");
  }

  const { orderId } = req.params as { orderId: string };
  const { outcome } = req.body as { outcome: "success" | "failure" };

  const { payload, signature } = MockPaymentProvider.buildSignedWebhookBody(
    orderId,
    outcome === "success" ? "PAID" : "FAILED",
  );

  const result = await paymentProvider.handleWebhook({
    rawBody: Buffer.from(payload, "utf-8"),
    headers: { "x-mock-signature": signature },
  });

  const confirmation = await confirmPaymentResult(result);
  res.json({ success: true, data: confirmation });
});
