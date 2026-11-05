# Changelog

## Indici canonici — 2026-11-05

- Gli indici ignorano i duplicati senza numero quando esiste la nota numerata.
- Eliminate 57 voci duplicate dagli indici.
- Ogni link degli indici punta a un file Markdown reale.

## Wikilink numerati tra note — 2026-11-05

- I nuovi link tra note dello stesso caricamento vengono normalizzati dopo l'assegnazione dei numeri.
- `findVaultNote` preferisce la versione numerata quando esistono duplicati senza numero.
- Aggiunto `vault:normalize-links` e `vault:check-unumbered-links`.
- Rimossi avvisi obsoleti su wikilink che ora esistono.
- Aggiunti collegamenti curati nelle note di spaceflight in magistrale.

## Rinumerazione note — 2026-11-05

- Aggiunto `vault:renumber` per verificare i buchi di numerazione.
- Aggiunto `vault:renumber:apply` per rinumerare e aggiornare i wikilink.
- Rinumerate 28 note generate da UniAi in spaceflight e aerospace dynamic systems analysis.
- Indici rigenerati e zero wikilink orfani.

## Pulizia wikilink orfani — 2026-11-05

- Aggiunto scanner dei wikilink verso note inesistenti.
- Aggiunto comando `vault:clean-links` con backup consigliato.
- Pulizia automatica dopo `DELETE`/`MOVE` WebDAV.
- Gli allegati immagine restano invariati.

## Figure dai PDF — 2026-11-05

- Le pagine PDF testuali con immagini o riferimenti a figure vengono rasterizzate.
- Le figure possono essere ritagliate e salvate in `Allegati/` come per le foto.
- Aggiunto `PDF_RENDER_FIGURE_PAGES` e `PDF_FIGURE_RENDER_MAX_SIDE`.
- Statistiche PDF con numero di pagine figura.
- Versione Android 2.9.2.

## Fix selezione PDF Android — 2026-11-05

- Risolto conflitto tra `REQUEST_PICK_PDF` e `REQUEST_CAMERA`.
- Il PDF selezionato viene ora aggiunto correttamente alla lista.
- Messaggio esplicito quando il selettore PDF restituisce un risultato vuoto.
- Versione Android 2.9.1.

## PDF a blocchi e UI 2.9 — 2026-11-05

- PDF divisi automaticamente in parti da massimo 6 pagine.
- Analisi AI separata per ogni parte e unione dei risultati.
- Rimappatura globale delle figure tra le parti.
- Pulsante PDF separato dall’app Android.
- Visualizzazione del numero di parti PDF nel dettaglio attività.
- Limite PDF aggiornato a 60 pagine con massimo 10 parti.

## Supporto PDF — 2026-11-05

- Upload di PDF oltre a JPG, PNG, WebP, GIF e HEIC/HEIF.
- Estrazione del testo dai PDF digitali per evitare token vision inutili.
- Rasterizzazione automatica delle sole pagine scansionate o senza testo.
- Limiti configurabili per pagine per file, pagine per job e immagini visive.
- Supporto PDF nella Web UI e nell’app Android (versione 2.8).
- Docker include `poppler-utils` per `pdfinfo`, `pdftotext` e `pdftoppm`.
- Il dettaglio job mostra quante pagine PDF sono state lette come testo o come immagine.

## Revisione manuale delle parti illeggibili — 2026-11-05

- `AI_FALLBACK_ON_ILLEGIBLE=false` come default.
- Warning inline `[!warning] Parte illeggibile` richiesto al modello.
- Warning specifici con indice immagine.
- Il fallback Sonnet non viene più attivato da bassa confidenza o trascrizione breve quando il problema è solo l’illeggibilità.
- La copertura immagini e gli errori strutturali continuano ad attivare il fallback.

## Controllo costi AI — 2026-11-05

- Limite al fallback foto-per-foto: massimo 6 immagini.
- Massimo 10 chiamate AI per job.
- Retry ridotti a 4 tentativi.
- Fallback Sonnet non più attivato da ogni warning di illeggibilità.
- Output Markdown e trascrizione più concisi.
- Log persistente dei token in `data/ai-usage.jsonl`.
- Comando `npm run ai:usage` per il riepilogo.

## Stabilità selezione 50 immagini — 2026-11-05

- Miniature della selezione caricate con `inSampleSize` e `RGB_565`.
- Rimozione del decoding a piena risoluzione tramite `ImageView.setImageURI`.
- Rendering batch dopo la selezione multipla.
- Aggiornamento del dettaglio immagini senza ricreare 50 decode duplicati.
- Versione Android 2.7.

## 2.6 — 2026-11-05

- Limite upload aumentato da 10 a 50 immagini per volta.
- Limite web letto dinamicamente da `MAX_FILES_PER_UPLOAD` tramite `/api/health`.
- Selettore Android aggiornato a 50 immagini.
- Web UI e messaggi di errore aggiornati con il limite effettivo.
- Test di integrazione con 12 immagini in un singolo upload.

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
