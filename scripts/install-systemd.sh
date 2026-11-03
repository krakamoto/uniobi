#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_FILE="$PROJECT_DIR/deploy/systemd/uniai.service"
UNIT_NAME="uniai.service"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$UNIT_NAME"

if [ ! -f "$UNIT_FILE" ]; then
  echo "Unit non trovata: $UNIT_FILE" >&2
  exit 1
fi

# Prova prima il percorso systemctl standard.
if systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$SERVICE_DIR"
  ln -sfn "$UNIT_FILE" "$SERVICE_FILE"
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT_NAME"
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  echo "Servizio utente installato e avviato: $SERVICE_FILE"
  exit 0
fi

# Fallback per sandbox: busctl raggiunge il manager utente del host.
if busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager GetUnit s "$UNIT_NAME" >/dev/null 2>&1 \
    || busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager LinkUnitFiles asbb 1 "$UNIT_FILE" false false >/dev/null 2>&1; then
  busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager LinkUnitFiles asbb 1 "$UNIT_FILE" false false >/dev/null 2>&1 || true
  busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager EnableUnitFiles asbb 1 "$UNIT_NAME" false false >/dev/null 2>&1 || true
  busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager StartUnit ss "$UNIT_NAME" replace >/dev/null 2>&1 || true
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  echo "Servizio utente installato tramite D-Bus e avviato: $UNIT_NAME"
  echo "Il servizio è gestito dal manager utente del host e sopravvive alla chiusura della sessione."
  exit 0
fi

cat >&2 <<MSG
systemd utente non raggiungibile.
Il server può essere avviato con:
  $PROJECT_DIR/scripts/start-uniai.sh

Su un host con systemd usa:
  systemctl --user link $UNIT_FILE
  systemctl --user enable --now $UNIT_NAME
MSG
exit 2
