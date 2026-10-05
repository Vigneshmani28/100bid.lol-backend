import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { TOTAL_SLOTS } from "../src/config/constants";

const prisma = new PrismaClient();

const DEMO_BRANDS = [
  { url: "https://stripe.com", bidDollars: 2500 },
  { url: "https://vercel.com", bidDollars: 1800 },
  { url: "https://linear.app", bidDollars: 1200 },
];

async function seedEmptySlots() {
  for (let number = 1; number <= TOTAL_SLOTS; number++) {
    await prisma.slot.upsert({
      where: { number },
      update: {},
      create: {
        number,
        currentBidAmount: 0,
      },
    });
  }
  console.log(`Seeded ${TOTAL_SLOTS} empty slots.`);
}

/**
 * Optional local-dev-only seed that claims a few slots with sample brands so
 * the wall isn't empty while developing the UI. Never run in production.
 */
async function seedDemoBrands() {
  for (let i = 0; i < DEMO_BRANDS.length; i++) {
    const { url, bidDollars } = DEMO_BRANDS[i];
    const number = i + 1;
    const email = `demo-${number}@example.com`;

    const advertiser = await prisma.advertiser.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const advertisement = await prisma.advertisement.create({
      data: {
        advertiserId: advertiser.id,
        websiteUrl: url,
        canonicalUrl: url,
        brandName: hostname,
        description: `Demo listing for ${hostname}.`,
        imageUrl: null,
        faviconUrl: `${url.replace(/\/$/, "")}/favicon.ico`,
        status: "ACTIVE",
      },
    });

    const slot = await prisma.slot.findUniqueOrThrow({ where: { number } });
    const amount = bidDollars * 100;
    const now = new Date();

    const bid = await prisma.bid.create({
      data: {
        slotId: slot.id,
        advertiserId: advertiser.id,
        advertisementId: advertisement.id,
        amount,
        status: "PAID",
        expiresAt: now,
      },
    });

    await prisma.ownershipHistory.create({
      data: {
        slotId: slot.id,
        advertiserId: advertiser.id,
        advertisementId: advertisement.id,
        bidId: bid.id,
        amount,
        startedAt: now,
        endedAt: null,
      },
    });

    await prisma.slot.update({
      where: { id: slot.id },
      data: {
        currentAdvertiserId: advertiser.id,
        currentAdId: advertisement.id,
        currentBidAmount: amount,
        ownershipStartedAt: now,
      },
    });
  }
  console.log(`Seeded ${DEMO_BRANDS.length} demo brand listings.`);
}

async function main() {
  const demo = process.argv.includes("--demo");
  await seedEmptySlots();
  if (demo) await seedDemoBrands();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
