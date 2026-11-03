# One image for app and worker (DEL-4): multi-stage, Next.js standalone output, non-root.
# Node 26 ships without corepack, so pnpm is installed at the version pinned in package.json.
ARG NODE_IMAGE=node:26.13.0-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Keep in step with package.json "packageManager" (pnpm refuses a mismatch).
RUN npm install -g pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
# Explicit copies (and .dockerignore): .env*, host node_modules and research stay out.
COPY next.config.ts tsconfig.json ./
COPY src ./src
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Production dependencies only, for the migration runner (the Next.js standalone trace
# does not include drizzle-orm's migrator).
FROM deps AS prod-deps
RUN pnpm install --frozen-lockfile --prod --offline

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Add `COPY --from=build --chown=node:node /app/public ./public` when public/ is created.
# Migrations: `docker run <image> node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
# /app/migrate/src/db/migrate.ts` with DATABASE_URL set to the migration role.
# Root-owned and read-only for the runtime user. lazy: the full production node_modules
# is copied (~duplicates the standalone trace); bundle the runner if image size matters.
COPY --from=prod-deps /app/node_modules ./migrate/node_modules
COPY package.json ./migrate/package.json
COPY src/db/migrate.ts ./migrate/src/db/migrate.ts
# First platform owner (DEC-036), once per server, from the server terminal:
#   cd /app/migrate && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/db/vendor-bootstrap.ts \
#     --email ... --nama "..." --cidr ... --label "..."   (DATABASE_URL = migration role; password prompted)
COPY src/db/vendor-bootstrap.ts ./migrate/src/db/vendor-bootstrap.ts
COPY src/auth/policy.ts ./migrate/src/auth/policy.ts
COPY drizzle ./migrate/drizzle
USER node
EXPOSE 3000
CMD ["node", "server.js"]
