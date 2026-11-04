import { parseAiJson } from './index.js';

const ANTHROPIC_VERSION = '2023-06-01';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl(config) {
  return (config.aiBaseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
}

function headers(config) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': config.aiApiKey,
    'anthropic-version': ANTHROPIC_VERSION
  };
}

function messageParams({ config, prompt, images }) {
  return {
    model: config.aiModel,
    max_tokens: Number(config.aiMaxOutputTokens) > 0 ? Number(config.aiMaxOutputTokens) : 32768,
    system: 'Sei un assistente esperto nella trascrizione di appunti universitari e nella formattazione Obsidian. Rispondi esclusivamente con JSON valido.',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map((image) => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mimeType,
            data: image.base64
          }
        }))
      ]
    }]
  };
}

async function parseResponse(response, context) {
  if (!response.ok) {
    const errorText = (await response.text()).slice(0, 700);
    throw new Error(`Claude ha risposto con HTTP ${response.status}: ${errorText}`);
  }
  return response.json();
}

function textFromMessage(message) {
  return (message?.content || [])
    .map((part) => part?.type === 'text' ? part.text || '' : '')
    .join('\n')
    .trim();
}

async function directAnalyze({ config, prompt, images }) {
  const response = await fetch(`${baseUrl(config)}/v1/messages`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(messageParams({ config, prompt, images }))
  });
  const data = await parseResponse(response, 'messages');
  const text = textFromMessage(data);
  if (!text) throw new Error('Claude non ha restituito contenuto.');
  const parsed = parseAiJson(text);
  parsed._providerUsage = {
    inputTokens: Number(data.usage?.input_tokens) || 0,
    outputTokens: Number(data.usage?.output_tokens) || 0,
    totalTokens: (Number(data.usage?.input_tokens) || 0) + (Number(data.usage?.output_tokens) || 0),
    cachedInputTokens: (Number(data.usage?.cache_read_input_tokens) || 0) + (Number(data.usage?.cache_creation_input_tokens) || 0),
    batchRequests: 0
  };
  return parsed;
}

async function batchAnalyze({ config, prompt, images }) {
  const customId = `uniai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const createResponse = await fetch(`${baseUrl(config)}/v1/messages/batches`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({
      requests: [{
        custom_id: customId,
        params: messageParams({ config, prompt, images })
      }]
    })
  });
  let batch = await parseResponse(createResponse, 'batches');
  const batchId = batch.id;
  if (!batchId) throw new Error('Claude Batch non ha restituito un id.');

  const pollMs = Math.max(0, Number(config.aiClaudeBatchPollMs) || 0);
  const timeoutMs = Math.max(1000, Number(config.aiClaudeBatchTimeoutMs) || 21600000);
  const deadline = Date.now() + timeoutMs;

  while (batch.processing_status !== 'ended') {
    if (Date.now() >= deadline) {
      throw new Error(`Claude Batch ${batchId} non completato entro ${Math.round(timeoutMs / 60000)} minuti.`);
    }
    if (pollMs > 0) await sleep(pollMs);
    const statusResponse = await fetch(`${baseUrl(config)}/v1/messages/batches/${encodeURIComponent(batchId)}`, {
      method: 'GET',
      headers: headers(config)
    });
    batch = await parseResponse(statusResponse, 'batch-status');
  }

  if (!batch.results_url) throw new Error('Claude Batch terminato senza results_url.');
  const resultsResponse = await fetch(batch.results_url, {
    method: 'GET',
    headers: headers(config)
  });
  if (!resultsResponse.ok) {
    const errorText = (await resultsResponse.text()).slice(0, 700);
    throw new Error(`Claude Batch results HTTP ${resultsResponse.status}: ${errorText}`);
  }
  const lines = (await resultsResponse.text()).split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    if (item.custom_id !== customId) continue;
    if (item.result?.type !== 'succeeded') {
      throw new Error(`Claude Batch fallito per ${customId}: ${JSON.stringify(item.result?.error || item.result || {}).slice(0, 500)}`);
    }
    const text = textFromMessage(item.result.message);
    if (!text) throw new Error('Claude Batch ha restituito un messaggio vuoto.');
    const parsed = parseAiJson(text);
    const usage = item.result.message?.usage || {};
    parsed._providerUsage = {
      inputTokens: Number(usage.input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0,
      totalTokens: (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0),
      cachedInputTokens: (Number(usage.cache_read_input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0),
      batchRequests: 1,
      batchApi: true
    };
    return parsed;
  }
  throw new Error(`Risultato Claude Batch non trovato per ${customId}.`);
}

export async function claudeAnalyze({ config, prompt, images }) {
  if (!config.aiApiKey) throw new Error('AI_API_KEY è obbligatoria per il provider Claude.');
  if (config.aiClaudeUseBatch === false) {
    return directAnalyze({ config, prompt, images });
  }
  return batchAnalyze({ config, prompt, images });
}
