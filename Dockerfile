# 100BID backend — Express + Prisma, built for production and run on EC2.
#
# Build from the backend/ directory:
#   docker build -t 100bid-backend:latest .
#
# Debian slim (not Alpine) on purpose: Prisma's query engine has known
# friction with musl libc on Alpine, and the size difference doesn't matter
# on a t3.small.

# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run prisma:generate
RUN npm run build

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash app

# Full node_modules (including the Prisma CLI and tsx) is carried into the
# runtime image on purpose: `prisma migrate deploy` and `prisma/seed.ts` are
# both run as one-off commands against this same image on the EC2 host, and
# reinstalling a pruned, prod-only node_modules just for that isn't worth the
# fragility. `src` ships alongside `dist` for the same reason — seed.ts runs
# via tsx directly against the raw .ts source (it imports
# ../src/config/constants), it's never executed from the compiled dist/.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Mounted as a named volume in docker-compose.prod.yml so uploaded images
# survive container restarts/redeploys instead of living in the writable
# container layer.
RUN mkdir -p uploads && chown -R app:app /app

USER app
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:4000/health || exit 1

CMD ["node", "dist/src/server.js"]