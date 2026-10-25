# Root Dockerfile — image self-contained untuk PaaS (ngelinx.com, dll).
# Build context = root repo. Mem-bake konten challenge ke dalam image sehingga
# TIDAK perlu volume mount (berbeda dari compose.yaml yang mount ./challenge).
#
# Catatan: ngelinx meng-inject env PORT; aplikasi bind ke process.env.PORT.
# syntax=docker/dockerfile:1

# --- Build stage ----------------------------------------------------------
FROM node:20.18.1-bookworm-slim AS build
WORKDIR /app
COPY app/package.json app/package-lock.json* ./
RUN npm ci || npm install
COPY app/tsconfig.json ./
COPY app/src ./src
RUN npm run build && npm prune --omit=dev

# --- Runtime stage --------------------------------------------------------
FROM node:20.18.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY app/public ./public

# Bake konten challenge (read-only secara logis; dibaca backend saja).
COPY challenge /opt/challenge
ENV CHALLENGE_DIR=/opt/challenge
ENV CHALLENGE_ID=operation-phishing-trail

# Default; ngelinx biasanya meng-override PORT.
ENV PORT=8080
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s \
  CMD ["node", "dist/healthcheck.js"]

CMD ["node", "dist/main.js"]
