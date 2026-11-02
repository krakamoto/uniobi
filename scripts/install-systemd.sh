#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="uniai.service"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME"

if ! systemctl --user show-environment >/dev/null 2>&1; then
  cat >&2 <<MSG
systemd utente non disponibile in questo ambiente.
Il server continua a funzionare con:
  $PROJECT_DIR/scripts/start-uniai.sh

Su un host Linux con systemd usa questo script come utente normale,
oppure installa deploy/uniai.service.example come servizio di sistema.
MSG
  exit 2
fi

mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=UniAi self-hosted server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/env bash $PROJECT_DIR/scripts/run-server-forever.sh
Restart=always
RestartSec=3
Environment=UNIAI_LOG_FILE=/tmp/uniai.log

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"
echo "Servizio utente installato: $SERVICE_FILE"
echo "Per l'avvio automatico anche senza login: loginctl enable-linger $USER"
