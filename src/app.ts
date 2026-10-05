import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import { env } from "./config/env";
import { router } from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { UPLOADS_DIR } from "./lib/uploadsDir";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
      methods: ["GET", "POST"],
    }),
  );
  app.use(compression());
  if (env.NODE_ENV !== "test") {
    app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));
  }

  // The payment webhook route needs the raw request body for signature
  // verification, so it is excluded from the JSON body parser here and
  // parses its own body via express.raw() in routes/index.ts.
  app.use((req, res, next) => {
    if (req.path === "/api/payments/webhook") return next();
    express.json({ limit: "256kb" })(req, res, next);
  });

  // Uploaded ad images. Helmet's default Cross-Origin-Resource-Policy
  // ("same-origin") would let the browser block the frontend (a different
  // origin) from rendering these — override it just for this path.
  app.use(
    "/uploads",
    (_req, res, next) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      next();
    },
    express.static(UPLOADS_DIR, { maxAge: "1y", immutable: true }),
  );

  // Unauthenticated, unprefixed liveness check — this is what the Docker
  // healthcheck and any load balancer / EC2 status check should hit. Kept
  // outside /api so it's never subject to the JSON body parser, CORS origin
  // allowlist, or route-level rate limiting above it.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api", router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
