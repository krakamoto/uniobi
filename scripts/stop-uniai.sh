#!/usr/bin/env bash
set -u

SESSION_NAME="${UNIAI_TMUX_SESSION:-uniai}"
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  tmux kill-session -t "$SESSION_NAME"
  echo "Sessione tmux '$SESSION_NAME' terminata."
else
  echo "Nessuna sessione tmux '$SESSION_NAME' trovata."
fi
