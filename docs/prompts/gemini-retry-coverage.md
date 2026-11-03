# Prompt — Retry Gemini e copertura di tutte le immagini

## Obiettivo

Impedire che un errore transitorio Gemini, in particolare HTTP 503, produca note incomplete o faccia perdere una o più foto di una lezione.

## Regole

1. Ogni richiesta Gemini deve dichiarare nel JSON `analyzedImageIndexes`, con tutti gli indici 0-based delle immagini lette.
2. Errori HTTP 429, 500, 502, 503, 504, timeout, errori di rete, risposte vuote e JSON non valido sono considerati transitori.
3. Gli errori transitori devono essere ritentati con backoff esponenziale e jitter.
4. Il numero massimo di tentativi è configurabile con `AI_RETRY_MAX_ATTEMPTS`.
5. Il risultato batch è valido solo se contiene note e copre tutti gli indici delle immagini caricate.
6. Se il batch non copre tutte le immagini o fallisce, ogni foto deve essere inviata singolarmente a Gemini.
7. Se una singola foto fallisce dopo tutti i retry, l’intero job deve fallire: non devono essere salvate note parziali.
8. Se il provider primario fallisce completamente, si applica il fallback configurato.
9. Ogni risultato per singola immagine deve rimappare `sourceImageIndex` all’indice originale.
10. Note con lo stesso titolo provenienti da foto diverse possono essere unite.
11. Il job deve esporre nei metadati AI:
    - `retryAttempts`;
    - `perImageFallbackUsed`;
    - `analyzedImageIndexes`.

## Configurazione

```env
AI_RETRY_MAX_ATTEMPTS=8
AI_RETRY_BASE_DELAY_MS=2000
AI_RETRY_MAX_DELAY_MS=30000
```

## Criteri di accettazione

- Un 503 iniziale non impedisce il completamento se un tentativo successivo riesce.
- Un risultato che copre solo alcune foto viene ritentato.
- Se il batch resta incompleto, vengono analizzate tutte le foto singolarmente.
- Nessuna nota parziale viene marcata come completata.
- `analyzedImageIndexes` contiene tutti gli indici delle foto caricate.
- I test backend coprono retry 503, copertura incompleta e fallback per singola immagine.
