import { uniqueStrings } from '../utils.js';

export async function mockAnalyze({ metadata, vaultNotes }) {
  const title = metadata.title || `Appunti di ${metadata.course || 'lezione'}${metadata.date ? ` - ${metadata.date}` : ''}`;
  const existing = vaultNotes[0]?.title || '';
  const tags = uniqueStrings(['lezione', 'mock', ...(metadata.tags || [])]);
  const linkLine = existing ? `\n\nCollegamento utile: [[${existing}]].` : '';
  return {
    title,
    course: metadata.course || '',
    date: metadata.date || '',
    tags,
    aliases: [],
    summary: 'Nota generata in modalità mock per verificare il flusso completo di UniAi.',
    extractedText: `Trascrizione simulata degli appunti caricati. File ricevuti: ${(metadata.files || []).length || 1}.`,
    markdown: `# ${title}\n\n> [!info] Modalità mock\n> Questa nota è stata generata senza chiamare un provider AI esterno.\n\n## Appunti\n\nContenuto di prova relativo a **${metadata.course || 'argomento non specificato'}**.${linkLine}\n\n- Punto principale trascritto dalle immagini\n- Secondo concetto della lezione\n\n## Riassunto\n\n${metadata.userNotes || 'Appunti di prova pronti per essere salvati nel vault.'}`,
    links: existing ? [{ target: existing, reason: 'Nota presente nel vault di test', exists: true }] : [],
    confidence: 0.55,
    warnings: ['Provider mock attivo: il testo non proviene da OCR reale.']
  };
}
