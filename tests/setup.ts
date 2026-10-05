/**
 * Runs before every test file. Populates the minimum env vars that
 * `src/config/env.ts` requires so it doesn't call process.exit(1) during a
 * test run — no real database or credentials are ever contacted by the unit
 * tests in this suite.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/100bid_test";
process.env.APP_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.PAYMENT_PROVIDER ??= "mock";
process.env.EMAIL_PROVIDER ??= "console";
process.env.EMAIL_FROM ??= "100BID <hello@100bid.lol>";
