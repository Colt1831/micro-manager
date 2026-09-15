# ─── Builder Stage ─────────────────────────────────────────────
FROM node:26-alpine AS builder

# Upgrade corepack to support pnpm@10 signature verification
RUN npm install -g corepack@latest && corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Install dependencies (separate from source for layer caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* vars are inlined into client AND server bundles at build time
# (runtime overrides are ignored), so the app URL must be baked in here — Render
# passes it via BUILDARG_NEXT_PUBLIC_APP_URL. Export it only when provided:
# an empty value would bypass every `?? https://...` fallback in the codebase.
ARG NEXT_PUBLIC_APP_URL
RUN if [ -n "${NEXT_PUBLIC_APP_URL}" ]; then export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL}"; fi && pnpm --filter @workmanagement/web build

# ─── Runner Stage ─────────────────────────────────────────────
FROM node:26-alpine AS runner

# Create non-root user
RUN addgroup --system app && adduser --system --ingroup app app

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Copy standalone output (includes server.js + minimal node_modules)
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
# Copy static assets (not included in standalone output)
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
# Copy public assets (if they exist — may be empty/untracked)
COPY --from=builder --chown=app:app /app/apps/web/public/ ./apps/web/public/

# Copy the database package (schema + migration SQL) so the Render
# preDeployCommand can run `drizzle-kit migrate` + `tsx seed` inside
# this image — the standalone output does not include it.
# Toolchain versions are pinned to what pnpm-lock.yaml resolves, and
# installed with --no-save so package.json/package-lock stay untouched.
COPY --from=builder --chown=app:app /app/packages/database ./packages/database
# Install into a clean dir (rm -rf guards against any stray node_modules from
# the builder copy) so the pinned toolchain is guaranteed present and usable.
# --include=dev is required: NODE_ENV=production otherwise makes npm omit
# devDependencies, and drizzle-kit/tsx (the migrate/seed toolchain) are devDeps.
RUN rm -rf packages/database/node_modules && cd packages/database && npm install --no-save --no-package-lock --include=dev --no-audit --no-fund \
    drizzle-kit@0.30.6 drizzle-orm@0.45.2 postgres@3.4.9 zod@3.25.76 tsx@4.23.0

# Switch to non-root user
USER app

# Expose port
EXPOSE 3000

# Start standalone server
CMD ["node", "apps/web/server.js"]
