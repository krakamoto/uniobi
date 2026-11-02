# Deploy

## HTTPS con Caddy

1. Copia `Caddyfile.example` in una configurazione Caddy.
2. Sostituisci `uniai.example.com` con il dominio o nome Tailscale.
3. Avvia Caddy davanti a UniAi sulla porta `3000`.
4. Imposta nell’app Android l’URL `https://...`.

## HTTPS diretto Node.js

Imposta nel `.env`:

```env
TLS_CERT_PATH=/percorso/fullchain.pem
TLS_KEY_PATH=/percorso/privkey.pem
COOKIE_SECURE=true
```

Per l’accesso da rete esterna preferisci Tailscale o WireGuard.

## Docker

I file `Dockerfile` e `docker-compose.yml` restano nella radice del repository per compatibilità con `docker compose up`.
