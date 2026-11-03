#!/usr/bin/env bash
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${UNIAI_TMUX_SESSION:-uniai}"
# shellcheck source=systemd-helpers.sh
source "$PROJECT_DIR/scripts/systemd-helpers.sh"

stopped_something=0

if uniai_systemd_active; then
  if uniai_systemd_stop; then
    echo "Unit systemd '$UNIAI_SYSTEMD_UNIT' arrestata."
    stopped_something=1
  else
    echo "Impossibile arrestare la unit '$UNIAI_SYSTEMD_UNIT'." >&2
    exit 1
  fi
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  tmux kill-session -t "$SESSION_NAME"
  echo "Sessione tmux '$SESSION_NAME' terminata."
  stopped_something=1
fi

if [ "$stopped_something" -eq 0 ]; then
  echo "Nessun servizio UniAi attivo."
fi
