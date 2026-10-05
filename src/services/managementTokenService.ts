import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import { MANAGEMENT_TOKEN_BYTES, MANAGEMENT_TOKEN_TTL_DAYS } from "../config/constants";

/**
 * Passwordless "login" via a single-use-per-issuance, cryptographically
 * random management token. The raw token is only ever shown once (in the
 * emailed link) — the database stores only a SHA-256 hash of it, so a
 * database leak alone can never grant access to a spot.
 */

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function generateRawToken(): string {
  return crypto.randomBytes(MANAGEMENT_TOKEN_BYTES).toString("base64url");
}

export async function issueManagementToken(advertiserId: string, slotId: string) {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + MANAGEMENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.managementToken.create({
    data: { advertiserId, slotId, tokenHash, expiresAt },
  });

  return rawToken;
}

export async function resolveManagementToken(rawToken: string) {
  if (!rawToken || rawToken.length < 20) {
    throw new ApiError("MANAGEMENT_TOKEN_INVALID", "Invalid management link.");
  }

  const tokenHash = hashToken(rawToken);
  const record = await prisma.managementToken.findUnique({
    where: { tokenHash },
    include: { advertiser: true },
  });

  if (!record || record.revokedAt) {
    throw new ApiError("MANAGEMENT_TOKEN_INVALID", "This management link is no longer valid.");
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw new ApiError("MANAGEMENT_TOKEN_EXPIRED", "This management link has expired.");
  }

  await prisma.managementToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });

  return record;
}
