# Prompt — Provider DeepSeek Flash

## Obiettivo

Valutare e integrare DeepSeek Flash come alternativa vision a Gemini per l’analisi delle foto di appunti.

## Verifica modello

DeepSeek Flash:

- identificatore API: `deepseek-flash`;
- nome modello: DeepSeek-V4.1-Flash;
- input supportati: testo e immagini;
- output: testo;
- contesto: circa 1M token;
- API compatibile OpenAI con endpoint `/chat/completions`.

## Integrazione

Il provider `deepseek` deve:

1. usare `https://api.deepseek.com` come base URL predefinito;
2. inviare le immagini come content part `image_url` con data URL base64;
3. usare `response_format: { "type": "json_object" }`;
4. passare dal medesimo sistema di retry e copertura immagini di Gemini;
5. poter essere configurato come provider primario o fallback.

## Configurazione

```env
AI_PROVIDER=deepseek
AI_MODEL=deepseek-flash
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=...
AI_JSON_MODE=true
```

Fallback:

```env
AI_FALLBACK_PROVIDER=deepseek
AI_FALLBACK_MODEL=deepseek-flash
AI_FALLBACK_BASE_URL=https://api.deepseek.com
AI_FALLBACK_API_KEY=...
```

## Criteri di accettazione

- La richiesta contiene il modello `deepseek-flash`.
- Le immagini sono inviate come data URL.
- La risposta JSON viene normalizzata come gli altri provider.
- Il retry multi-immagine resta attivo.
- Senza API key il provider restituisce un errore chiaro.
- I test verificano URL, modello, formato immagini e JSON mode.
