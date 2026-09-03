#!/bin/sh
set -eu

if [ -z "${VEGWATCH_ADMIN_EMAIL:-}" ]; then
  echo "VEGWATCH_ADMIN_EMAIL is required" >&2
  exit 1
fi

if [ -z "${VEGWATCH_ADMIN_PASSWORD:-}" ]; then
  echo "VEGWATCH_ADMIN_PASSWORD is required" >&2
  exit 1
fi

if [ "${#VEGWATCH_ADMIN_PASSWORD}" -lt 12 ]; then
  echo "VEGWATCH_ADMIN_PASSWORD must contain at least 12 characters" >&2
  exit 1
fi

case "$VEGWATCH_ADMIN_PASSWORD" in
  CHANGE_ME*)
    echo "Replace the example VEGWATCH_ADMIN_PASSWORD before starting VegWatch" >&2
    exit 1
    ;;
esac

node /app/docker/write-runtime-env.mjs

wrangler d1 migrations apply DB \
  --local \
  --config /app/wrangler.docker.jsonc \
  --env-file /tmp/vegwatch-runtime.env \
  --persist-to /data

exec wrangler dev \
  --local \
  --config /app/wrangler.docker.jsonc \
  --env-file /tmp/vegwatch-runtime.env \
  --ip 0.0.0.0 \
  --port 8080 \
  --persist-to /data \
  --log-level info
