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
# Explicit copies instead of `COPY . .`: keeps .env*, host node_modules and research out of the image.
COPY next.config.ts tsconfig.json ./
COPY src ./src
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Add `COPY --from=build --chown=node:node /app/public ./public` when public/ is created.
USER node
EXPOSE 3000
CMD ["node", "server.js"]
