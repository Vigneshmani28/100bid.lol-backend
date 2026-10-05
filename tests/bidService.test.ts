import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, fetchBrandMetadataMock } = vi.hoisted(() => {
  const prismaMock = {
    slot: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    advertiser: { upsert: vi.fn() },
    advertisement: { create: vi.fn() },
    bid: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prismaMock, fetchBrandMetadataMock: vi.fn() };
});

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/services/metadataFetcher", () => ({
  fetchBrandMetadata: fetchBrandMetadataMock,
}));

import { prepareBid, cancelBid } from "../src/services/bidService";
import { UnsafeUrlError } from "../src/services/urlSafety";
import { MINIMUM_BID_CENTS, MINIMUM_BID_INCREMENT_CENTS } from "../src/config/constants";

function emptySlot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "slot-1",
    number: 5,
    currentBidAmount: 0,
    currentAdvertiserId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default happy-path plumbing shared by most tests: the reservation
  // transaction just runs its callback against the same mock ("tx" ===
  // prismaMock), the row-lock query is a no-op, no other reservation is
  // active, and the fresh in-transaction slot read mirrors whatever
  // slot.findUnique was set up to return — individual tests override this
  // with mockResolvedValueOnce when they need the fresh read to differ.
  prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
  prismaMock.$queryRaw.mockResolvedValue(undefined);
  prismaMock.slot.findUniqueOrThrow.mockImplementation((args: unknown) =>
    prismaMock.slot.findUnique(args as never),
  );
  prismaMock.bid.findFirst.mockResolvedValue(null);
  prismaMock.bid.updateMany.mockResolvedValue({ count: 0 });
});

describe("prepareBid", () => {
  it("throws SLOT_NOT_FOUND when the slot does not exist", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(null);

    await expect(
      prepareBid({ slotNumber: 999, email: "a@b.com", websiteUrl: "https://a.com", bidAmountCents: 100 }),
    ).rejects.toMatchObject({ code: "SLOT_NOT_FOUND" });
  });

  it("rejects a bid below the minimum starting bid on an empty slot", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(emptySlot({ currentBidAmount: 0 }));

    await expect(
      prepareBid({
        slotNumber: 5,
        email: "a@b.com",
        websiteUrl: "https://a.com",
        bidAmountCents: MINIMUM_BID_CENTS - 1,
      }),
    ).rejects.toMatchObject({ code: "BID_TOO_LOW" });

    expect(fetchBrandMetadataMock).not.toHaveBeenCalled();
  });

  it("rejects a bid equal to the current bid on an occupied slot", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(
      emptySlot({ currentBidAmount: 10000, currentAdvertiserId: "adv-1" }),
    );

    await expect(
      prepareBid({ slotNumber: 5, email: "a@b.com", websiteUrl: "https://a.com", bidAmountCents: 10000 }),
    ).rejects.toMatchObject({ code: "BID_TOO_LOW" });
  });

  it("rejects a bid lower than the current bid on an occupied slot", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(
      emptySlot({ currentBidAmount: 10000, currentAdvertiserId: "adv-1" }),
    );

    await expect(
      prepareBid({ slotNumber: 5, email: "a@b.com", websiteUrl: "https://a.com", bidAmountCents: 9999 }),
    ).rejects.toMatchObject({ code: "BID_TOO_LOW" });
  });

  it("accepts a bid that meets the minimum increment and creates advertiser/ad/bid rows", async () => {
    const slot = emptySlot({ currentBidAmount: 10000, currentAdvertiserId: "adv-1" });
    prismaMock.slot.findUnique.mockResolvedValue(slot);

    fetchBrandMetadataMock.mockResolvedValue({
      brandName: "Brand Co",
      description: "desc",
      imageUrl: "https://brand.com/img.png",
      faviconUrl: "https://brand.com/favicon.ico",
      canonicalUrl: "https://brand.com/",
      websiteUrl: "https://brand.com/",
    });
    prismaMock.advertiser.upsert.mockResolvedValue({ id: "adv-2", email: "new@brand.com" });
    prismaMock.advertisement.create.mockResolvedValue({ id: "ad-1", brandName: "Brand Co" });
    prismaMock.bid.create.mockResolvedValue({ id: "bid-1", amount: 10100, status: "PENDING" });

    const requiredMinimum = 10000 + MINIMUM_BID_INCREMENT_CENTS;
    const result = await prepareBid({
      slotNumber: 5,
      email: "NEW@Brand.com ",
      websiteUrl: "https://brand.com",
      bidAmountCents: requiredMinimum,
    });

    expect(prismaMock.advertiser.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "new@brand.com" } }),
    );
    expect(prismaMock.bid.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: requiredMinimum, status: "PENDING" }),
      }),
    );
    expect(result.bid.id).toBe("bid-1");
    expect(result.slotNumber).toBe(5);
  });

  it("wraps metadata-fetch failures as METADATA_FETCH_FAILED", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
    fetchBrandMetadataMock.mockRejectedValue(new Error("network exploded"));

    await expect(
      prepareBid({
        slotNumber: 5,
        email: "a@b.com",
        websiteUrl: "https://a.com",
        bidAmountCents: MINIMUM_BID_CENTS,
      }),
    ).rejects.toMatchObject({ code: "METADATA_FETCH_FAILED" });
  });

  it("propagates the UnsafeUrlError message for SSRF-rejected URLs", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
    fetchBrandMetadataMock.mockRejectedValue(
      new UnsafeUrlError("URLs pointing to private/internal addresses are not allowed"),
    );

    await expect(
      prepareBid({
        slotNumber: 5,
        email: "a@b.com",
        websiteUrl: "http://169.254.169.254",
        bidAmountCents: MINIMUM_BID_CENTS,
      }),
    ).rejects.toMatchObject({
      code: "METADATA_FETCH_FAILED",
      message: "URLs pointing to private/internal addresses are not allowed",
    });
  });

  it("falls back to the user's own details when the site can't be scraped", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
    fetchBrandMetadataMock.mockRejectedValue(new Error("403 from bot protection"));
    prismaMock.advertiser.upsert.mockResolvedValue({ id: "adv-1", email: "a@b.com" });
    prismaMock.advertisement.create.mockResolvedValue({ id: "ad-1" });
    prismaMock.bid.create.mockResolvedValue({ id: "bid-1", amount: MINIMUM_BID_CENTS, status: "PENDING" });

    const result = await prepareBid({
      slotNumber: 5,
      email: "a@b.com",
      websiteUrl: "unreadable.com",
      bidAmountCents: MINIMUM_BID_CENTS,
      brandName: "  Hand Typed Co  ",
      description: "Typed by hand",
      imageUrl: "https://cdn.example.com/logo.png",
    });

    expect(prismaMock.advertisement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brandName: "Hand Typed Co",
          description: "Typed by hand",
          imageUrl: "https://cdn.example.com/logo.png",
          // Normalized from the bare domain the user typed; nothing was fetched.
          websiteUrl: "https://unreadable.com/",
          canonicalUrl: "https://unreadable.com/",
          faviconUrl: null,
        }),
      }),
    );
    expect(result.bid.id).toBe("bid-1");
  });

  it("still fails a failed scrape when the user supplied no brand name to fall back on", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
    fetchBrandMetadataMock.mockRejectedValue(new Error("network exploded"));

    await expect(
      prepareBid({
        slotNumber: 5,
        email: "a@b.com",
        websiteUrl: "https://a.com",
        bidAmountCents: MINIMUM_BID_CENTS,
        brandName: "   ",
      }),
    ).rejects.toMatchObject({ code: "METADATA_FETCH_FAILED" });

    expect(prismaMock.advertisement.create).not.toHaveBeenCalled();
  });

  it("rejects a private-address website even on the manual fallback path", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
    fetchBrandMetadataMock.mockRejectedValue(
      new UnsafeUrlError("URLs pointing to private/internal addresses are not allowed"),
    );

    await expect(
      prepareBid({
        slotNumber: 5,
        email: "a@b.com",
        websiteUrl: "http://169.254.169.254",
        bidAmountCents: MINIMUM_BID_CENTS,
        brandName: "Sneaky Co",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });

    expect(prismaMock.advertisement.create).not.toHaveBeenCalled();
  });

  it("prefers manually supplied brandName/description/imageUrl over scraped metadata", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
    fetchBrandMetadataMock.mockResolvedValue({
      brandName: "Scraped Co",
      description: "scraped desc",
      imageUrl: "https://scraped.com/img.png",
      faviconUrl: "https://scraped.com/favicon.ico",
      canonicalUrl: "https://scraped.com/",
      websiteUrl: "https://scraped.com/",
    });
    prismaMock.advertiser.upsert.mockResolvedValue({ id: "adv-1", email: "a@b.com" });
    prismaMock.advertisement.create.mockResolvedValue({ id: "ad-1" });
    prismaMock.bid.create.mockResolvedValue({ id: "bid-1", amount: MINIMUM_BID_CENTS, status: "PENDING" });

    await prepareBid({
      slotNumber: 5,
      email: "a@b.com",
      websiteUrl: "https://scraped.com",
      bidAmountCents: MINIMUM_BID_CENTS,
      brandName: "My Override Brand",
      description: "My override description",
      imageUrl: "https://override.com/logo.png",
    });

    expect(prismaMock.advertisement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brandName: "My Override Brand",
          description: "My override description",
          imageUrl: "https://override.com/logo.png",
          // websiteUrl/canonicalUrl/faviconUrl always come from server-fetched metadata
          websiteUrl: "https://scraped.com/",
          faviconUrl: "https://scraped.com/favicon.ico",
        }),
      }),
    );
  });

  it("falls back to scraped metadata when overrides are empty strings", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
    fetchBrandMetadataMock.mockResolvedValue({
      brandName: "Scraped Co",
      description: "scraped desc",
      imageUrl: "https://scraped.com/img.png",
      faviconUrl: "https://scraped.com/favicon.ico",
      canonicalUrl: "https://scraped.com/",
      websiteUrl: "https://scraped.com/",
    });
    prismaMock.advertiser.upsert.mockResolvedValue({ id: "adv-1", email: "a@b.com" });
    prismaMock.advertisement.create.mockResolvedValue({ id: "ad-1" });
    prismaMock.bid.create.mockResolvedValue({ id: "bid-1", amount: MINIMUM_BID_CENTS, status: "PENDING" });

    await prepareBid({
      slotNumber: 5,
      email: "a@b.com",
      websiteUrl: "https://scraped.com",
      bidAmountCents: MINIMUM_BID_CENTS,
      brandName: "  ",
      description: "",
      imageUrl: undefined,
    });

    expect(prismaMock.advertisement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brandName: "Scraped Co",
          description: "scraped desc",
          imageUrl: "https://scraped.com/img.png",
        }),
      }),
    );
  });

  it("rejects an unsafe/malformed override imageUrl with UNSAFE_URL", async () => {
    prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
    fetchBrandMetadataMock.mockResolvedValue({
      brandName: "Scraped Co",
      description: "scraped desc",
      imageUrl: "https://scraped.com/img.png",
      faviconUrl: "https://scraped.com/favicon.ico",
      canonicalUrl: "https://scraped.com/",
      websiteUrl: "https://scraped.com/",
    });

    await expect(
      prepareBid({
        slotNumber: 5,
        email: "a@b.com",
        websiteUrl: "https://scraped.com",
        bidAmountCents: MINIMUM_BID_CENTS,
        imageUrl: "javascript:alert(1)",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });

    expect(prismaMock.advertisement.create).not.toHaveBeenCalled();
  });

  describe("seat-booking reservation lock", () => {
    function mockHappyMetadataAndAdvertiser(advertiserId: string) {
      fetchBrandMetadataMock.mockResolvedValue({
        brandName: "Brand Co",
        description: "desc",
        imageUrl: "https://brand.com/img.png",
        faviconUrl: "https://brand.com/favicon.ico",
        canonicalUrl: "https://brand.com/",
        websiteUrl: "https://brand.com/",
      });
      prismaMock.advertiser.upsert.mockResolvedValue({ id: advertiserId, email: "bidder@brand.com" });
      prismaMock.advertisement.create.mockResolvedValue({ id: "ad-1", brandName: "Brand Co" });
    }

    it("blocks a second bidder while a claim reservation is active on an empty slot", async () => {
      prismaMock.slot.findUnique.mockResolvedValue(emptySlot({ currentBidAmount: 0 }));
      mockHappyMetadataAndAdvertiser("adv-B");

      const reservedUntil = new Date(Date.now() + 3 * 60 * 1000);
      prismaMock.bid.findFirst.mockResolvedValue({
        id: "bid-A",
        advertiserId: "adv-A", // a different bidder than the one preparing this request
        status: "PENDING",
        expiresAt: reservedUntil,
      });

      await expect(
        prepareBid({
          slotNumber: 5,
          email: "b@brand.com",
          websiteUrl: "https://brand.com",
          bidAmountCents: MINIMUM_BID_CENTS,
        }),
      ).rejects.toMatchObject({ code: "SLOT_RESERVED" });

      expect(prismaMock.bid.create).not.toHaveBeenCalled();
    });

    it("blocks a second bidder while an outbid reservation is active on an occupied slot", async () => {
      prismaMock.slot.findUnique.mockResolvedValue(
        emptySlot({ currentBidAmount: 10000, currentAdvertiserId: "owner-1" }),
      );
      mockHappyMetadataAndAdvertiser("adv-B");

      prismaMock.bid.findFirst.mockResolvedValue({
        id: "bid-A",
        advertiserId: "adv-A",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 4 * 60 * 1000),
      });

      await expect(
        prepareBid({
          slotNumber: 5,
          email: "b@brand.com",
          websiteUrl: "https://brand.com",
          bidAmountCents: 10000 + MINIMUM_BID_INCREMENT_CENTS,
        }),
      ).rejects.toMatchObject({ code: "SLOT_RESERVED" });

      expect(prismaMock.bid.create).not.toHaveBeenCalled();
    });

    it("includes a friendly, try-again message with the reservation code", async () => {
      prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
      mockHappyMetadataAndAdvertiser("adv-B");
      prismaMock.bid.findFirst.mockResolvedValue({
        id: "bid-A",
        advertiserId: "adv-A",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      });

      await expect(
        prepareBid({
          slotNumber: 5,
          email: "b@brand.com",
          websiteUrl: "https://brand.com",
          bidAmountCents: MINIMUM_BID_CENTS,
        }),
      ).rejects.toMatchObject({
        code: "SLOT_RESERVED",
        message: expect.stringMatching(/someone else is currently completing a purchase/i),
      });
    });

    it("lets the same bidder renew their own pending reservation instead of blocking them", async () => {
      prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
      mockHappyMetadataAndAdvertiser("adv-A");
      prismaMock.bid.findFirst.mockResolvedValue({
        id: "bid-A-old",
        advertiserId: "adv-A", // same bidder preparing again (e.g. changed their bid amount)
        status: "PENDING",
        expiresAt: new Date(Date.now() + 3 * 60 * 1000),
      });
      prismaMock.bid.create.mockResolvedValue({ id: "bid-A-new", amount: MINIMUM_BID_CENTS, status: "PENDING" });

      const result = await prepareBid({
        slotNumber: 5,
        email: "a@brand.com",
        websiteUrl: "https://brand.com",
        bidAmountCents: MINIMUM_BID_CENTS,
      });

      expect(prismaMock.bid.update).toHaveBeenCalledWith({
        where: { id: "bid-A-old" },
        data: { status: "CANCELLED" },
      });
      expect(prismaMock.bid.create).toHaveBeenCalled();
      expect(result.bid.id).toBe("bid-A-new");
    });

    it("allows a fresh reservation once no active hold exists (e.g. it expired)", async () => {
      prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
      mockHappyMetadataAndAdvertiser("adv-B");
      prismaMock.bid.findFirst.mockResolvedValue(null); // nothing active — default, set explicitly for clarity
      prismaMock.bid.create.mockResolvedValue({ id: "bid-B", amount: MINIMUM_BID_CENTS, status: "PENDING" });

      const result = await prepareBid({
        slotNumber: 5,
        email: "b@brand.com",
        websiteUrl: "https://brand.com",
        bidAmountCents: MINIMUM_BID_CENTS,
      });

      expect(prismaMock.bid.update).not.toHaveBeenCalled();
      expect(result.bid.id).toBe("bid-B");
    });

    it("re-validates the bid amount against fresh slot state inside the lock, rejecting a now-stale amount", async () => {
      // The fast pre-check sees a slot at $100; by the time the row lock is
      // acquired, another bidder's payment has already won the slot at $500 —
      // the authoritative in-transaction check must catch this even though
      // the fast pre-check let it through.
      const staleSlot = emptySlot({ currentBidAmount: 10000, currentAdvertiserId: "owner-1" });
      const freshSlot = emptySlot({ currentBidAmount: 50000, currentAdvertiserId: "owner-2" });
      prismaMock.slot.findUnique.mockResolvedValue(staleSlot);
      prismaMock.slot.findUniqueOrThrow.mockResolvedValueOnce(freshSlot);
      mockHappyMetadataAndAdvertiser("adv-B");

      await expect(
        prepareBid({
          slotNumber: 5,
          email: "b@brand.com",
          websiteUrl: "https://brand.com",
          bidAmountCents: 10000 + MINIMUM_BID_INCREMENT_CENTS, // valid against staleSlot, stale against freshSlot
        }),
      ).rejects.toMatchObject({ code: "BID_TOO_LOW" });

      expect(prismaMock.bid.create).not.toHaveBeenCalled();
    });

    it("holds the slot row lock for the duration of the reservation check", async () => {
      prismaMock.slot.findUnique.mockResolvedValue(emptySlot());
      mockHappyMetadataAndAdvertiser("adv-B");
      prismaMock.bid.create.mockResolvedValue({ id: "bid-B", amount: MINIMUM_BID_CENTS, status: "PENDING" });

      await prepareBid({
        slotNumber: 5,
        email: "b@brand.com",
        websiteUrl: "https://brand.com",
        bidAmountCents: MINIMUM_BID_CENTS,
      });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});

describe("cancelBid", () => {
  it("cancels an active PENDING reservation", async () => {
    prismaMock.bid.findUnique.mockResolvedValue({ id: "bid-1", status: "PENDING" });

    const result = await cancelBid("bid-1");

    expect(prismaMock.bid.update).toHaveBeenCalledWith({
      where: { id: "bid-1" },
      data: { status: "CANCELLED" },
    });
    expect(result).toEqual({ cancelled: true });
  });

  it("is a harmless no-op for a bid that already resolved", async () => {
    prismaMock.bid.findUnique.mockResolvedValue({ id: "bid-1", status: "PAID" });

    const result = await cancelBid("bid-1");

    expect(prismaMock.bid.update).not.toHaveBeenCalled();
    expect(result).toEqual({ cancelled: false });
  });

  it("throws NOT_FOUND for an unknown bid id", async () => {
    prismaMock.bid.findUnique.mockResolvedValue(null);

    await expect(cancelBid("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
