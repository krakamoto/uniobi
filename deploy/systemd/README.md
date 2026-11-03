# Servizio systemd utente

`uniai.service` è la unit usata dal manager systemd dell’utente.

- `WorkingDirectory=%h/UniAi/uniai`
- `ExecStart=%h/UniAi/uniai/scripts/run-server-forever.sh`
- `Restart=always`
- `WantedBy=default.target`

Installazione:

```bash
cd /home/giacomo/UniAi/uniai
npm run service:install-systemd
loginctl enable-linger "$USER"
```

Verifica:

```bash
npm run service:status
```

La unit viene installata tramite symlink in `~/.config/systemd/user/`; il file sorgente resta nel repository.
