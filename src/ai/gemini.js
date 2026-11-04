import { parseAiJson } from './index.js';

function geminiEndpoint(config) {
  const base = (config.aiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const model = encodeURIComponent(config.aiModel || 'gemini-2.5-flash');
  return `${base}/models/${model}:generateContent`;
}

export async function geminiAnalyze({ config, prompt, images }) {
  if (!config.aiApiKey) throw new Error('AI_API_KEY è obbligatoria per il provider gemini.');

  const body = {
    systemInstruction: {
      parts: [{ text: 'Sei un assistente esperto nella trascrizione di appunti universitari e nella formattazione Obsidian. Rispondi esclusivamente con JSON valido.' }]
    },
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        ...images.map((image) => ({
          inlineData: {
            mimeType: image.mimeType,
            data: image.base64
          }
        }))
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  let response;
  try {
    response = await fetch(geminiEndpoint(config), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.aiApiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Timeout di Gemini durante l’analisi delle immagini.');
    throw new Error(`Errore di rete verso Gemini: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = (await response.text()).slice(0, 700);
    throw new Error(`Gemini ha risposto con HTTP ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n') || '';
  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new Error(blockReason ? `Gemini ha bloccato la richiesta: ${blockReason}` : 'Gemini non ha restituito contenuto.');
  }
  const parsed = parseAiJson(text);
  parsed._providerUsage = {
    inputTokens: Number(data.usageMetadata?.promptTokenCount) || 0,
    outputTokens: Number(data.usageMetadata?.candidatesTokenCount) || 0,
    totalTokens: Number(data.usageMetadata?.totalTokenCount) || (Number(data.usageMetadata?.promptTokenCount) || 0) + (Number(data.usageMetadata?.candidatesTokenCount) || 0),
    cachedInputTokens: Number(data.usageMetadata?.cachedContentTokenCount) || 0,
    batchRequests: 0
  };
  return parsed;
}
