# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Install deps from root package.json (includes @google-cloud/bigquery, zod, typescript, etc.)
COPY package.json package-lock.json ./
RUN npm ci

# Copy only the source directories the job needs
COPY cloud-run-job/ ./cloud-run-job/
COPY server/ ./server/
COPY src/ ./src/

# Compile — outDir is ../dist relative to cloud-run-job/tsconfig.json, i.e. /app/dist
RUN npx tsc -p cloud-run-job/tsconfig.json

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Minimal production deps for the job container
COPY cloud-run-job/package.json ./package.json
RUN npm install --production --no-package-lock

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
# Resolves 'server-only' to its empty variant (empty.js) instead of the throwing index.js.
# Required because server/ files use `import 'server-only'` to prevent client-side imports.
ENV NODE_OPTIONS=--conditions=react-server

CMD ["node", "dist/cloud-run-job/index.js"]
