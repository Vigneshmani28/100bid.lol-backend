import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    managementToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../src/lib/prisma", () => ({ prisma: prismaMock }));

import { generateRawToken, issueManagementToken, resolveManagementToken } from "../src/services/managementTokenService";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateRawToken", () => {
  it("generates sufficiently long, url-safe, non-repeating tokens", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("issueManagementToken", () => {
  it("persists only a hash of the token, never the raw token", async () => {
    prismaMock.managementToken.create.mockResolvedValue({});

    const rawToken = await issueManagementToken("adv-1", "slot-1");

    expect(prismaMock.managementToken.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.managementToken.create.mock.calls[0][0];
    expect(createArgs.data.advertiserId).toBe("adv-1");
    expect(createArgs.data.slotId).toBe("slot-1");
    expect(createArgs.data.tokenHash).not.toBe(rawToken);
    expect(createArgs.data.tokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });
});

describe("resolveManagementToken", () => {
  it("rejects obviously invalid (too-short) tokens without a DB lookup", async () => {
    await expect(resolveManagementToken("short")).rejects.toMatchObject({
      code: "MANAGEMENT_TOKEN_INVALID",
    });
    expect(prismaMock.managementToken.findUnique).not.toHaveBeenCalled();
  });

  it("rejects tokens with no matching record", async () => {
    prismaMock.managementToken.findUnique.mockResolvedValue(null);

    await expect(resolveManagementToken("a".repeat(32))).rejects.toMatchObject({
      code: "MANAGEMENT_TOKEN_INVALID",
    });
  });

  it("rejects revoked tokens", async () => {
    prismaMock.managementToken.findUnique.mockResolvedValue({
      id: "tok-1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 100000),
    });

    await expect(resolveManagementToken("a".repeat(32))).rejects.toMatchObject({
      code: "MANAGEMENT_TOKEN_INVALID",
    });
  });

  it("rejects expired tokens", async () => {
    prismaMock.managementToken.findUnique.mockResolvedValue({
      id: "tok-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(resolveManagementToken("a".repeat(32))).rejects.toMatchObject({
      code: "MANAGEMENT_TOKEN_EXPIRED",
    });
  });

  it("accepts a valid token and touches lastUsedAt", async () => {
    prismaMock.managementToken.findUnique.mockResolvedValue({
      id: "tok-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100000),
      advertiser: { id: "adv-1" },
    });
    prismaMock.managementToken.update.mockResolvedValue({});

    const record = await resolveManagementToken("a".repeat(32));

    expect(record.advertiser).toEqual({ id: "adv-1" });
    expect(prismaMock.managementToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tok-1" } }),
    );
  });
});
