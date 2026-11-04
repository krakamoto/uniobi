import { parseAiJson } from './index.js';

function endpoint(baseUrl) {
  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

export async function openAiAnalyze({ config, prompt, images }) {
  if (!config.aiApiKey) throw new Error('AI_API_KEY è obbligatoria per il provider openai.');
  const userContent = [
    { type: 'text', text: prompt },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: { url: image.dataUrl, detail: 'high' }
    }))
  ];

  const body = {
    model: config.aiModel,
    messages: [
      { role: 'system', content: 'Sei un assistente esperto nella trascrizione di appunti universitari e nella formattazione Obsidian. Rispondi esclusivamente con JSON valido.' },
      { role: 'user', content: userContent }
    ]
  };
  if (config.aiJsonMode) body.response_format = { type: 'json_object' };
  if (Number(config.aiMaxOutputTokens) > 0) body.max_tokens = Number(config.aiMaxOutputTokens);
  if (config.aiProvider === 'deepseek') {
    // DeepSeek Flash abilita il thinking di default: per l'estrazione JSON
    // vision serve una risposta diretta, altrimenti può consumare tutti i token
    // nel reasoning e restituire content vuoto.
    body.thinking = { type: 'disabled' };
    if (!body.max_tokens) body.max_tokens = 32768;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  let response;
  try {
    response = await fetch(endpoint(config.aiBaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.aiApiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Timeout del provider AI durante l’analisi delle immagini.');
    throw new Error(`Errore di rete verso il provider AI: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = (await response.text()).slice(0, 500);
    throw new Error(`Provider AI ha risposto con HTTP ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = Array.isArray(content)
    ? parseAiJson(content.map((part) => part?.text || '').join('\n'))
    : parseAiJson(content);
  parsed._providerUsage = {
    inputTokens: Number(data.usage?.prompt_tokens) || 0,
    outputTokens: Number(data.usage?.completion_tokens) || 0,
    totalTokens: Number(data.usage?.total_tokens) || (Number(data.usage?.prompt_tokens) || 0) + (Number(data.usage?.completion_tokens) || 0),
    cachedInputTokens: Number(data.usage?.prompt_tokens_details?.cached_tokens) || Number(data.usage?.prompt_cache_hit_tokens) || 0,
    batchRequests: 0
  };
  return parsed;
}
