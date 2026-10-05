import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: [".env.local", ".env"] });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  APP_URL: z.string().url().default("https://100bid.lol"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  PAYMENT_PROVIDER: z.enum(["mock", "razorpay", "dodo"]).default("mock"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Dodo Payments. DODO_MODE picks the API host (test vs live); the API key
  // is mode-specific too, so the two always change together.
  DODO_MODE: z.enum(["test", "live"]).default("test"),
  DODO_API_KEY: z.string().optional(),
  DODO_WEBHOOK_SECRET: z.string().optional(),
  // Dodo prices against a product in your catalog, but a wall bid is a
  // different amount every time — so this must point at a single one-time
  // product with "Pay What You Want" enabled, whose price we override per
  // checkout session. See DodoPaymentProvider.
  DODO_PRODUCT_ID: z.string().optional(),

  EMAIL_PROVIDER: z.enum(["console", "resend", "gmail"]).default("console"),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("100BID <hello@100bid.lol>"),

  // Gmail SMTP (via nodemailer), used when EMAIL_PROVIDER=gmail. GMAIL_USER
  // must be the actual authenticated mailbox — Gmail's SMTP server rejects
  // (or silently rewrites) a From address that isn't the logged-in account
  // or a verified "Send As" alias, so EMAIL_FROM's address is not used
  // as-is; only its display name is kept, paired with GMAIL_USER.
  // Loosely validated like the other optional provider secrets above (e.g.
  // DODO_API_KEY) — an empty string from an unfilled .env value must parse
  // cleanly, and a real misconfiguration surfaces immediately and clearly
  // when Gmail's SMTP server rejects the auth attempt.
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),

  METADATA_FETCH_TIMEOUT: z.coerce.number().int().positive().optional(),
  METADATA_MAX_RESPONSE_SIZE: z.coerce.number().int().positive().optional(),

  // DataFast's website-scoped API key ("df_..."), used server-side only to
  // pull analytics for the admin stats page — see services/datafastService.ts.
  // Generate one at https://datafa.st -> Settings -> API keys. Never expose
  // this to the frontend.
  DATAFAST_API_KEY: z.string().optional(),
  // Shared secret the /api/admin/* routes require in an x-admin-token header.
  // There's no user/session model in this app, so this is deliberately the
  // simplest thing that isn't "wide open" — set a long random value in prod.
  ADMIN_STATS_TOKEN: z.string().optional(),

  // How long an unpaid bid attempt exclusively holds its slot — seat-booking
  // style reservation window. Configurable per-environment; defaults to 5.
  BID_RESERVATION_WINDOW_MINUTES: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast and loudly at boot — never run with invalid config.
    console.error("Invalid environment configuration:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
