FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV CI=true \
    NODE_ENV=production \
    NO_UPDATE_NOTIFIER=1 \
    WRANGLER_SEND_METRICS=false

RUN npm install --global wrangler@4.92.0 \
    && npm cache clean --force \
    && mkdir -p /app /data \
    && chown -R node:node /app /data

WORKDIR /app

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --chown=node:node wrangler.docker.jsonc ./wrangler.docker.jsonc
COPY --chown=node:node docker/entrypoint.sh ./docker/entrypoint.sh
COPY --chown=node:node docker/write-runtime-env.mjs ./docker/write-runtime-env.mjs

RUN chmod 755 /app/docker/entrypoint.sh

USER node

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=35s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/app/docker/entrypoint.sh"]
