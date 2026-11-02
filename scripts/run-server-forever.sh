#!/usr/bin/env bash
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${UNIAI_LOG_FILE:-/tmp/uniai.log}"
HEALTH_URL="${UNIAI_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
FAILURES_BEFORE_RESTART="${UNIAI_HEALTH_FAILURES:-3}"

cd "$PROJECT_DIR"
echo "[$(date -Is)] UniAi watchdog avviato in $PROJECT_DIR" >> "$LOG_FILE"

while true; do
  echo "[$(date -Is)] avvio server UniAi" >> "$LOG_FILE"
  node --disable-warning=ExperimentalWarning src/server.js >> "$LOG_FILE" 2>&1 &
  server_pid=$!
  failures=0

  while kill -0 "$server_pid" 2>/dev/null; do
    sleep 3
    if ! kill -0 "$server_pid" 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      failures=0
    else
      failures=$((failures + 1))
      echo "[$(date -Is)] health check fallito ($failures/$FAILURES_BEFORE_RESTART)" >> "$LOG_FILE"
      if [ "$failures" -ge "$FAILURES_BEFORE_RESTART" ]; then
        echo "[$(date -Is)] riavvio forzato del server" >> "$LOG_FILE"
        kill "$server_pid" 2>/dev/null || true
        sleep 2
        kill -9 "$server_pid" 2>/dev/null || true
        break
      fi
    fi
  done

  wait "$server_pid" 2>/dev/null || true
  echo "[$(date -Is)] server terminato; nuovo avvio tra 3 secondi" >> "$LOG_FILE"
  sleep 2
done
