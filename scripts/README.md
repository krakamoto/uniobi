# Script operativi

- `start-uniai.sh` — avvia il server in una sessione tmux con watchdog.
- `stop-uniai.sh` — arresta la sessione e il processo Node.
- `run-server-forever.sh` — ciclo di supervisione usato da `start-uniai.sh`.

## Comandi

```bash
./scripts/start-uniai.sh
./scripts/stop-uniai.sh
```

Il watchdog riavvia il server se il processo Node termina. Dopo un riavvio completo dell’host può essere necessario eseguire nuovamente `start-uniai.sh`.
