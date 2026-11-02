#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="${UNIAI_HEALTH_URL:-http://127.0.0.1:3000/api/health}"

if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
  exit 0
fi

exec "$PROJECT_DIR/scripts/start-uniai.sh"
