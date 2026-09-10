# syntax=docker/dockerfile:1

FROM node:22-bookworm AS web-build
WORKDIR /app/web
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-bookworm AS server-deps
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --omit=dev

# Public web/API — no Docker CLI, no docker.sock
FROM node:22-bookworm-slim AS web
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=web-build /app/web/dist ./web/dist
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    STATIC_DIR=/app/web/dist
RUN mkdir -p /data/sessions
EXPOSE 8080
CMD ["node", "server/src/index.js"]

# Internal runner — Docker CLI + sock for Composer (runc) and PHP (runsc)
FROM node:22-bookworm-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY runners ./runners
ENV NODE_ENV=production \
    PORT=8081 \
    DATA_DIR=/data \
    PHP_INI_PATH=/app/runners/php.ini \
    PHP_RUNTIME=runsc
RUN mkdir -p /data/sessions
EXPOSE 8081
# Root is required to talk to the mounted docker.sock by default.
CMD ["node", "server/src/runner.js"]
