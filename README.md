# UniAi

UniAi è una web app self-hosted con app Android nativa che trasforma le foto degli appunti presi a lezione in note Markdown per Obsidian. L’analisi AI può usare Gemini, un provider OpenAI-compatibile oppure Ollama.

## Cosa fa

1. Riceve una o più foto di appunti (JPG, PNG, WebP, GIF, HEIC/HEIF).
2. Salva gli originali in una cartella persistente del server.
3. Invia le immagini a un modello AI visione/OCR configurabile.
4. Genera una nota Markdown con frontmatter YAML, tag, riassunto, formule LaTeX e callout Obsidian.
5. Verifica i wikilink rispetto alle note realmente presenti nel vault.
6. Mostra un’anteprima modificabile e, su conferma, salva la nota nel vault con scrittura atomica e senza sovrascrivere file esistenti.
7. Mostra una cronologia temporanea delle elaborazioni con stati, errori e retry. Dopo il salvataggio nel vault l’attività viene rimossa automaticamente e i dati temporanei del server vengono eliminati.
8. Include un’app Android per scattare o selezionare foto dal telefono, caricarle sul server e rivedere/salvare la nota Obsidian.

L’app funziona subito in **modalità mock**, utile per provare il flusso senza chiavi API. Per l’analisi reale delle immagini configura un provider visione.

## Documentazione

- [Architettura e ciclo di vita delle attività](docs/ARCHITECTURE.md)
- [Release e versioni conservate](docs/RELEASES.md)
- [Prompt di sviluppo](docs/prompts/README.md)
- [App Android](android/README.md)
- [Deploy e HTTPS](deploy/README.md)
- [Script del server](scripts/README.md)
- [Changelog](CHANGELOG.md)

## Requisiti

- Node.js **22.5 o superiore** (usa `node:sqlite`).
- Un vault Obsidian accessibile dal processo Node, oppure Docker.
- Per l’AI: una chiave API OpenAI-compatibile oppure un’istanza Ollama con modello visione.
- Solo per Docker: Docker e Docker Compose.

## Avvio rapido locale

```bash
cd /home/giacomo/UniAi/uniai
cp .env.example .env
npm install
npm start
```

Apri `http://localhost:3000`.

Con la configurazione predefinita:

- provider: `mock` (nessuna chiamata esterna, nessun OCR reale);
- vault: `./obsidian-vault`;
- note salvate in `./obsidian-vault/Università/Lezioni`;
- database SQLite: `./data/database/uniai.db`;
- upload: `./data/uploads`.

### Configura il vault reale

Modifica `.env`:

```env
OBSIDIAN_VAULT_PATH=/home/giacomo/Documenti/Obsidian/IlMioVault
OBSIDIAN_NOTES_SUBDIR=Università/Lezioni
```

Verifica che l’utente che esegue Node abbia permessi di lettura e scrittura sulla cartella di destinazione. UniAi non modifica le note esistenti e genera un nome alternativo se il file esiste già.

### Configura un provider AI reale

#### Google Gemini

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
AI_API_KEY=la-tua-chiave-gemini
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

Il provider invia le immagini a Gemini come `inlineData`, richiede output JSON e mantiene la chiave API esclusivamente sul server. Non inserire mai la chiave nell’app Android.

> Antigravity è un ambiente/agente di sviluppo e non il provider di inferenza runtime. Il progetto può essere sviluppato e verificato con Antigravity, ma l’analisi delle foto a runtime passa dalla Gemini API ufficiale.

#### OpenAI o servizio OpenAI-compatibile

```env
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1
AI_JSON_MODE=true
```

Per un endpoint compatibile (ad esempio un gateway aziendale, OpenRouter o un server locale):

```env
AI_PROVIDER=openai-compatible
AI_MODEL=nome-del-modello-visione
AI_API_KEY=...
AI_BASE_URL=http://127.0.0.1:8000/v1
```

#### Ollama

```env
AI_PROVIDER=ollama
AI_MODEL=qwen2.5vl:7b
AI_BASE_URL=http://127.0.0.1:11434
```

Il modello scelto deve supportare input immagini. Se il modello non è vision, l’analisi delle foto non funziona correttamente.

### Privacy

- In modalità `openai`/`openai-compatible`, le immagini vengono inviate al provider configurato.
- In modalità `ollama`, l’analisi resta sulla macchina che ospita Ollama.
- In modalità `mock`, nessuna immagine lascia il server, ma non viene eseguito vero OCR.
- Le chiavi API restano lato server e sono lette solo da variabili d’ambiente.
- Se esponi l’app in rete imposta `APP_PASSWORD` e preferibilmente termina TLS con un reverse proxy.

## Configurazione

Tutte le variabili sono documentate in `.env.example`:

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `APP_PASSWORD` | vuota | Se impostata, abilita login con password |
| `DATABASE_URL` | `sqlite:///./data/database/uniai.db` | Percorso database SQLite |
| `UPLOAD_DIR` | `./data/uploads` | Cartella degli originali |
| `MAX_UPLOAD_MB` | `20` | Dimensione massima per file |
| `MAX_FILES_PER_UPLOAD` | `10` | Numero massimo di immagini per job |
| `OBSIDIAN_VAULT_PATH` | `./obsidian-vault` | Percorso del vault Obsidian |
| `OBSIDIAN_NOTES_SUBDIR` | `Università/Lezioni` | Sottocartella di destinazione per materie non riconosciute |
| `OBSIDIAN_SUBJECT_ROOTS` | vuota | Cartelle che contengono una sottocartella per ogni materia; separate da virgola |
| `OBSIDIAN_NEW_SUBJECT_ROOT` | vuota | Cartella in cui creare le nuove materie |
| `OBSIDIAN_SUBJECT_ATTACHMENTS_SUBDIR` | `Allegati` | Sottocartella allegati creata dentro ogni materia |
| `AUTO_SAVE_TO_VAULT` | `false` | Salva automaticamente al termine dell’analisi |
| `ALLOW_CREATE_MISSING_WIKILINKS` | `false` | Consente wikilink verso note non ancora esistenti |
| `AI_PROVIDER` | `mock` | `mock`, `gemini`, `openai`, `openai-compatible`, `openrouter`, `ollama` |
| `AI_MODEL` | `gemini-3.8-flash` | Modello visione |
| `AI_API_KEY` | vuota | Chiave API |
| `AI_BASE_URL` | vuota | Base URL del provider |
| `AI_JSON_MODE` | `true` | Richiede output JSON al provider OpenAI-compatibile |
| `AI_FALLBACK_ENABLED` | `true` nell'esempio | Abilita il fallback a un modello più potente |
| `AI_FALLBACK_PROVIDER` | stesso provider | Provider del fallback |
| `AI_FALLBACK_MODEL` | vuoto | Modello avanzato di fallback |
| `AI_FALLBACK_MIN_CONFIDENCE` | `0.7` | Soglia sotto la quale scatta il fallback |
| `AI_FALLBACK_ON_ILLEGIBLE` | `true` | Fallback se l'AI segnala parti illeggibili |
| `AI_FALLBACK_MIN_CHARS_PER_IMAGE` | `80` | Lunghezza minima della trascrizione per immagine |
| `WORKER_POLL_MS` | `1500` | Pausa tra i job del worker |
| `WEBDAV_ENABLED` | `false` | Abilita il server WebDAV per Obsidian Mobile |
| `WEBDAV_PATH` | `/webdav` | Percorso HTTP del server WebDAV |
| `WEBDAV_USERNAME` | `uniai` | Utente WebDAV |
| `WEBDAV_PASSWORD` | vuota | Password WebDAV; obbligatoria se abilitato |
| `WEBDAV_MAX_UPLOAD_MB` | `50` | Dimensione massima di un file WebDAV |

> Attenzione: `AUTO_SAVE_TO_VAULT=true` salva la nota senza revisione manuale. La scrittura è atomica e non sovrascrive file, ma è consigliabile controllare il risultato con il provider reale.

## Flusso di utilizzo

1. Seleziona una o più foto.
2. Compila corso, data, titolo e tag (opzionali).
3. Premi **Carica e analizza**.
4. Attendi lo stato **Completato**.
5. Apri il dettaglio, controlla il Markdown e i wikilink.
6. Modifica il Markdown se necessario e premi **Salva modifiche**.
7. Premi **Salva nel vault Obsidian**.
8. Apri Obsidian: la nota si trova nella sottocartella configurata.

## Wikilink e sicurezza del vault

- I titoli delle note esistenti vengono passati al modello e usati per proporre collegamenti.
- Il backend verifica ogni wikilink contro i file `.md` del vault.
- Di default i link verso note inesistenti vengono convertiti in testo normale.
- Le note esistenti non vengono mai sovrascritte: in caso di collisione si usa ` (2)`, ` (3)`, ecc.
- Il salvataggio usa un file temporaneo e una `rename` atomica.
- Il percorso di destinazione è confinato a `OBSIDIAN_VAULT_PATH/OBSIDIAN_NOTES_SUBDIR`.

## API principali

| Metodo | Endpoint | Funzione |
|---|---|---|
| `GET` | `/api/health` | Stato, provider e scrivibilità vault |
| `POST` | `/api/login` | Login opzionale |
| `POST` | `/api/uploads` | Upload multiplo e creazione job |
| `GET` | `/api/jobs` | Storico con filtri |
| `GET` | `/api/jobs/:id` | Dettaglio job |
| `GET` | `/api/jobs/:id/files/:index` | Immagine originale protetta |
| `GET` | `/api/jobs/:id/markdown` | Markdown corrente |
| `PUT` | `/api/jobs/:id/markdown` | Salva modifiche al Markdown |
| `POST` | `/api/jobs/:id/retry` | Rielabora |
| `POST` | `/api/jobs/:id/save-to-vault` | Salva la nota nel vault |
| `GET` | `/api/courses` | Corsi presenti nello storico |
| `PROPFIND/GET/PUT/...` | `/webdav/*` | Sincronizzazione WebDAV del vault Obsidian |
| `POST` | `/api/vault/rebuild-artifacts` | Rigenera indici e mappe di tutte le materie |

## Fallback automatico Gemini Flash → Gemini Pro

Il backend supporta un secondo modello avanzato. Se l’analisi primaria è debole, UniAi ripete automaticamente l’elaborazione con il modello di fallback.

Esempio consigliato:

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
AI_API_KEY=la-tua-chiave

AI_FALLBACK_ENABLED=true
AI_FALLBACK_PROVIDER=gemini
AI_FALLBACK_MODEL=gemini-3.1-pro-preview
AI_FALLBACK_MIN_CONFIDENCE=0.7
AI_FALLBACK_ON_ILLEGIBLE=true
AI_FALLBACK_MIN_CHARS_PER_IMAGE=80
```

> Nota modelli: i nomi disponibili cambiano spesso. In questo ambiente `gemini-3.6-flash` ha funzionato, mentre `gemini-3.1-pro-preview` non è disponibile con quota free tier. Con billing attivo si può usare Gemini Pro come fallback; senza billing conviene un fallback tra modelli Flash.

Il fallback viene attivato quando:

- la confidenza restituita dal modello è inferiore alla soglia;
- compaiono warning su parti illeggibili o incerte;
- la trascrizione è troppo breve rispetto al numero di immagini;
- il Markdown è incompleto;
- il provider primario restituisce un errore.

Il risultato del job contiene in `result_json.ai`:

```json
{
  "primaryModel": "gemini-3.8-flash",
  "modelUsed": "gemini-3.1-pro-preview",
  "fallbackUsed": true,
  "fallbackAttempted": true,
  "fallbackReason": "confidenza 0.42 < soglia 0.7"
}
```

Se anche il fallback fallisce, la nota primaria viene conservata e viene aggiunto un warning, evitando di perdere l’intera elaborazione.

## App Android

L’app Android nativa si trova in `android/` e usa il backend UniAi come proxy sicuro verso Gemini: nessuna chiave API viene inserita nell’APK.

### Funzioni

- configurazione dell’URL del server;
- login opzionale con `APP_PASSWORD`;
- selezione multipla dalla galleria con Photo Picker e fallback al selettore documenti;
- fotocamera;
- anteprima e rimozione delle immagini;
- interfaccia Android a tab: Carica, Coda, Attività e Impostazioni;
- tema chiaro, scuro o automatico di sistema;
- gestione del permesso Android 17 `ACCESS_LOCAL_NETWORK`;
- modalità compatibilità rete locale per Android che non espongono SSID o impronta;
- pulsante impostazioni nella barra superiore;
- gestione completa dei corsi: creazione, selezione, rinomina ed eliminazione;
- attività salvate rimosse automaticamente dalla cronologia, con pulizia di immagini e risultati temporanei dal server;
- note e figure già salvate nel vault Obsidian sempre conservate;
- revisione delle immagini selezionate con riordino e rimozione;
- elenco dettagliato della coda con retry ed eliminazione dei singoli elementi;
- blocco HTTP verso server pubblici non HTTPS;
- importazione automatica dei corsi già presenti sul backend;
- data lezione opzionale;
- coda locale persistente: le foto vengono compresse, salvate sul telefono e caricate automaticamente quando la rete e il server sono disponibili;
- blocco delle reti Wi-Fi non fidate: l’app contatta il server solo da reti autorizzate, VPN o emulatori locali;
- diagnostica dei permessi Android per posizione precisa, Dispositivi Wi-Fi vicini e posizione di sistema;
- fallback di fiducia tramite impronta della rete locale quando Android non espone l’SSID;
- retry automatico tramite `JobScheduler` e aggiornamento della UI;
- ottimizzazione delle immagini prima dell’upload;
- upload multipart con corso, data, titolo, tag e istruzioni;
- storico delle elaborazioni con aggiornamento automatico;
- dettaglio con Markdown modificabile, warning e wikilink;
- retry e salvataggio nel vault Obsidian.

### Build APK

Prerequisiti: Android Studio oppure Android SDK 35, Build Tools 35.0.0 e JDK 17.

```bash
cd android
# Se non usi Android Studio, crea local.properties con:
# sdk.dir=/percorso/android-sdk
./gradlew assembleDebug
```

APK generato:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Installazione su telefono/emulatore:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Collegamento al server

- Emulatore Android: `http://10.0.2.2:3000`.
- Telefono reale: `http://IP_LAN_DEL_SERVER:3000`, ad esempio `http://192.168.1.20:3000`.
- Assicurati che telefono e server siano sulla stessa rete e che la porta 3000 sia raggiungibile.
- L’HTTP in chiaro è abilitato per lo sviluppo locale. Per l’esposizione pubblica usa HTTPS tramite reverse proxy.

Avvia il backend in ascolto su tutte le interfacce:

```bash
cd /home/giacomo/UniAi/uniai
npm start
```

### Build già verificata

```text
BUILD SUCCESSFUL
APK: android/app/build/outputs/apk/debug/app-debug.apk
```

La build è stata eseguita con Gradle 8.10.2, AGP 8.7.3, JDK 17 e Android SDK 35. L’app è stata installata e verificata anche su Pixel 7 Pro con Android 17 (SDK 37), inclusi permesso `ACCESS_LOCAL_NETWORK`, connessione al server e coda upload.

### Sicurezza della rete Android

L’app Android non contatta il server su una rete Wi-Fi qualsiasi. Prima di effettuare login, polling, upload o salvataggio:

1. verifica la rete attiva;
2. legge l’SSID del Wi-Fi corrente;
3. se l’SSID non è disponibile, usa l’impronta locale della rete;
4. confronta il risultato con le reti autorizzate sul telefono.

Su Android 17 servono:

- permesso posizione precisa;
- permesso Dispositivi Wi-Fi vicini;
- permesso `ACCESS_LOCAL_NETWORK`;
- posizione di sistema attiva.

L’accesso è consentito solo se:

- la rete Wi-Fi corrente è stata autorizzata dall’utente;
- oppure è attiva una VPN;
- oppure si sta usando un emulatore con indirizzo locale `10.0.2.2` / `127.0.0.1`.

La modalità compatibilità rete locale consente esplicitamente l’accesso a un server privato su Wi-Fi quando Android non espone un’identità stabile. HTTP pubblico resta bloccato.

Nella schermata **Rete Wi-Fi** si può:

- rendere fidata la rete corrente;
- rimuovere la fiducia;
- gestire l’elenco delle reti autorizzate.

Se la rete non è fidata, la coda resta salvata localmente ma non viene inviata e nessuna richiesta viene fatta al server.

## HTTPS e certificate pinning

Il backend può servire direttamente HTTPS impostando:

```env
TLS_CERT_PATH=/percorso/fullchain.pem
TLS_KEY_PATH=/percorso/privkey.pem
COOKIE_SECURE=true
```

In alternativa usare Caddy o Nginx come reverse proxy TLS. È disponibile un esempio:

```text
deploy/Caddyfile.example
```

Per l’uso da rete esterna è consigliato Tailscale o WireGuard.

L’app Android supporta un certificate pin SHA-256 opzionale:

```text
Impostazioni → Sicurezza TLS → SHA-256 del certificato
```

Il pin viene verificato contro il certificato foglia del server. Se il pin non corrisponde, la connessione viene rifiutata. Il pin non sostituisce la validazione normale della catena TLS: la integra.

## Sincronizzazione reale con Obsidian Mobile

UniAi include un server **WebDAV** integrato. Il vault Obsidian resta sul server, ma Obsidian Mobile può sincronizzarlo in entrambe le direzioni tramite il plugin community **Remotely Save**.

### 1. Configura il server

Aggiungi al `.env`:

```env
WEBDAV_ENABLED=true
WEBDAV_PATH=/webdav
WEBDAV_USERNAME=uniai
WEBDAV_PASSWORD=una-password-lunga-e-casuale
WEBDAV_MAX_UPLOAD_MB=50
```

Riavvia il backend:

```bash
npm start
```

Verifica:

```text
http://IP_DEL_SERVER:3000/api/health
```

La risposta deve contenere:

```json
{
  "webdavEnabled": true,
  "webdavPath": "/webdav"
}
```

### 2. Configura Obsidian Mobile

1. Installa Obsidian sul telefono.
2. Apri il vault locale che vuoi sincronizzare.
3. Installa il plugin community **Remotely Save**.
4. Apri le impostazioni del plugin.
5. Seleziona come servizio remoto **WebDAV**.
6. Inserisci:
   - Server URL: `http://IP_DEL_SERVER:3000/webdav/`
   - Username: `uniai`
   - Password: quella impostata in `WEBDAV_PASSWORD`
7. Premi **Check Connection**.
8. Scegli la sincronizzazione bidirezionale.
9. Avvia la sincronizzazione.

Su una rete locale puoi usare HTTP. Fuori dalla LAN usa HTTPS tramite Caddy o Nginx e cambia l'URL in:

```text
https://tuo-dominio/webdav/
```

### 3. Come funziona

- Le note generate da UniAi vengono scritte nella stessa cartella del vault.
- Remotely Save scarica le modifiche sul telefono.
- Le note create o modificate su Obsidian Mobile vengono caricate sul server.
- Il server WebDAV è confinato al percorso `OBSIDIAN_VAULT_PATH` e impedisce path traversal.
- L'accesso WebDAV è protetto da Basic Auth.

> La sincronizzazione è bidirezionale ma non è un filesystem montato: Remotely Save sincronizza quando viene avviato o secondo la pianificazione configurata. Evita modifiche simultanee dello stesso file da dispositivi diversi per non creare conflitti.

Per una sincronizzazione continua in tempo reale è possibile usare Syncthing tra server e telefono come alternativa a WebDAV, ma richiede l'installazione di Syncthing su entrambi i dispositivi.

## Figure ritagliate dalle immagini originali

Per schemi, grafici, tabelle e disegni tecnici UniAi non li fa ridisegnare all’AI. Il modello restituisce solo:

- immagine sorgente;
- coordinate del ritaglio;
- didascalia;
- tipo di figura.

Al salvataggio nel vault, il backend usa `sharp` per:

1. ritagliare la regione originale;
2. salvarla come PNG nella cartella configurata:

```env
OBSIDIAN_SUBJECT_ATTACHMENTS_SUBDIR=Allegati
```

3. creare automaticamente una cartella `Allegati` dentro la cartella della materia;
4. inserire nella nota un embed Markdown relativo alla nota:

```markdown
![Didascalia](Allegati/fig-...png)
*Didascalia della figura*
```

Esempio di struttura:

```text
uni/Uni/magistrale/aerospace dynamic systems analysis/
├── 001 Introduzione.md
├── 002 Architettura dei controlli.md
├── _Indice.md
└── Allegati/
    ├── fig-...-n1-f1-schema.png
    └── fig-...-n2-f1-grafico.png
```

Le figure originali restano quindi fedeli e disponibili offline. Il prompt AI vieta esplicitamente di inventare URL o immagini esterne.

## Divisione automatica in più note

Un singolo caricamento può contenere più argomenti distinti. L’AI valuta il contenuto e può generare:

- una sola nota, se le immagini sono pagine consecutive dello stesso argomento;
- più note atomiche, fino a un massimo di 6, se gli argomenti sono chiaramente distinti.

Ogni nota ha titolo, riassunto, Markdown, tag, alias, concetti chiave e wikilink propri. Le note dello stesso gruppo possono collegarsi tra loro e vengono salvate con numerazione progressiva nella materia:

```text
001 Funzione di trasferimento.md
002 Risposta in frequenza.md
```

Il job espone `result_json.notes` e l’API di salvataggio restituisce `vaultPaths`.

## Numerazione e nomi delle note

Le note generate non usano più la data nel nome file. UniAi assegna un numero progressivo a tre cifre, separato per ogni materia:

```text
001 Introduzione ai sistemi di controllo e al feedback.md
002 Dinamica del volo.md
003 Stabilità e risposta in frequenza.md
```

La numerazione:

- viene calcolata dalla cartella della materia;
- parte da `001`;
- usa il numero massimo esistente + 1;
- non sovrascrive mai una nota esistente;
- mantiene l’ordine alfabetico corretto anche quando il vault viene sincronizzato tra dispositivi.

La data della lezione è opzionale e, quando presente, resta solo nel frontmatter e nei metadati del job.

## Indici per materia

UniAi analizza la struttura reale del vault e riconosce le materie dalle cartelle configurate in:

```env
OBSIDIAN_SUBJECT_ROOTS=uni/Uni/triennale,uni/Uni/magistrale
```

Per ogni materia genera automaticamente un indice nella cartella della materia:

```text
_Indice.md
```

### `_Indice.md`

Contiene:

- tutte le note della materia, raggruppate per sottocartella;
- wikilink diretti a ogni nota;
- riassunto iniziale di ogni nota;
- numero di note, wikilink e heading;
- tag ricorrenti.

### Aggiornamento automatico

Gli indici vengono rigenerati automaticamente quando UniAi salva una nuova nota nella materia. È possibile rigenerarli manualmente:

```bash
npm run vault:indexes
```

Oppure via API autenticata:

```bash
curl -X POST http://localhost:3000/api/vault/rebuild-artifacts
```

### Istruzioni AI contestuali

Prima di analizzare una nuova immagine, UniAi analizza il vault e passa al modello AI:

- elenco delle materie e dei percorsi;
- materia più probabile per il corso richiesto;
- titoli delle note esistenti della materia;
- convenzioni di formattazione del vault;
- istruzioni su wikilink, LaTeX, callout, titoli e concetti chiave.

Il modello deve restituire anche:

```json
{
  "subject": "fluidodinamica",
  "subjectPath": "uni/Uni/triennale/fluidodinamica",
  "keyConcepts": ["concetto 1", "concetto 2"],
  "conceptRelations": [
    {"from": "concetto 1", "to": "concetto 2", "label": "relazione"}
  ]
}
```

La nota viene salvata nella cartella della materia corrispondente. Se la materia non esiste, UniAi crea automaticamente una cartella con il nome della materia sotto `OBSIDIAN_NEW_SUBJECT_ROOT` e genera subito l’indice della materia.

Esempio:

```env
OBSIDIAN_NEW_SUBJECT_ROOT=uni/Uni/triennale
```

Un corso chiamato `Aerospace Dynamic Systems Analysis` verrà salvato in:

```text
uni/Uni/triennale/Aerospace Dynamic Systems Analysis/
```

## Server sempre attivo

Il server può essere gestito tramite un watchdog in una sessione `tmux`. Il watchdog:

- avvia il backend se non è in esecuzione;
- controlla `/api/health` ogni pochi secondi;
- riavvia automaticamente Node se il processo termina o non risponde;
- mantiene il server attivo anche dopo la chiusura del terminale.

Avvio:

```bash
cd /home/giacomo/UniAi/uniai
npm run service:start
```

Arresto:

```bash
npm run service:stop
```

Stato e log:

```bash
tmux ls
tail -f /tmp/uniai.log
```

Ingresso nella sessione:

```bash
tmux attach -t uniai
```

> Questo ambiente non espone systemd/init completo, quindi il watchdog sopravvive alla chiusura del terminale ma non può essere registrato come servizio di boot tramite `systemctl`. Dopo un riavvio completo del container eseguire `npm run service:start`.

## Test

```bash
npm test
```

La suite verifica sanitizzazione dei percorsi, filtraggio dei wikilink, parsing del vault, provider Gemini con immagini inline e un flusso end-to-end completo: upload di un’immagine → analisi mock → salvataggio atomico in un vault temporaneo → verifica del contenuto e protezione dai duplicati.

L’app Android include un test strumentale di smoke test per verificare la presenza delle tab e del pulsante impostazioni. Il test può essere compilato con:

```bash
cd android
./gradlew assembleDebugAndroidTest
```

L’esecuzione su dispositivo richiede:

```bash
./gradlew connectedDebugAndroidTest
```

## Release

Sono conservate solo le release più significative. La policy e i download sono descritti in [docs/RELEASES.md](docs/RELEASES.md).

## Docker

```bash
cp .env.example .env
# Imposta OBSIDIAN_VAULT_PATH_HOST nel file .env o nell'ambiente:
# OBSIDIAN_VAULT_PATH_HOST=/home/giacomo/Documenti/Obsidian/IlMioVault
docker compose up -d --build
```

Il container monta:

- `./data` → `/app/data` (database e upload);
- `${OBSIDIAN_VAULT_PATH_HOST}` → `/vault` (vault Obsidian).

All’interno del container `OBSIDIAN_VAULT_PATH=/vault`. Assicurati che il processo del container possa scrivere nella cartella montata.

## Struttura del progetto

```text
uniai/
├── android/                 # App Android nativa
│   ├── app/src/main/java/it/uniai/mobile/
│   ├── app/src/androidTest/ # Smoke test strumentale
│   └── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── RELEASES.md
│   └── prompts/
├── deploy/                  # Caddyfile e note di deploy
├── public/                  # Web UI
├── scripts/                 # Avvio, stop e watchdog
├── src/
│   ├── ai/                  # Gemini, OpenAI-compatibile, Ollama, mock
│   ├── app.js               # API Express
│   ├── db.js                # SQLite e job
│   ├── figures.js           # Ritaglio figure
│   ├── markdown.js          # Frontmatter e template
│   ├── server.js            # Bootstrap HTTP/HTTPS
│   ├── vault.js             # Salvataggio Obsidian
│   ├── vault-analysis.js    # Materie, contesto e indici
│   ├── webdav.js            # Sincronizzazione Obsidian Mobile
│   └── worker.js            # Coda di elaborazione
├── test/                    # Test backend
├── data/                    # Runtime: upload e database (ignorati da Git)
├── obsidian-vault/          # Vault demo locale (ignorato da Git)
├── CHANGELOG.md
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Limiti noti

- L’OCR dipende dal modello visione scelto: non è incluso un motore OCR locale separato. Con `AI_PROVIDER=mock` non viene trascritto il contenuto reale delle immagini.
- Il provider Gemini richiede una chiave API e non è stato possibile eseguire una chiamata reale nell’ambiente di build. Il provider è coperto da test con risposta mock.
- La coda è in-process: se il server si riavvia durante un job, il job viene marcato come fallito e va riavviato con **Riprova**.
- Il database è SQLite, adatto a uso personale o a un piccolo gruppo.
- La ricerca delle note nel vault è ricorsiva ma non usa embeddings: il matching dei wikilink si basa su titoli, alias, menzioni e link proposti dal modello.
- Le sessioni di login sono in memoria e decadono al riavvio del server.
- L’analisi AI reale dipende dalla disponibilità e dalla quota del provider configurato.
- Per l’esposizione pubblica usare HTTPS con Caddy/Node e `APP_PASSWORD`; il certificate pin Android è opzionale.

## Prossimi passi consigliati

- OCR locale con Tesseract come fallback quando il provider non è disponibile.
- Ricerca semantica delle note con embeddings per wikilink più precisi.
- Modifica visuale dei metadati e delle immagini prima dell’analisi.
- Supporto PDF multipagina e conversione automatica in immagini.
- Coda persistente (BullMQ/Redis) per più worker.
- Autenticazione multiutente e isolamento dei vault per utente.
- Watcher del vault per aggiornare l’indice dei wikilink in tempo reale.
- Pubblicazione dell’APK firmato e aggiornamenti automatici.
- Coda offline sul telefono per caricare gli appunti quando torna la rete.
