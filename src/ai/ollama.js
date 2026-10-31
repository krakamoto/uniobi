import { parseAiJson } from './index.js';

export async function ollamaAnalyze({ config, prompt, images }) {
  const base = (config.aiBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  let response;
  try {
    response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.aiModel,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: 'Rispondi esclusivamente con un oggetto JSON valido.' },
          { role: 'user', content: prompt, images: images.map((image) => image.base64) }
        ]
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Timeout di Ollama durante l’analisi delle immagini.');
    throw new Error(`Errore di rete verso Ollama: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const errorText = (await response.text()).slice(0, 500);
    throw new Error(`Ollama ha risposto con HTTP ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  return parseAiJson(data?.message?.content);
}
