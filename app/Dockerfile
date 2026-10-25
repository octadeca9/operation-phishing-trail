# syntax=docker/dockerfile:1

# --- Build stage ----------------------------------------------------------
FROM node:20.18.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Runtime stage --------------------------------------------------------
FROM node:20.18.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Dependency produksi & artefak build.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY public ./public

# Jalankan sebagai user non-root bawaan image node (uid 1000).
USER node

ENV PORT=8080
EXPOSE 8080

# HEALTHCHECK memakai executable /app (lihat compose: /app/healthcheck).
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s \
  CMD ["node", "dist/healthcheck.js"]

CMD ["node", "dist/main.js"]
