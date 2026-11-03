# Changelog

## Server resilience — 2026-11-03

- Unit systemd utente `uniai.service` installata sul host e abilitata con linger.
- Avvio automatico fuori dalla sandbox della chat.

- Watchdog con lock esclusivo e health check.
- Script idempotente `ensure-uniai.sh`.
- Stato server con `status-uniai.sh`.
- Unit systemd con `Restart=always` e script di installazione.
- Documentato il limite della sandbox senza init system.

## 2.4 — 2026-11-03

- Le attività salvate nel vault vengono rimosse automaticamente dalla cronologia.
- Note e figure nel vault restano sempre intatte.
- Immagini originali e risultati temporanei vengono eliminati dal server dopo il salvataggio.
- La rimozione manuale di un job non salvato elimina tutti i dati temporanei.
- Correzione visualizzazione valori `null`.
- Richiesta `ACCESS_LOCAL_NETWORK` su Android 17.
- Tema chiaro/scuro/automatico.
- Certificate pin TLS opzionale.

## 2.1 — 2026-11-02

- Fix critico per Android 17: permesso runtime `ACCESS_LOCAL_NETWORK`.
- Diagnostica permessi rete, posizione e Wi-Fi.
- Test connessione server dalle impostazioni.
- Fallback impronta rete quando l’SSID non è disponibile.

## 1.0 — 2026-10-31

- Prima release Android distribuibile.
- Upload multi-foto, coda offline e note Obsidian numerate.
