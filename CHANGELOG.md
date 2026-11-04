# Changelog

## Ottimizzazione immagini e token — 2026-11-03

- Crop sicuro dei margini con verifica della perdita di contenuto.
- Fallback all’immagine originale quando il crop è incerto.
- Ridimensionamento prudente a 1600 px.
- Tracking di token input/output/cache per job.
- Statistiche immagini elaborate, crop e dimensioni finali.
- Visualizzazione dei token nell’app Android e nella Web UI.

## Claude Batch Haiku → Sonnet — 2026-11-03

- Aggiunto provider Claude/Anthropic.
- Haiku 5.5 primario e Sonnet 5.5 per fallback di precisione.
- Supporto Message Batches API con sconto del 50%.
- Polling del batch e recupero dei risultati JSONL.
- Fallback di emergenza DeepSeek configurabile.
- Testato il flusso batch con mock e la catena di emergenza.

## Provider DeepSeek Flash — 2026-11-03

- Aggiunto provider `deepseek` con API OpenAI-compatible.
- Supporto input immagini tramite `image_url` data URL.
- Configurabile come provider primario o fallback di Gemini.
- Thinking mode disabilitato per l’estrazione JSON vision.
- Limite output predefinito di 32768 token per DeepSeek Flash.
- Testata la costruzione della richiesta e una chiamata reale con immagine.
- Configurato DeepSeek Flash come provider primario con fallback Gemini.

## Analisi AI resiliente — 2026-11-03

- Retry automatico Gemini su 503, 429, timeout e risposte incomplete.
- Backoff esponenziale con jitter.
- Campo `analyzedImageIndexes` per verificare la copertura di tutte le foto.
- Fallback per singola immagine quando il batch è incompleto.
- Nessun salvataggio di note parziali.

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
