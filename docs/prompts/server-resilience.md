# Prompt — Resilienza e riavvio automatico del server

## Obiettivo

Garantire che il backend UniAi torni operativo automaticamente dopo:

- crash del processo Node.js;
- crash del watchdog;
- arresto manuale dello script;
- riavvio della macchina, quando è disponibile un init system.

## Vincoli

- L’ambiente sandbox attuale usa `bwrap` come PID 1 e non ha systemd attivo.
- Un processo utente non può sopravvivere alla distruzione completa della sandbox.
- La soluzione deve funzionare sia in locale sia su un host Linux con systemd.
- Non devono essere avviati processi duplicati.
- Il server deve essere considerato sano solo se `/api/health` risponde HTTP 200.

## Implementazione richiesta

1. Watchdog con lock esclusivo.
2. Health check periodico.
3. Riavvio del processo Node dopo uscita o fallimento health.
4. Script `start-uniai.sh` idempotente, capace di rilevare una sessione stale.
5. Script `ensure-uniai.sh` richiamabile da cron, timer systemd o monitor esterno.
6. Script `status-uniai.sh`.
7. Unit systemd con `Restart=always` e avvio al boot.
8. Script di installazione della unit con fallback chiaro se systemd non è disponibile.
9. Documentazione del limite della sandbox.

## Criteri di accettazione

- Se il processo Node viene terminato, il server torna sano entro pochi secondi.
- Se il server è spento, `ensure-uniai.sh` lo riavvia.
- `start-uniai.sh` non crea duplicati.
- Su un host con systemd, la unit parte al boot e si riavvia da sola.
- `npm test` e `npm run check` restano verdi.
