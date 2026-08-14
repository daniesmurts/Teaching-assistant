# syntax=docker/dockerfile:1
#
# Backend API image — docs/on-prem-deployment.md §16 Track 1.3.
#
# This is the source→artifact inversion: today deploy.sh rsyncs the working
# tree and runs `tsc` on the production VM. An immutable image means the
# compiler never runs in production, rollback is repointing a tag, and the
# same artifact can be handed to a self-managed customer later.
#
# BUILD CONTEXT IS THE REPO ROOT, not backend/ — the backend imports
# ../shared/types.ts and the reproducible install needs the root
# package-lock.json. Build with:
#   docker build -f backend/Dockerfile --build-arg BUILD_VERSION="$(cat VERSION)" .
#
# Debian (-slim), NOT Alpine: @resvg/resvg-js and pdfjs-dist's @napi-rs/canvas
# ship linux-x64-GNU prebuilds. On musl they would fall back to a source build
# (or fail), which would break PPTX formula rendering and PDF rasterisation —
# both of which have test coverage that would pass locally and fail in prod.

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Manifests first so the dependency layer caches independently of source
# changes. All workspace manifests are required — npm ci validates the whole
# workspace tree against the lockfile and fails if one is missing.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci

COPY shared/ shared/
COPY backend/ backend/

# tsc has rootDir "../" and include ["src/**/*", "../shared/**/*"], so the
# emitted entry point is dist/backend/src/index.js — not dist/index.js. Assert
# it, because a silent layout change here would only surface as a container
# that exits immediately.
RUN npm run build --workspace=backend \
 && test -f backend/dist/backend/src/index.js

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

# --omit=dev drops TypeScript, vitest and friends. The frontend workspace's
# runtime deps come along (it shares the lockfile); a few MB, and splitting the
# lockfile to avoid it would cost more than it saves.
RUN npm ci --omit=dev \
 && npm cache clean --force

COPY --from=builder /app/backend/dist backend/dist

# Migrations and the runner ship with the image so an operator can migrate with
# the exact code that will serve the traffic — the on-prem upgrade path depends
# on this, and it removes the "which migrations does this build expect?"
# question from cloud deploys too.
COPY backend/migrations backend/migrations
COPY backend/scripts/migrate.js backend/scripts/migrate.js
COPY backend/assets backend/assets

# Same string deploy.sh writes: "1.5.0 (2026-08-15+abc1234)". lib/version.ts
# reads it as ../VERSION relative to cwd (=/app/backend), so it lands at /app.
ARG BUILD_VERSION=dev
RUN echo "$BUILD_VERSION" > /app/VERSION

# Local-disk fallback for uploads when object storage isn't configured
# (services/documents.ts). Created here so it exists and is writable by the
# unprivileged user; in cloud and on-prem this is normally a mounted volume.
RUN mkdir -p /app/backend/uploads && chown -R node:node /app/backend/uploads

# cwd MUST be /app/backend: lib/version.ts reads ../VERSION and the production
# PM2 config uses the same cwd, so paths resolve identically in both.
WORKDIR /app/backend

USER node

EXPOSE 3000

# Config comes from the container environment, never a baked .env — which is
# why this bypasses `npm start` (that passes --env-file=../.env and would fail
# on a file that must not exist in an image).
CMD ["node", "dist/backend/src/index.js"]
