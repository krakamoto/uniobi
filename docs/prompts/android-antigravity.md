# Prompt operativo — UniAi Android + Gemini + Antigravity

Agisci come senior Android engineer, backend engineer e UX designer. Lavora nella repository UniAi esistente e crea un’app Android nativa che permetta di fotografare o selezionare gli appunti dal telefono, caricarli sul server UniAi e ricevere una nota Markdown pronta per Obsidian.

## Contesto
La repository contiene già:
- un backend Node.js/Express con API `/api/uploads`, `/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/save-to-vault`;
- un provider AI astratto;
- salvataggio sicuro nel vault Obsidian con wikilink verificati;
- database SQLite e storage locale delle immagini.

L’app Android deve essere un client del backend, non deve contenere chiavi API Gemini. Il backend deve aggiungere un provider `gemini` che usa la Gemini API per analizzare le immagini e il prompt già esistente.

## Ruolo di Antigravity
Usa Antigravity come ambiente/agente di sviluppo per pianificare, implementare, verificare e documentare il progetto. Antigravity non è il provider di inferenza: l’analisi delle immagini a runtime deve passare dalla Gemini API ufficiale, con `AI_PROVIDER=gemini`, `AI_MODEL=gemini-2.5-flash` e `AI_API_KEY` configurata solo lato server.

## Obiettivi Android
1. App Android nativa in Java o Kotlin, compatibile con Android 8+.
2. Configurazione dell’URL del server UniAi salvata nelle preferenze locali.
3. Login opzionale tramite `APP_PASSWORD` del backend.
4. Scatto foto con fotocamera e selezione multipla dalla galleria/photo picker.
5. Anteprima e rimozione delle immagini selezionate.
6. Form con corso, data, titolo, tag e istruzioni per l’AI.
7. Upload multipart verso `/api/uploads`.
8. Storico dei job con stato, titolo, corso, data ed errori.
9. Aggiornamento automatico dei job in elaborazione.
10. Dettaglio del job con Markdown, anteprima, warning e wikilink.
11. Possibilità di retry e di salvataggio nel vault Obsidian.
12. Gestione di rete assente, errori HTTP, timeout e server non configurato.
13. Nessuna chiave segreta hardcoded.
14. Interfaccia in italiano, utilizzabile da telefono, con supporto a tema chiaro/scuro se possibile.

## Requisiti backend Gemini
Aggiungi a `src/ai/` un provider `gemini.js` che:
- chiami `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`;
- invii il prompt e le immagini come `inlineData` con MIME type e base64;
- richieda output JSON con `responseMimeType: application/json`;
- usi l’header `x-goog-api-key`;
- gestisca timeout, errori HTTP, safety block e risposte vuote;
- venga selezionato con `AI_PROVIDER=gemini`;
- non esponga mai la chiave al client Android.

## Requisiti di sicurezza
- API key solo in `.env` lato server.
- Cookie/sessione gestiti dal client senza loggare password o token.
- URL server modificabile solo dall’utente.
- HTTP in chiaro ammesso solo per sviluppo locale; documentare HTTPS per produzione.
- Validare lunghezza e tipo dei campi.
- Non salvare immagini in directory pubbliche non protette.
- Il backend deve continuare a impedire path traversal e sovrascritture nel vault.

## Criteri di accettazione
1. Il backend supera i test esistenti e il provider Gemini è selezionabile.
2. Il progetto Android compila con Gradle.
3. L’APK debug viene generato.
4. Da emulatore con backend su host è possibile usare `http://10.0.2.2:3000`.
5. Da telefono reale è possibile impostare l’IP LAN del server.
6. Si possono scegliere più immagini e caricarle tutte in un’unica richiesta.
7. Lo stato del job viene aggiornato automaticamente.
8. Il dettaglio mostra il Markdown e permette di salvarlo nel vault.
9. Il README spiega build, installazione, configurazione Gemini e limiti.
10. Non ci sono segreti nel repository o nell’APK.

## Ordine di implementazione
1. Provider Gemini e configurazione backend.
2. Test backend.
3. Scaffolding Android e build Gradle.
4. Client API HTTP e gestione sessione.
5. UI upload con fotocamera/galleria.
6. Storico e dettaglio job.
7. Gestione errori e refresh automatico.
8. Build APK, test e documentazione.

Implementa tutto il necessario, non solo esempi. Alla fine riporta struttura file, comandi di build, configurazione e limiti noti.
