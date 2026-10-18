# Amasa on one machine: the web app (port 3000) and the payments service (loopback 4100) together,
# started by scripts/fly-start.sh. Used for Fly.io (see fly.toml and the README), and works with any
# host that gives the container a persistent volume at /data.
FROM node:24-bookworm-slim

# python3, make and g++ are only a fallback for building better-sqlite3 when no prebuilt binary fits.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.33.0

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter web build

# Set after the install and build: they need the dev dependencies.
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "scripts/fly-start.sh"]
