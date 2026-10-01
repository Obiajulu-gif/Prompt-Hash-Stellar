# syntax=docker/dockerfile:1

# ─── Auxiliary API server (Express + MongoDB) dev image ──────────────────────
# Layer order mirrors the frontend image: dependencies install in their own
# cached layer, application code is bind-mounted at runtime for hot reload.

FROM node:22-bookworm-slim AS base
WORKDIR /app/server
ENV CI=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM deps AS dev
ENV NODE_ENV=development
# nodemon + ts-node restart the server when the bind-mounted sources change.
EXPOSE 5000
CMD ["npm", "run", "dev"]
