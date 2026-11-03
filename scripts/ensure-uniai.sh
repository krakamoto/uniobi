#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="${UNIAI_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
# shellcheck source=systemd-helpers.sh
source "$PROJECT_DIR/scripts/systemd-helpers.sh"

if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
  exit 0
fi

if uniai_systemd_loaded; then
  uniai_systemd_start
  for _ in $(seq 1 30); do
    sleep 0.5
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      exit 0
    fi
  done
  echo "UniAi non risponde dopo il riavvio della unit systemd." >&2
  exit 1
fi

exec "$PROJECT_DIR/scripts/start-uniai.sh"
