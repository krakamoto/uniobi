#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${UNIAI_TMUX_SESSION:-uniai}"
HEALTH_URL="${UNIAI_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
LOG_FILE="${UNIAI_LOG_FILE:-/tmp/uniai.log}"

is_healthy() {
  curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1
}

if is_healthy; then
  echo "UniAi è già attivo e risponde su $HEALTH_URL."
  exit 0
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "Sessione tmux '$SESSION_NAME' presente ma server non sano: riavvio."
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  pkill -f 'node --disable-warning=ExperimentalWarning src/server.js' 2>/dev/null || true
  sleep 1
fi

tmux new-session -d -s "$SESSION_NAME" "$PROJECT_DIR/scripts/run-server-forever.sh"

for _ in $(seq 1 30); do
  sleep 0.5
  if is_healthy; then
    echo "UniAi avviato nella sessione tmux '$SESSION_NAME'."
    exit 0
  fi
done

echo "Sessione tmux avviata, ma il server non risponde. Controlla $LOG_FILE."
tail -20 "$LOG_FILE" 2>/dev/null || true
exit 1
