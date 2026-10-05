import { env } from "../../config/env";
import type { PaymentProvider } from "./PaymentProvider";
import { MockPaymentProvider } from "./MockPaymentProvider";
import { RazorpayPaymentProvider } from "./RazorpayPaymentProvider";
import { DodoPaymentProvider } from "./DodoPaymentProvider";

function createPaymentProvider(): PaymentProvider {
  switch (env.PAYMENT_PROVIDER) {
    case "razorpay":
      return new RazorpayPaymentProvider();
    case "dodo":
      return new DodoPaymentProvider();
    case "mock":
    default:
      return new MockPaymentProvider();
  }
}

export const paymentProvider: PaymentProvider = createPaymentProvider();
export type { PaymentProvider } from "./PaymentProvider";
