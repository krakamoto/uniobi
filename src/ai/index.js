import path from 'node:path';
import { readFileSync } from 'node:fs';
import { mockAnalyze } from './mock.js';
import { openAiAnalyze } from './openai.js';
import { ollamaAnalyze } from './ollama.js';
import { geminiAnalyze } from './gemini.js';
import { claudeAnalyze } from './claude.js';
import { uniqueStrings } from '../utils.js';
import { buildAiVaultContext } from '../vault-analysis.js';
import sharp from 'sharp';
import { optimizeImageForAi } from '../image-optimizer.js';

export async function serializeImage(file, config = {}) {
  const original = readFileSync(file.absolutePath);
  let buffer = original;
  let mimeType = file.mimeType || 'image/jpeg';
  let processing = {
    name: path.basename(file.absolutePath),
    cropApplied: false,
    cropReason: 'ottimizzazione non applicata',
    originalWidth: null,
    originalHeight: null,
    width: null,
    height: null,
    outputBytes: original.length
  };
  try {
    const optimized = await optimizeImageForAi(file.absolutePath, {
      maxSide: config.imageMaxSide,
      quality: config.imageJpegQuality,
      cropEnabled: config.imageCropEnabled,
      analysisSide: config.imageCropAnalysisSide,
      threshold: config.imageCropThreshold,
      paddingRatio: config.imageCropPaddingRatio,
      maxInkLossRatio: config.imageCropMaxInkLossRatio,
      minContentRatio: config.imageCropMinContentRatio
    });
    buffer = optimized.buffer;
    mimeType = optimized.mimeType;
    processing = {
      name: path.basename(file.absolutePath),
      cropApplied: optimized.cropApplied,
      cropReason: optimized.cropReason,
      cropBox: optimized.cropBox,
      cropMetrics: optimized.cropMetrics,
      originalWidth: optimized.originalWidth,
      originalHeight: optimized.originalHeight,
      width: optimized.width,
      height: optimized.height,
      maxSide: optimized.maxSide,
      outputBytes: optimized.outputBytes
    };
  } catch (error) {
    try {
      buffer = await sharp(original)
        .rotate()
        .resize({ width: Number(config.imageMaxSide) || 1600, height: Number(config.imageMaxSide) || 1600, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: Number(config.imageJpegQuality) || 88, mozjpeg: true })
        .toBuffer();
      mimeType = 'image/jpeg';
      processing.cropReason = `fallback senza crop: ${error.message}`;
      processing.outputBytes = buffer.length;
    } catch {
      // Se il formato non è supportato da sharp, invia l'originale al provider.
      processing.cropReason = `immagine originale inviata: ${error.message}`;
    }
  }
  return {
    mimeType,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    base64: buffer.toString('base64'),
    name: path.basename(file.absolutePath),
    processing
  };
}

export function parseAiJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Il provider AI ha restituito una risposta vuota.');
  try {
    return JSON.parse(raw);
  } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }
  throw new Error('Il provider AI non ha restituito un JSON valido.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableAiError(error) {
  const message = String(error?.message || error || '').toLocaleLowerCase('it');
  if (/http (400|401|403|404)\b/.test(message)) return false;
  if (/bloccat|blockreason|safety/.test(message)) return false;
  return /http (429|500|502|503|504)\b|timeout|timeout di gemini|errore di rete|fetch failed|econn|socket|empty|vuota|non ha restituito|json valido|unavailable|overloaded|rate limit|high demand/.test(message);
}

function normalizeAnalyzedIndexes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((index) => Number.isInteger(index) && index >= 0))];
}

function normalizeOneBasedIndexes(indexes, expectedIndexes = []) {
  const expected = [...new Set(expectedIndexes.map(Number).filter((index) => Number.isInteger(index) && index >= 0))];
  const reported = normalizeAnalyzedIndexes(indexes);
  if (!expected.includes(0) || reported.length === 0 || reported.includes(0)) return reported;
  if (!reported.every((index) => index >= 1 && index <= expected.length)) return reported;
  if (reported.length !== expected.length && expected.length !== 1) return reported;
  return reported.map((index) => index - 1);
}

export function missingImageIndexes(result, expectedIndexes = []) {
  const expected = [...new Set(expectedIndexes.map(Number).filter((index) => Number.isInteger(index) && index >= 0))];
  const reported = normalizeOneBasedIndexes(result?.analyzedImageIndexes || result?.analyzed_image_indexes, expected);
  return expected.filter((index) => !reported.includes(index));
}

function normalizeResultFigureIndexes(result, expectedIndexes) {
  const expected = [...new Set(expectedIndexes.map(Number).filter((index) => Number.isInteger(index) && index >= 0))];
  const figures = (result.notes || []).flatMap((note) => note.figures || []);
  if (!expected.includes(0) || figures.length === 0) return result;
  const raw = figures.map((figure) => Number(figure.sourceImageIndex)).filter(Number.isInteger);
  const needsShift = raw.length > 0
    && !raw.includes(0)
    && raw.every((index) => index >= 1 && index <= expected.length)
    && (expected.length === 1 || raw.some((index) => index === expected.length));
  if (!needsShift) return result;
  for (const note of result.notes || []) {
    for (const figure of note.figures || []) {
      if (Number.isInteger(Number(figure.sourceImageIndex))) figure.sourceImageIndex = Number(figure.sourceImageIndex) - 1;
    }
  }
  result.figures = (result.notes || []).flatMap((note) => note.figures || []);
  return result;
}

function mergeUsage(usages) {
  const valid = usages.filter(Boolean);
  if (!valid.length) return null;
  const total = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, batchRequests: 0, batchApi: false };
  for (const usage of valid) {
    total.inputTokens += Number(usage.inputTokens) || 0;
    total.outputTokens += Number(usage.outputTokens) || 0;
    total.totalTokens += Number(usage.totalTokens) || (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
    total.cachedInputTokens += Number(usage.cachedInputTokens) || 0;
    total.batchRequests += Number(usage.batchRequests) || 0;
    total.batchApi = total.batchApi || Boolean(usage.batchApi);
  }
  return total;
}

function mergeNotesByTitle(notes) {
  const merged = [];
  const byTitle = new Map();
  for (const note of notes) {
    const key = String(note.title || '').trim().toLocaleLowerCase('it') || `nota-${merged.length + 1}`;
    const existing = byTitle.get(key);
    if (!existing) {
      const copy = { ...note };
      byTitle.set(key, copy);
      merged.push(copy);
      continue;
    }
    existing.markdown = [existing.markdown, note.markdown].filter(Boolean).join('\n\n');
    existing.extractedText = [existing.extractedText, note.extractedText].filter(Boolean).join('\n\n');
    existing.summary = existing.summary || note.summary || '';
    existing.tags = uniqueStrings([...(existing.tags || []), ...(note.tags || [])]);
    existing.aliases = uniqueStrings([...(existing.aliases || []), ...(note.aliases || [])]);
    existing.keyConcepts = uniqueStrings([...(existing.keyConcepts || []), ...(note.keyConcepts || [])]);
    existing.conceptRelations = [...(existing.conceptRelations || []), ...(note.conceptRelations || [])];
    existing.figures = [...(existing.figures || []), ...(note.figures || [])];
    existing.links = [...(existing.links || []), ...(note.links || [])];
    existing.warnings = uniqueStrings([...(existing.warnings || []), ...(note.warnings || [])]);
    const values = [existing.confidence, note.confidence].map(Number).filter(Number.isFinite);
    existing.confidence = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : existing.confidence;
  }
  return merged;
}

function remapResultImageIndexes(result, originalIndex) {
  const notes = (result.notes || []).map((note) => ({
    ...note,
    figures: (note.figures || []).map((figure) => ({ ...figure, sourceImageIndex: originalIndex }))
  }));
  return {
    ...result,
    notes,
    noteCount: notes.length,
    figures: notes.flatMap((note) => note.figures || []),
    analyzedImageIndexes: [originalIndex]
  };
}

function mergePartialResults(results, expectedIndexes, batchError) {
  const notes = mergeNotesByTitle(results.flatMap((result) => result.notes || []));
  const first = results[0] || {};
  const confidenceValues = notes.map((note) => Number(note.confidence)).filter(Number.isFinite);
  return {
    notes,
    noteCount: notes.length,
    analyzedImageIndexes: [...expectedIndexes],
    title: notes[0]?.title || first.title || '',
    course: first.course || '',
    subject: first.subject || '',
    subjectPath: first.subjectPath || '',
    date: first.date || '',
    tags: uniqueStrings(notes.flatMap((note) => note.tags || [])),
    aliases: uniqueStrings(notes.flatMap((note) => note.aliases || [])),
    summary: results.map((result) => result.summary).filter(Boolean).join(' '),
    extractedText: notes.map((note) => note.extractedText).filter(Boolean).join('\n\n'),
    keyConcepts: uniqueStrings(notes.flatMap((note) => note.keyConcepts || [])),
    conceptRelations: notes.flatMap((note) => note.conceptRelations || []),
    figures: notes.flatMap((note) => note.figures || []),
    markdown: notes[0]?.markdown || '',
    links: notes.flatMap((note) => note.links || []),
    confidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0.5,
    warnings: uniqueStrings([
      ...results.flatMap((result) => result.warnings || []),
      ...(batchError ? [`Analisi batch non riuscita; completata per singola immagine: ${batchError.message}`] : [])
    ]),
    analyzedImageIndexes: [...expectedIndexes],
    perImageFallbackUsed: true,
    retryAttempts: Math.max(...results.map((result) => Number(result.retryAttempts) || 1)),
    usage: mergeUsage(results.map((result) => result.usage)),
    imageProcessing: results.flatMap((result) => result.imageProcessing || [])
  };
}

function normalizeSingleNote(result, fallback = {}) {
  const raw = result && typeof result === 'object' ? result : {};
  const title = String(raw.title || fallback.title || 'Appunti senza titolo').trim();
  const markdown = String(raw.markdown || raw.content || fallback.markdown || `# ${title}\n\n${fallback.extractedText || ''}`).trim();
  const links = Array.isArray(raw.links)
    ? raw.links.map((link) => {
        if (typeof link === 'string') return { target: link, reason: '', exists: false };
        return {
          target: String(link?.target || link?.note || '').trim(),
          reason: String(link?.reason || '').trim(),
          exists: Boolean(link?.exists)
        };
      }).filter((link) => link.target)
    : [];
  const conceptRelations = Array.isArray(raw.conceptRelations)
    ? raw.conceptRelations.map((relation) => ({
        from: String(relation?.from || '').trim(),
        to: String(relation?.to || '').trim(),
        label: String(relation?.label || '').trim()
      })).filter((relation) => relation.from && relation.to)
    : [];
  const figures = Array.isArray(raw.figures)
    ? raw.figures.map((figure, index) => ({
        id: String(figure?.id || `fig${index + 1}`).trim(),
        sourceImageIndex: Number.isInteger(Number(figure?.sourceImageIndex)) ? Number(figure.sourceImageIndex) : 0,
        bbox: Array.isArray(figure?.bbox) ? figure.bbox.map(Number) : figure?.bbox,
        caption: String(figure?.caption || figure?.label || '').trim(),
        kind: String(figure?.kind || 'diagram').trim()
      })).filter((figure) => figure.caption || figure.bbox)
    : [];
  return {
    title,
    course: String(raw.course || fallback.course || '').trim(),
    subject: String(raw.subject || fallback.subject || '').trim(),
    subjectPath: String(raw.subjectPath || raw.subject_path || fallback.subjectPath || '').trim(),
    date: String(raw.date || fallback.date || '').trim(),
    tags: uniqueStrings(Array.isArray(raw.tags) ? raw.tags : []),
    aliases: uniqueStrings(Array.isArray(raw.aliases) ? raw.aliases : []),
    summary: String(raw.summary || '').trim(),
    extractedText: String(raw.extractedText || raw.extracted_text || '').trim(),
    keyConcepts: uniqueStrings(Array.isArray(raw.keyConcepts) ? raw.keyConcepts : []),
    conceptRelations,
    figures,
    markdown,
    links,
    confidence: Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : 0.5,
    warnings: uniqueStrings(Array.isArray(raw.warnings) ? raw.warnings : [])
  };
}

export function normalizeAiResult(raw, fallback = {}) {
  const result = raw && typeof raw === 'object' ? raw : {};
  const rawNotes = Array.isArray(result.notes) && result.notes.length > 0
    ? result.notes
    : [result];
  const notes = rawNotes.map((note, index) => normalizeSingleNote(note, {
    title: fallback.title,
    course: result.course || fallback.course,
    subject: result.subject || fallback.subject,
    subjectPath: result.subjectPath || result.subject_path || fallback.subjectPath,
    date: result.date || fallback.date,
    markdown: index === 0 ? fallback.markdown : '',
    extractedText: index === 0 ? fallback.extractedText : ''
  }));

  const warnings = uniqueStrings([
    ...(Array.isArray(result.warnings) ? result.warnings : []),
    ...notes.flatMap((note) => note.warnings)
  ]);
  const confidenceValues = notes.map((note) => note.confidence).filter(Number.isFinite);
  const overallConfidence = Number.isFinite(Number(result.confidence))
    ? Math.max(0, Math.min(1, Number(result.confidence)))
    : (confidenceValues.length ? confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length : 0.5);

  return {
    notes,
    noteCount: notes.length,
    analyzedImageIndexes: normalizeAnalyzedIndexes(result.analyzedImageIndexes || result.analyzed_image_indexes),
    usage: raw._providerUsage || null,
    title: notes[0].title,
    course: String(result.course || notes[0].course || fallback.course || '').trim(),
    subject: String(result.subject || notes[0].subject || fallback.subject || '').trim(),
    subjectPath: String(result.subjectPath || result.subject_path || notes[0].subjectPath || fallback.subjectPath || '').trim(),
    date: String(result.date || notes[0].date || fallback.date || '').trim(),
    tags: uniqueStrings(notes.flatMap((note) => note.tags)),
    aliases: uniqueStrings(notes.flatMap((note) => note.aliases)),
    summary: String(result.summary || notes[0].summary || '').trim(),
    extractedText: notes.map((note) => note.extractedText).filter(Boolean).join('\n\n'),
    keyConcepts: uniqueStrings(notes.flatMap((note) => note.keyConcepts)),
    conceptRelations: notes.flatMap((note) => note.conceptRelations),
    figures: notes.flatMap((note) => note.figures),
    markdown: notes[0].markdown,
    links: notes.flatMap((note) => note.links),
    confidence: overallConfidence,
    warnings
  };
}

async function runProvider({ providerConfig, prompt, images, metadata, files, vaultNotes }) {
  switch (providerConfig.aiProvider) {
    case 'mock':
      return normalizeAiResult(await mockAnalyze({ metadata, files, vaultNotes }));
    case 'openai':
    case 'openai-compatible':
    case 'openrouter':
      return normalizeAiResult(await openAiAnalyze({ config: providerConfig, prompt, images }));
    case 'deepseek':
      return normalizeAiResult(await openAiAnalyze({
        config: {
          ...providerConfig,
          aiBaseUrl: providerConfig.aiBaseUrl || 'https://api.deepseek.com'
        },
        prompt,
        images
      }));
    case 'gemini':
      return normalizeAiResult(await geminiAnalyze({ config: providerConfig, prompt, images }));
    case 'claude':
    case 'anthropic':
      return normalizeAiResult(await claudeAnalyze({ config: providerConfig, prompt, images }));
    case 'ollama':
      return normalizeAiResult(await ollamaAnalyze({ config: providerConfig, prompt, images }));
    default:
      throw new Error(`Provider AI non supportato: ${providerConfig.aiProvider}. Usa mock, gemini, deepseek, claude, anthropic, openai, openai-compatible, openrouter o ollama.`);
  }
}

export function shouldUseAdvancedFallback(result, files, config) {
  if (!config.aiFallbackEnabled || !config.aiFallbackModel || config.aiProvider === 'mock') {
    return { needed: false, reason: '' };
  }
  const reasons = [];
  const notes = Array.isArray(result?.notes) && result.notes.length ? result.notes : [result || {}];
  const markdownLength = notes.reduce((total, note) => total + String(note.markdown || '').trim().length, 0);
  const extractedText = notes.map((note) => String(note.extractedText || '').trim()).join(' ').trim();
  const noteConfidences = notes.map((note) => Number(note.confidence)).filter(Number.isFinite);
  const confidence = Number.isFinite(Number(result?.confidence))
    ? Number(result.confidence)
    : (noteConfidences.length ? Math.min(...noteConfidences) : 0.5);
  const warnings = [
    ...(result?.warnings || []),
    ...notes.flatMap((note) => note.warnings || [])
  ].join(' ').toLocaleLowerCase('it');
  const missingIndexes = missingImageIndexes(result, files.map((_, index) => index));
  if (missingIndexes.length) reasons.push(`immagini non analizzate: ${missingIndexes.map((index) => index + 1).join(', ')}`);

  const hasIllegibleWarning = /(illeggibil|non leggibil|poco leggibil|incert|dubbio|bassa qualit)/.test(warnings);
  const manualReviewOnly = hasIllegibleWarning && !config.aiFallbackOnIllegible;
  if (markdownLength < 120 && !manualReviewOnly) reasons.push('Markdown troppo corto o incompleto');
  if (confidence < config.aiFallbackMinConfidence && !manualReviewOnly) {
    reasons.push(`confidenza ${confidence.toFixed(2)} < soglia ${config.aiFallbackMinConfidence}`);
  }
  if (config.aiFallbackOnIllegible && hasIllegibleWarning) {
    reasons.push('sono state segnalate parti illeggibili o incerte');
  }
  const minChars = Math.max(1, files.length) * config.aiFallbackMinCharsPerImage;
  if (extractedText.length < minChars && !manualReviewOnly) {
    reasons.push(`trascrizione troppo breve (${extractedText.length}/${minChars} caratteri)`);
  }

  return { needed: reasons.length > 0, reason: reasons.join('; ') };
}

async function runProviderWithRetries({ providerConfig, prompt, images, metadata, files, vaultNotes, expectedIndexes, budget }) {
  const maxAttempts = Math.max(1, Number(providerConfig.aiRetryMaxAttempts) || 1);
  const baseDelay = Math.max(0, Number(providerConfig.aiRetryBaseDelayMs) || 0);
  const maxDelay = Math.max(0, Number(providerConfig.aiRetryMaxDelayMs) || 0);
  const needsCoverage = ['gemini', 'claude', 'anthropic'].includes(providerConfig.aiProvider) && expectedIndexes.length > 0;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (budget) {
      budget.calls += 1;
      if (budget.calls > budget.max) throw new Error(`Budget massimo di ${budget.max} chiamate AI per job superato.`);
    }
    try {
      const result = await runProvider({ providerConfig, prompt, images, metadata, files, vaultNotes });
      if (!result.notes?.length) throw new Error('Il provider AI non ha prodotto note complete.');
      normalizeResultFigureIndexes(result, expectedIndexes);
      const missing = needsCoverage ? missingImageIndexes(result, expectedIndexes) : [];
      if (missing.length === 0) {
        result.analyzedImageIndexes = expectedIndexes;
        result.retryAttempts = attempt;
        result.imageProcessing = images.map((image) => image.processing || { name: image.name });
        return result;
      }
      lastError = new Error(`Il provider non ha analizzato tutte le immagini (mancanti: ${missing.map((index) => index + 1).join(', ')}).`);
    } catch (error) {
      lastError = error;
      if (!isRetryableAiError(error)) throw error;
    }

    if (attempt < maxAttempts) {
      const exponential = Math.min(maxDelay, baseDelay * (2 ** (attempt - 1)));
      const jitter = exponential > 0 ? Math.floor(Math.random() * Math.min(1000, exponential / 2)) : 0;
      await sleep(exponential + jitter);
    }
  }
  throw lastError || new Error('Analisi AI non riuscita.');
}

async function runProviderResilient(options) {
  const expectedIndexes = options.images.map((_, index) => index);
  try {
    return await runProviderWithRetries({ ...options, expectedIndexes });
  } catch (batchError) {
    if (options.images.length <= 1) throw batchError;
    const maxPerImage = Math.max(1, Number(options.providerConfig.aiPerImageFallbackMaxImages) || 6);
    if (options.images.length > maxPerImage) {
      throw new Error(`Analisi batch incompleta su ${options.images.length} foto. Fallback per singola immagine disattivato oltre ${maxPerImage} foto per evitare costi eccessivi.`);
    }
    const partials = [];
    for (let index = 0; index < options.images.length; index += 1) {
      const singlePrompt = `${options.prompt}

ATTENZIONE: questa richiesta contiene UNA SOLA immagine (indice originale ${index}). Analizza questa immagine e restituisci analyzedImageIndexes: [${index}]. Per le figure usa sourceImageIndex: ${index}.`;
      try {
        const single = await runProviderWithRetries({
          ...options,
          prompt: singlePrompt,
          images: [options.images[index]],
          expectedIndexes: [0]
        });
        partials.push(remapResultImageIndexes(single, index));
      } catch (singleError) {
        throw new Error(`Impossibile analizzare la foto ${index + 1}/${options.images.length}: ${singleError.message}`);
      }
    }
    return mergePartialResults(partials, expectedIndexes, batchError);
  }
}

export async function analyzeImages({ config, files, aiFiles, pdfTextSections = [], metadata, vaultNotes, vaultAnalysis, matchedSubject, budget: sharedBudget }) {
  const budget = sharedBudget || { calls: 0, max: Math.max(1, Number(config.aiMaxProviderCallsPerJob) || 12) };
  const imageFiles = Array.isArray(aiFiles) ? aiFiles : files;
  const images = await Promise.all(imageFiles.map((file) => serializeImage(file, config)));
  const existingTitles = vaultNotes
    .map((note) => note.title)
    .filter(Boolean)
    .slice(0, 250);
  const vaultContext = vaultAnalysis
    ? buildAiVaultContext(vaultAnalysis, matchedSubject, metadata.course)
    : '';

  const imageManifest = imageFiles.length
    ? imageFiles.map((file, index) => `- immagine [${index}]: ${file.displayName || file.originalName || file.relativePath || `allegato ${index + 1}`}${file.pdfPage ? ` (pagina ${file.pdfPage} del PDF)` : ''}`).join('\n')
    : '- nessuna immagine: il materiale è interamente fornito come testo estratto da PDF.';
  const pdfTextContext = pdfTextSections.length
    ? `\nTesti estratti dai PDF (sono già trascritti dal server: usali come fonte e non fare OCR su queste pagine):\n${pdfTextSections.map((section) => `\n--- PDF: ${section.fileName} — pagina ${section.pageNumber}/${section.pageCount} ---\n${section.text}`).join('\n')}`
    : '';

  const prompt = `Analizza gli allegati di appunti universitari (immagini e/o testo estratto da PDF) e convertili in una nota Markdown per Obsidian.

${vaultContext}

Metadati forniti dall'utente:
- Corso: ${metadata.course || '(non specificato)'}
- Data: ${metadata.date || '(non specificata)'}
- Titolo richiesto: ${metadata.title || '(nessuno)'}
- Tag richiesti: ${(metadata.tags || []).join(', ') || '(nessuno)'}
- Istruzioni aggiuntive: ${metadata.userNotes || '(nessuna)'}

Note già presenti nel vault Obsidian (usa SOLO questi titoli per i wikilink esistenti):
${existingTitles.length ? existingTitles.map((title) => `- ${title}`).join('\n') : '- (vault vuoto)'}

Allegati visivi inviati al modello (indici 0-based):
${imageManifest}
${pdfTextContext}

Regole precise basate sul vault reale:
1. Trascrivi fedelmente il contenuto; non inventare informazioni.
2. Correggi solo refusi evidenti. Per ogni parte scritta a mano non leggibile inserisci nel punto esatto un callout Obsidian:
   > [!warning] Parte illeggibile
   > Breve descrizione di ciò che manca o non è comprensibile.
   Usa anche il marcatore [illeggibile] nel testo e inserisci un warning specifico con il numero dell'immagine. Non inventare il contenuto mancante.
3. Produci Markdown Obsidian valido: H1, sezioni H2/H3, elenchi, callout Obsidian per avvisi e incertezze.
3b. Ogni simbolo, variabile o espressione matematica deve essere racchiusa tra $...$ se inline o $$...$$ se display. Non scrivere MAI comandi LaTeX nudi come \frac, \vec, \alpha, \sum: devono sempre trovarsi dentro i delimitatori $ o $$.
4. Usa un titolo descrittivo in italiano, senza data e senza prefisso numerico. Deve descrivere il concetto, non la lezione in generale.
5. Classifica la nota nella materia esistente più pertinente. Se nessuna materia è pertinente, proponi un nome di materia breve e stabile.
6. Inserisci wikilink [[Titolo nota]] solo verso titoli presenti nell'elenco delle note esistenti. Non inventare wikilink.
7. Valuta se le immagini contengono argomenti chiaramente distinti. Se sì, dividi il materiale in note atomiche separate, una per argomento, con un massimo di 6 note. Se le immagini sono pagine consecutive dello stesso argomento, genera una sola nota.
8. Ogni nota deve essere autonoma: titolo specifico, riassunto, contenuto completo, concetti chiave, tag e collegamenti. Inserisci wikilink tra le nuove note quando sono correlate, usando il titolo della nota come target.
8b. Per schemi, grafici, tabelle, circuiti o disegni presenti nelle immagini, NON ridisegnarli e NON inventare immagini o URL. Restituisci un array figures con ritaglio dell'immagine originale: id, sourceImageIndex (indice 0-based dell'immagine caricata), bbox normalizzato [x,y,width,height] da 0 a 1, caption e kind. Inserisci nel markdown il placeholder {{id}} nel punto in cui deve comparire la figura. Se non ci sono figure da ritagliare, usa figures: [].
9. Estrai 3-10 concetti chiave atomici e alcune relazioni concettuali per ogni nota. Usa termini coerenti con la terminologia delle note esistenti.
10. Non includere frontmatter YAML: il backend lo genera. Il campo markdown deve contenere solo il corpo della nota.
11. Ogni immagine allegata deve essere analizzata: non omettere nessuna foto o pagina PDF rasterizzata. Inserisci nel campo analyzedImageIndexes TUTTI e SOLI gli indici delle immagini visive che hai effettivamente letto, usando indici 0-based (la prima immagine è 0, non 1). Le pagine PDF fornite come testo estratto non hanno un indice immagine e non vanno inserite in analyzedImageIndexes. Se una foto è illeggibile, includila comunque e segnalalo nei warnings.
12. Se ricevi testo estratto da PDF, usalo per ricostruire fedelmente il contenuto, rispettando l'ordine delle pagine. Non citare i marcatori tecnici "--- PDF: ... ---" nella nota finale.
13. Se un PDF è composto sia da pagine testuali sia da pagine scansionate, combina le due fonti senza duplicare il contenuto.
14. Restituisci ESCLUSIVAMENTE un oggetto JSON valido, senza testo fuori dal JSON, con questa forma:
{
  "course": "Nome corso indicato o dedotto",
  "subject": "Materia esistente o proposta",
  "subjectPath": "Percorso relativo della materia esistente, se nota",
  "date": "YYYY-MM-DD",
  "summary": "Riassunto complessivo del gruppo di immagini",
  "confidence": 0.0,
  "warnings": ["Eventuali dubbi complessivi"],
  "analyzedImageIndexes": [0, 1],
  "notes": [
    {
      "title": "Titolo sintetico del primo argomento",
      "tags": ["lezione", "argomento"],
      "aliases": ["Sinonimo o variante terminologica"],
      "summary": "Breve riassunto della singola nota",
      "extractedText": "Trascrizione testuale della porzione di appunti relativa a questa nota",
      "keyConcepts": ["concetto 1", "concetto 2"],
      "conceptRelations": [{"from": "concetto 1", "to": "concetto 2", "label": "relazione"}],
      "figures": [{"id": "fig1", "sourceImageIndex": 0, "bbox": [0.10, 0.30, 0.55, 0.25], "caption": "Schema del sistema", "kind": "diagram"}],
      "markdown": "# Titolo\\n\\n## Contenuto\\n...",
      "links": [{"target": "Titolo di un'altra nota del gruppo o nota esistente", "reason": "Motivo", "exists": true}],
      "confidence": 0.0,
      "warnings": []
    }
  ]
}`;

  let primary = null;
  let primaryError = null;
  try {
    primary = await runProviderResilient({ providerConfig: config, prompt, images, metadata, files: imageFiles, vaultNotes, budget });
    primary.modelUsed = config.aiModel;
    primary.fallbackUsed = false;
    primary.fallbackAttempted = false;
    primary.fallbackReason = '';
  } catch (error) {
    primaryError = error;
  }

  const fallbackConfig = {
    ...config,
    aiProvider: config.aiFallbackProvider,
    aiModel: config.aiFallbackModel,
    aiApiKey: config.aiFallbackApiKey,
    aiBaseUrl: config.aiFallbackBaseUrl
  };
  const emergencyConfig = {
    ...config,
    aiProvider: config.aiEmergencyProvider,
    aiModel: config.aiEmergencyModel,
    aiApiKey: config.aiEmergencyApiKey,
    aiBaseUrl: config.aiEmergencyBaseUrl
  };
  const fallbackDecision = primary
    ? shouldUseAdvancedFallback(primary, imageFiles, config)
    : { needed: Boolean(config.aiFallbackEnabled && config.aiFallbackModel), reason: `provider primario fallito: ${primaryError?.message || primaryError}` };

  let fallbackError = null;
  if (fallbackDecision.needed) {
    try {
      const advanced = await runProviderResilient({
        providerConfig: fallbackConfig,
        prompt,
        images,
        metadata,
        files: imageFiles,
        vaultNotes,
        budget
      });
      advanced.modelUsed = fallbackConfig.aiModel;
      advanced.primaryModel = config.aiModel;
      advanced.fallbackUsed = true;
      advanced.fallbackAttempted = true;
      advanced.fallbackReason = fallbackDecision.reason;
      return advanced;
    } catch (error) {
      fallbackError = error;
    }
  }

  const needEmergency = Boolean(config.aiEmergencyEnabled && config.aiEmergencyModel && (primaryError || fallbackError));
  if (needEmergency) {
    try {
      const emergency = await runProviderResilient({
        providerConfig: emergencyConfig,
        prompt,
        images,
        metadata,
        files: imageFiles,
        vaultNotes,
        budget
      });
      emergency.modelUsed = emergencyConfig.aiModel;
      emergency.primaryModel = config.aiModel;
      emergency.fallbackUsed = true;
      emergency.fallbackAttempted = true;
      emergency.emergencyUsed = true;
      emergency.fallbackReason = uniqueStrings([
        fallbackDecision.reason,
        fallbackError ? `fallback ${fallbackConfig.aiModel} fallito: ${fallbackError.message}` : ''
      ]).join('; ');
      return emergency;
    } catch (emergencyError) {
      if (!primary) {
        throw new Error(`Provider primario fallito (${primaryError?.message || primaryError}). Fallback ${fallbackConfig.aiModel} fallito: ${fallbackError?.message || 'non tentato'}. Emergenza ${emergencyConfig.aiModel} fallita: ${emergencyError.message}`);
      }
      primary.warnings = uniqueStrings([
        ...(primary.warnings || []),
        fallbackError ? `Fallback ${fallbackConfig.aiModel} non riuscito: ${fallbackError.message}` : '',
        `Provider di emergenza ${emergencyConfig.aiModel} non riuscito: ${emergencyError.message}`
      ]);
      primary.fallbackAttempted = Boolean(fallbackError);
      primary.fallbackUsed = false;
      primary.fallbackReason = fallbackDecision.reason;
      return primary;
    }
  }

  if (!primary) {
    throw new Error(`Provider primario fallito (${primaryError?.message || primaryError}). ${fallbackError ? `Fallback ${fallbackConfig.aiModel} fallito: ${fallbackError.message}` : ''}`);
  }
  if (fallbackError) {
    primary.warnings = uniqueStrings([
      ...(primary.warnings || []),
      `Fallback ${fallbackConfig.aiModel} non riuscito: ${fallbackError.message}`
    ]);
    primary.fallbackAttempted = true;
    primary.fallbackUsed = false;
    primary.fallbackReason = fallbackDecision.reason;
  }
  return primary;
}
