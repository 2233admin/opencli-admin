#!/usr/bin/env bash
# Deploy opencli-admin NAS stack with III control plane.
# Usage (on NAS): ./iii/scripts/deploy-nas.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env}"
EXAMPLE="${ROOT}/.env.nas.example"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$EXAMPLE" ]]; then
    echo "Creating $ENV_FILE from .env.nas.example — edit secrets before production."
    cp "$EXAMPLE" "$ENV_FILE"
  else
    echo "Missing $ENV_FILE and .env.nas.example" >&2
    exit 1
  fi
fi

echo "==> Building III workers + ODP (profile: nas)"
docker compose --env-file "$ENV_FILE" --profile nas build \
  odp-ingest odp-store \
  iii-odp-ingest-bridge iii-schedule-bootstrap iii-collector-opencli

echo "==> Starting NAS stack"
docker compose --env-file "$ENV_FILE" --profile nas up -d

echo "==> Status"
docker compose --env-file "$ENV_FILE" --profile nas ps

echo ""
echo "NAS III stack up."
echo "  UI:        http://$(hostname -I 2>/dev/null | awk '{print $1}'):${FRONTEND_PORT:-8030}"
echo "  API:       http://$(hostname -I 2>/dev/null | awk '{print $1}'):${API_PORT:-8031}"
echo "  ODP ingest: :${ODP_INGEST_PORT:-8040}"
echo "  III WS:    :${III_WS_PORT:-49134}"
echo ""
echo "Edit schedules: iii/schedules/opencli.yaml, iii/schedules/discord.yaml"
echo "Reload cron:    iii trigger odp.schedule::reload  (from host with iii CLI)"