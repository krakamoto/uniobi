# Prompt — Claude Haiku 5.5 con batch e fallback Sonnet 5.5

## Obiettivo

Usare Claude Haiku 5.5 come modello primario per l’analisi delle foto e Claude Sonnet 5.5 come fallback quando il risultato manca di precisione, sfruttando la Message Batches API di Anthropic per ridurre del 50% il costo dei token.

## Modelli

- Primario: `claude-haiku-5-5`
- Precisione: `claude-sonnet-5-5`

## Batch API

- Creazione: `POST https://api.anthropic.com/v1/messages/batches`
- Polling: `GET /v1/messages/batches/{id}`
- Risultati: `results_url` restituito dal batch
- Header: `x-api-key` e `anthropic-version: 2023-06-01`
- Ogni richiesta batch ha un `custom_id` univoco.

## Configurazione

```env
AI_PROVIDER=claude
AI_MODEL=claude-haiku-5-5
AI_BASE_URL=https://api.anthropic.com
AI_API_KEY=sk-ant-...
AI_CLAUDE_USE_BATCH=true
AI_CLAUDE_BATCH_POLL_MS=10000
AI_CLAUDE_BATCH_TIMEOUT_MS=21600000
AI_FALLBACK_ENABLED=true
AI_FALLBACK_PROVIDER=claude
AI_FALLBACK_MODEL=claude-sonnet-5-5
AI_FALLBACK_BASE_URL=https://api.anthropic.com
AI_FALLBACK_API_KEY=
```

`AI_FALLBACK_API_KEY` può restare vuota: viene usata la chiave primaria.

## Fallback di precisione

Dopo la risposta Haiku vengono controllati:

- copertura di tutte le immagini;
- lunghezza del Markdown;
- confidenza;
- trascrizione minima per immagine;
- warning di parti illeggibili.

Se uno dei criteri non è soddisfatto, viene inviato un secondo batch a Sonnet 5.5.

## Emergenza

Se Claude non è configurato o fallisce, si può usare DeepSeek Flash come provider di emergenza:

```env
AI_EMERGENCY_ENABLED=true
AI_EMERGENCY_PROVIDER=deepseek
AI_EMERGENCY_MODEL=deepseek-flash
AI_EMERGENCY_BASE_URL=https://api.deepseek.com
AI_EMERGENCY_API_KEY=...
```

## Criteri di accettazione

- La richiesta batch usa il modello Haiku 5.5.
- Il polling attende `processing_status=ended`.
- I risultati JSONL vengono associati al `custom_id` corretto.
- In caso di bassa precisione viene tentato Sonnet 5.5.
- In caso di errore Claude viene tentato il provider di emergenza.
- Il token di Anthropic non viene mai scritto nel repository.
