# Architettura

## Componenti

```text
Android app ──HTTP/HTTPS──> Express API ──> worker AI ──> vault Obsidian
      │                         │
      └── coda offline locale   └── SQLite + upload temporanei
```

- `src/app.js`: API REST, upload, salvataggio nel vault, WebDAV.
- `src/worker.js`: coda in-process e orchestrazione analisi AI.
- `src/ai/`: provider Gemini, OpenAI-compatibile, Ollama e mock.
- `src/vault.js`: numerazione note, scrittura atomica, indici.
- `src/figures.js`: ritaglio figure con Sharp verso `Allegati/`.
- `src/webdav.js`: sincronizzazione con Obsidian Mobile.
- `android/`: client nativo con coda persistente e protezione rete.
- `data/`: database SQLite e upload temporanei, esclusi da Git.
- `obsidian-vault/`: vault locale dimostrativo, escluso da Git.

## Ciclo di vita di un'attività

1. L’app carica una o più immagini e crea un job.
2. Il worker analizza le immagini e produce una o più note.
3. Il job resta nella tab Attività finché non viene salvato o rimosso.
4. Al salvataggio:
   - note e figure vengono scritte nel vault;
   - gli indici delle materie vengono rigenerati;
   - il job viene rimosso automaticamente dalla cronologia;
   - immagini originali e risultati temporanei vengono eliminati dal server.
5. Le note e le figure nel vault non vengono mai cancellate dalla gestione attività.

## Dati persistenti

- Vault Obsidian: fonte di verità delle note.
- SQLite: solo stato operativo e cronologia temporanea.
- Upload: necessari solo fino al completamento del job.

## Documentazione correlata

- [Release](RELEASES.md)
- [Prompt](prompts/README.md)
- [Android](../android/README.md)
