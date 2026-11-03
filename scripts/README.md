# Script operativi

- `run-server-forever.sh` — watchdog con lock, health check e riavvio automatico.
- `start-uniai.sh` — avvio idempotente in tmux; rileva sessioni stale.
- `ensure-uniai.sh` — avvia il server solo se `/api/health` non risponde.
- `status-uniai.sh` — mostra stato tmux, health e risposta JSON.
- `stop-uniai.sh` — arresta la sessione e il processo Node.
- `install-systemd.sh` — installa la unit utente systemd con `Restart=always`.
- `systemd-helpers.sh` — helper D-Bus con fallback `busctl --user` per sandbox.

## Comandi

```bash
./scripts/start-uniai.sh
./scripts/ensure-uniai.sh
./scripts/status-uniai.sh
./scripts/stop-uniai.sh
./scripts/install-systemd.sh
```

## Uso da cron o timer

`ensure-uniai.sh` è idempotente e può essere richiamato ogni minuto da cron o da un timer systemd:

```cron
* * * * * /home/giacomo/UniAi/uniai/scripts/ensure-uniai.sh >/dev/null 2>&1
```

Il watchdog interno riavvia Node per crash e health check falliti. La unit utente `uniai.service` è installata e abilitata con linger sul host, quindi sopravvive alla chiusura della sessione della chat.
