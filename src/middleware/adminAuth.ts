import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { ApiError } from "../lib/errors";

/**
 * Gate for the /api/admin/* routes. There's no user/session/role model
 * anywhere else in this app (advertisers are only ever identified by an
 * opaque management token scoped to one slot), so a full auth system would
 * be a lot of new surface area for a single internal stats page. This is
 * deliberately the simplest thing that isn't "wide open": a long random
 * shared secret, set once in the backend env and entered by hand into the
 * admin page (which then remembers it in localStorage for next time).
 */
export function requireAdminToken(req: Request, _res: Response, next: NextFunction) {
  if (!env.ADMIN_STATS_TOKEN) {
    throw new Error(
      "ADMIN_STATS_TOKEN is not configured. Set it in the backend env to enable /api/admin/* routes.",
    );
  }

  const provided = req.headers["x-admin-token"];
  if (provided !== env.ADMIN_STATS_TOKEN) {
    throw new ApiError("ADMIN_UNAUTHORIZED", "Invalid or missing admin token.");
  }

  next();
}
