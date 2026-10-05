import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

declare global {
  var __prisma: PrismaClient | undefined;
}

/**
 * Singleton Prisma client. In dev, reuse across hot reloads to avoid
 * exhausting the connection pool.
 */
export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
