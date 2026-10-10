# Build: compile TypeScript and the native better-sqlite3 module, then drop dev dependencies.
FROM node:20-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime: node, plus git and ssh (with ssh-keygen) for the git source of `marian-knows index`, nothing else.
FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/marian-knows.sh /usr/local/bin/marian-knows
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/marian-knows

ENV MARIAN_KNOWS_CONFIG=/data/marian-knows.yml \
  PORT=3000
# Starts as root only to fix /data ownership; entrypoint.sh and marian-knows switch to `node` (UID 1000).
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
