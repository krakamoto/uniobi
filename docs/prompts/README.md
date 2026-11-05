# Prompt di sviluppo

Prompt riutilizzabili per evolvere il progetto in modo coerente.

- [Ciclo di vita attività](activity-lifecycle.md) — salvataggio, auto-pulizia e distinzione server/vault.
- [App Android e Antigravity](android-antigravity.md) — requisiti iniziali del client Android.
- [Corsi e numerazione](android-courses-numbering.md) — gestione corsi e nomi numerati.
- [Divisione multi-nota](multinote-split.md) — suddivisione di una lezione in più note.
- [Resilienza server](server-resilience.md) — watchdog, health check, systemd e riavvio automatico.
- [Retry Gemini e copertura immagini](gemini-retry-coverage.md) — retry su 503, analisi per singola foto e niente note parziali.
- [DeepSeek Flash](deepseek-flash-provider.md) — provider vision OpenAI-compatible come alternativa o fallback.
- [Claude Batch Haiku → Sonnet](claude-batch-haiku-sonnet.md) — Haiku 5.5 primario, Sonnet 5.5 per precisione e Batch API al 50%.
- [Ottimizzazione immagini e token](image-token-optimization.md) — crop sicuro, resize prudente e tracking dei token.
- [Controllo costi AI](ai-cost-control.md) — limiti a retry, fallback e chiamate per job.

## Regole per nuovi prompt

- Indicare obiettivo e criteri di accettazione.
- Separare dati temporanei del server e file permanenti del vault.
- Prevedere test backend e build Android.
- Aggiornare `docs/` e `android/README.md` quando cambia il comportamento.
