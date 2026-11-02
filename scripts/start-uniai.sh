#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${UNIAI_TMUX_SESSION:-uniai}"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "UniAi è già in esecuzione nella sessione tmux '$SESSION_NAME'."
  exit 0
fi

tmux new-session -d -s "$SESSION_NAME" "$PROJECT_DIR/scripts/run-server-forever.sh"
sleep 2
if curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo "UniAi avviato nella sessione tmux '$SESSION_NAME'."
else
  echo "Sessione tmux avviata, ma il server non risponde ancora. Controlla /tmp/uniai.log."
  exit 1
fi
