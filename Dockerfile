# syntax=docker/dockerfile:1

# Pinned to match .nvmrc/engines - same Node version in dev, CI, and here.
FROM node:24.20-alpine AS build
WORKDIR /app

# Dependencies copied and installed before the rest of the source, so this
# layer only invalidates (and re-runs npm ci) when package*.json actually
# change, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---

FROM node:24.20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Only the build stage's compiled output and the SQL migration files cross
# into this stage - no TypeScript source, no devDependencies (tsc, tsx,
# vitest, eslint), keeping the runtime image to what's actually needed to
# run the server and, separately, apply migrations (node dist/db/migrate.js).
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle

# node:*-alpine images ship a non-root `node` user (uid 1000) already -
# switching to it here is enough, no need to create one.
USER node

EXPOSE 3000

# Hits the same /health route the preHandler exempts via config.public,
# matching what a real load balancer's liveness probe would check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
