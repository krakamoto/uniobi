#!/usr/bin/env bash
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${UNIAI_TMUX_SESSION:-uniai}"
HEALTH_URL="${UNIAI_HEALTH_URL:-http://127.0.0.1:3000/api/health}"

echo "Progetto: $PROJECT_DIR"
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "Sessione tmux: attiva ($SESSION_NAME)"
else
  echo "Sessione tmux: assente"
fi

response="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
if [ -n "$response" ]; then
  echo "Health: OK"
  echo "$response"
else
  echo "Health: NON DISPONIBILE"
  exit 1
fi
