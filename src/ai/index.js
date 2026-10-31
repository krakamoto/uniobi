import path from 'node:path';
import { readFileSync } from 'node:fs';
import { mockAnalyze } from './mock.js';
import { openAiAnalyze } from './openai.js';
import { ollamaAnalyze } from './ollama.js';
import { geminiAnalyze } from './gemini.js';
import { uniqueStrings } from '../utils.js';
import { buildAiVaultContext } from '../vault-analysis.js';

export function serializeImage(file) {
  const buffer = readFileSync(file.absolutePath);
  return {
    mimeType: file.mimeType || 'image/jpeg',
    dataUrl: `data:${file.mimeType || 'image/jpeg'};base64,${buffer.toString('base64')}`,
    base64: buffer.toString('base64'),
    name: path.basename(file.absolutePath)
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

export function normalizeAiResult(raw, fallback = {}) {
  const result = raw && typeof raw === 'object' ? raw : {};
  const title = String(result.title || fallback.title || 'Appunti senza titolo').trim();
  const markdown = String(result.markdown || result.content || fallback.markdown || `# ${title}\n\n${fallback.extractedText || ''}`).trim();
  const links = Array.isArray(result.links)
    ? result.links.map((link) => {
        if (typeof link === 'string') return { target: link, reason: '', exists: false };
        return {
          target: String(link?.target || link?.note || '').trim(),
          reason: String(link?.reason || '').trim(),
          exists: Boolean(link?.exists)
        };
      }).filter((link) => link.target)
    : [];
  const conceptRelations = Array.isArray(result.conceptRelations)
    ? result.conceptRelations.map((relation) => ({
        from: String(relation?.from || '').trim(),
        to: String(relation?.to || '').trim(),
        label: String(relation?.label || '').trim()
      })).filter((relation) => relation.from && relation.to)
    : [];
  return {
    title,
    course: String(result.course || fallback.course || '').trim(),
    subject: String(result.subject || '').trim(),
    subjectPath: String(result.subjectPath || result.subject_path || '').trim(),
    date: String(result.date || fallback.date || '').trim(),
    tags: uniqueStrings(Array.isArray(result.tags) ? result.tags : []),
    aliases: uniqueStrings(Array.isArray(result.aliases) ? result.aliases : []),
    summary: String(result.summary || '').trim(),
    extractedText: String(result.extractedText || result.extracted_text || '').trim(),
    keyConcepts: uniqueStrings(Array.isArray(result.keyConcepts) ? result.keyConcepts : []),
    conceptRelations,
    markdown,
    links,
    confidence: Number.isFinite(Number(result.confidence)) ? Math.max(0, Math.min(1, Number(result.confidence))) : 0.5,
    warnings: uniqueStrings(Array.isArray(result.warnings) ? result.warnings : [])
  };
}

export async function analyzeImages({ config, files, metadata, vaultNotes, vaultAnalysis, matchedSubject }) {
  const images = files.map(serializeImage);
  const existingTitles = vaultNotes
    .map((note) => note.title)
    .filter(Boolean)
    .slice(0, 250);
  const vaultContext = vaultAnalysis
    ? buildAiVaultContext(vaultAnalysis, matchedSubject, metadata.course)
    : '';

  const prompt = `Analizza le immagini allegate di appunti universitari e convertile in una nota Markdown per Obsidian.

${vaultContext}

Metadati forniti dall'utente:
- Corso: ${metadata.course || '(non specificato)'}
- Data: ${metadata.date || '(non specificata)'}
- Titolo richiesto: ${metadata.title || '(nessuno)'}
- Tag richiesti: ${(metadata.tags || []).join(', ') || '(nessuno)'}
- Istruzioni aggiuntive: ${metadata.userNotes || '(nessuna)'}

Note già presenti nel vault Obsidian (usa SOLO questi titoli per i wikilink esistenti):
${existingTitles.length ? existingTitles.map((title) => `- ${title}`).join('\n') : '- (vault vuoto)'}

Regole precise basate sul vault reale:
1. Trascrivi fedelmente il contenuto; non inventare informazioni.
2. Correggi solo refusi evidenti. Segnala le parti illeggibili con "[illeggibile]" e inseriscile in warnings.
3. Produci Markdown Obsidian valido: H1, sezioni H2/H3, elenchi, callout Obsidian per avvisi e incertezze.
3b. Ogni simbolo, variabile o espressione matematica deve essere racchiusa tra $...$ se inline o $$...$$ se display. Non scrivere MAI comandi LaTeX nudi come \frac, \vec, \alpha, \sum: devono sempre trovarsi dentro i delimitatori $ o $$.
4. Usa un titolo descrittivo in italiano, senza data e senza prefisso numerico. Deve descrivere il concetto, non la lezione in generale.
5. Classifica la nota nella materia esistente più pertinente. Se nessuna materia è pertinente, proponi un nome di materia breve e stabile.
6. Inserisci wikilink [[Titolo nota]] solo verso titoli presenti nell'elenco delle note esistenti. Non inventare wikilink.
7. Estrai 3-10 concetti chiave atomici e alcune relazioni concettuali tra loro. Usa termini coerenti con la terminologia delle note esistenti.
8. Non includere frontmatter YAML: il backend lo genera. Il campo markdown deve contenere solo il corpo della nota.
9. Restituisci ESCLUSIVAMENTE un oggetto JSON valido, senza testo fuori dal JSON, con questa forma:
{
  "title": "Titolo sintetico del concetto",
  "course": "Nome corso indicato o dedotto",
  "subject": "Materia esistente o proposta",
  "subjectPath": "Percorso relativo della materia esistente, se nota",
  "date": "YYYY-MM-DD",
  "tags": ["lezione", "argomento"],
  "aliases": ["Sinonimo o variante terminologica"],
  "summary": "Breve riassunto",
  "extractedText": "Trascrizione testuale completa degli appunti",
  "keyConcepts": ["concetto 1", "concetto 2"],
  "conceptRelations": [{"from": "concetto 1", "to": "concetto 2", "label": "relazione"}],
  "markdown": "# Titolo\\n\\n## Contenuto\\n...",
  "links": [{"target": "Titolo nota esistente", "reason": "Motivo", "exists": true}],
  "confidence": 0.0,
  "warnings": ["Eventuali dubbi o parti illeggibili"]
}`;

  switch (config.aiProvider) {
    case 'mock':
      return normalizeAiResult(await mockAnalyze({ metadata, files, vaultNotes }));
    case 'openai':
    case 'openai-compatible':
    case 'openrouter':
      return normalizeAiResult(await openAiAnalyze({ config, prompt, images }));
    case 'gemini':
      return normalizeAiResult(await geminiAnalyze({ config, prompt, images }));
    case 'ollama':
      return normalizeAiResult(await ollamaAnalyze({ config, prompt, images }));
    default:
      throw new Error(`Provider AI non supportato: ${config.aiProvider}. Usa mock, gemini, openai, openai-compatible, openrouter o ollama.`);
  }
}
