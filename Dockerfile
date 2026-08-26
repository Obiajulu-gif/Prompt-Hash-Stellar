# syntax=docker/dockerfile:1

# ─── Frontend (Vite) dev image ────────────────────────────────────────────────
# Multi-stage build that isolates dependency installation from application code
# so the (expensive) install layer is cached and only re-runs when the manifest
# or lockfile changes — keeping rebuilds fast during local development.

FROM node:22-bookworm-slim AS base
WORKDIR /app
# Corepack ships the pinned Yarn version declared in package.json#packageManager.
RUN corepack enable
ENV CI=1

# ─── deps: install node_modules from the lockfile only ───────────────────────
FROM base AS deps
# Copy just the files that influence dependency resolution first. Source changes
# below this layer will not bust the cached dependency install.
COPY package.json yarn.lock .yarnrc.yml ./
# BuildKit cache mount keeps Yarn's global cache warm across builds.
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn install --immutable

# ─── dev: hot-reloading development server ────────────────────────────────────
# Source is bind-mounted at runtime (see docker-compose.yml); node_modules lives
# in the image / a named volume so host and container never clobber each other.
FROM deps AS dev
ENV NODE_ENV=development
# Vite dev server. host/polling are enabled via env in docker-compose.yml so file
# changes on the host propagate into the container on every platform.
EXPOSE 5173
CMD ["yarn", "dev"]
