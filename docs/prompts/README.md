# Prompt di sviluppo

Prompt riutilizzabili per evolvere il progetto in modo coerente.

- [Ciclo di vita attività](activity-lifecycle.md) — salvataggio, auto-pulizia e distinzione server/vault.
- [App Android e Antigravity](android-antigravity.md) — requisiti iniziali del client Android.
- [Corsi e numerazione](android-courses-numbering.md) — gestione corsi e nomi numerati.
- [Divisione multi-nota](multinote-split.md) — suddivisione di una lezione in più note.
- [Resilienza server](server-resilience.md) — watchdog, health check, systemd e riavvio automatico.
- [Retry Gemini e copertura immagini](gemini-retry-coverage.md) — retry su 503, analisi per singola foto e niente note parziali.
- [DeepSeek Flash](deepseek-flash-provider.md) — provider vision OpenAI-compatible come alternativa o fallback.

## Regole per nuovi prompt

- Indicare obiettivo e criteri di accettazione.
- Separare dati temporanei del server e file permanenti del vault.
- Prevedere test backend e build Android.
- Aggiornare `docs/` e `android/README.md` quando cambia il comportamento.
