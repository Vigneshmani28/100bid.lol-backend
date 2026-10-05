-- 100BID — full database reset.
-- Empties every table and restarts identity sequences, then leaves the
-- schema itself untouched (no DROP/CREATE — migrations stay applied).
-- CASCADE lets a single TRUNCATE handle all foreign-key dependencies
-- regardless of order, so the table list below does not need to be
-- topologically sorted.
--
-- Usage:
--   psql "$DATABASE_URL" -f backend/prisma/reset.sql
--
-- After running this, reseed empty slots with:
--   cd backend && npm run seed            # 100 empty slots only
--   cd backend && npm run seed:demo       # + a few sample demo listings

TRUNCATE TABLE
  "Report",
  "ManagementToken",
  "Payment",
  "OwnershipHistory",
  "Bid",
  "Advertisement",
  "Slot",
  "Advertiser"
RESTART IDENTITY CASCADE;
