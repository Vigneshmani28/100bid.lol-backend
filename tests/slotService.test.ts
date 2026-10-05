import { describe, expect, it, vi } from "vitest";

// slotService imports the Prisma singleton at module load time, and the
// real client throws until `prisma generate` has been run. Mock it so this
// pure-logic test never touches Prisma or a database.
vi.mock("../src/lib/prisma", () => ({
  prisma: {
    slot: { findMany: vi.fn(), findUnique: vi.fn() },
    ownershipHistory: { findMany: vi.fn() },
  },
}));

import { minimumNextBidCents } from "../src/services/slotService";
import { MINIMUM_BID_CENTS, MINIMUM_BID_INCREMENT_CENTS } from "../src/config/constants";

describe("minimumNextBidCents", () => {
  it("returns the base minimum bid for an empty slot", () => {
    expect(minimumNextBidCents(0, false)).toBe(MINIMUM_BID_CENTS);
  });

  it("returns current bid + increment for an occupied slot", () => {
    expect(minimumNextBidCents(10000, true)).toBe(10000 + MINIMUM_BID_INCREMENT_CENTS);
  });

  it("ignores the stored current bid amount for an unoccupied slot", () => {
    // A slot can have a stale currentBidAmount of 0 while unoccupied; the
    // minimum should always be the flat starting bid, never derived from it.
    expect(minimumNextBidCents(999999, false)).toBe(MINIMUM_BID_CENTS);
  });
});
