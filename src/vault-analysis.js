import path from 'node:path';
import crypto from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync
} from 'node:fs';
import { normalizeTitle, sanitizeFilename, slugify, uniqueStrings } from './utils.js';
import { validateLatexDelimiters } from './markdown.js';

export const GENERATED_INDEX = '_Indice.md';
export const GENERATED_MAP = '_Mappa concettuale.md';
export const GENERATED_CANVAS = '_Mappa concettuale.canvas';
const GENERATED_FILES = new Set([GENERATED_INDEX, GENERATED_MAP, GENERATED_CANVAS]);
const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules', '.smart-env']);
const SYSTEM_ROOTS = new Set(['triennale', 'magistrale']);

function walkMarkdown(rootDir, current = rootDir, result = []) {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && !entry.name.startsWith('.md')) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(rootDir, absolute, result);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      if (!GENERATED_FILES.has(entry.name)) result.push(absolute);
    }
  }
  return result;
}

function parseFrontmatter(content) {
  const result = { aliases: [], tags: [], title: '' };
  if (!content.startsWith('---')) return result;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return result;
  const yaml = content.slice(3, end);
  let mode = '';
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^title\s*:/i.test(line)) {
      result.title = line.replace(/^title\s*:/i, '').trim().replace(/^['"]|['"]$/g, '');
      mode = '';
      continue;
    }
    if (/^aliases\s*:/i.test(line)) {
      mode = 'aliases';
      const inline = line.replace(/^aliases\s*:/i, '').trim();
      if (inline.startsWith('[')) {
        for (const item of inline.replace(/^\[|\]$/g, '').split(',')) {
          const value = item.trim().replace(/^['"]|['"]$/g, '');
          if (value) result.aliases.push(value);
        }
        mode = '';
      }
      continue;
    }
    if (/^tags\s*:/i.test(line)) {
      mode = 'tags';
      const inline = line.replace(/^tags\s*:/i, '').trim();
      if (inline.startsWith('[')) {
        for (const item of inline.replace(/^\[|\]$/g, '').split(',')) {
          const value = item.trim().replace(/^['"]|['"]$/g, '').replace(/^#/, '');
          if (value) result.tags.push(value);
        }
        mode = '';
      }
      continue;
    }
    if (mode && /^-\s+/.test(line)) {
      const value = line.replace(/^-\s+/, '').replace(/^['"]|['"]$/g, '').replace(/^#/, '');
      if (value) result[mode].push(value);
      continue;
    }
    if (line && !line.startsWith('-') && !line.startsWith(' ')) mode = '';
  }
  return result;
}

function safeTruncate(text, maxLength = 220) {
  let mathDelimiter = '';
  let mathStart = -1;
  let safeEnd = 0;
  let index = 0;
  for (; index < text.length && index < maxLength; index += 1) {
    if (!mathDelimiter) {
      if (text[index] === '$') {
        mathDelimiter = text[index + 1] === '$' ? '$$' : '$';
        mathStart = index;
        if (mathDelimiter === '$$') index += 1;
      } else {
        safeEnd = index + 1;
      }
      continue;
    }
    if (mathDelimiter === '$' && text[index] === '$') {
      mathDelimiter = '';
      safeEnd = index + 1;
      continue;
    }
    if (mathDelimiter === '$$' && text[index] === '$' && text[index + 1] === '$') {
      mathDelimiter = '';
      index += 1;
      safeEnd = index + 1;
    }
  }
  if (mathDelimiter) return `${text.slice(0, mathStart).trim()}…`;
  if (index >= maxLength) {
    return `${text.slice(0, Math.max(safeEnd, 1)).trim()}…`;
  }
  return text;
}

function plainSummary(content) {
  let text = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/!\[\[[^\]]+\]\]/g, ' ');
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/^#{1,6}\s+/gm, '');
  // Mantiene i delimitatori $...$ e $$...$$: i riassunti devono contenere LaTeX valido.
  text = text.replace(/[*_`>]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  let summary = safeTruncate(text, 220);
  if (!validateLatexDelimiters(summary).valid) {
    // Le note sorgente possono contenere comandi LaTeX nudi: nel riassunto
    // dell'indice non li mostriamo fuori dai delimitatori matematici.
    summary = summary.replace(/\\[A-Za-z]+/g, '').replace(/\s+/g, ' ').trim();
  }
  return summary;
}

function noteMetadata(absolutePath, vaultPath) {
  const content = readFileSync(absolutePath, 'utf8');
  const relativePath = path.relative(vaultPath, absolutePath).split(path.sep).join('/');
  const basename = path.basename(absolutePath, '.md');
  const frontmatter = parseFrontmatter(content);
  const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const headings = [...content.matchAll(/^#{2,4}\s+(.+)$/gm)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 16);
  const links = [...content.matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  const stat = statSync(absolutePath);
  const bodyText = content
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
  return {
    title: frontmatter.title || h1 || basename,
    basename,
    relativePath,
    folder: path.posix.dirname(relativePath),
    aliases: uniqueStrings(frontmatter.aliases),
    tags: uniqueStrings(frontmatter.tags),
    headings,
    links: uniqueStrings(links),
    summary: plainSummary(content),
    bodyText,
    size: stat.size,
    mtime: stat.mtime.toISOString()
  };
}

export function detectSubjectPath(relativePath) {
  const segments = String(relativePath || '').split('/').filter(Boolean);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (SYSTEM_ROOTS.has(segments[index].toLocaleLowerCase('it'))) {
      return segments.slice(0, index + 2).join('/');
    }
  }
  return null;
}

function subjectPathFromConfig(relativePath, subjectRoots) {
  const normalizedRoots = subjectRoots
    .map((root) => String(root || '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  for (const root of normalizedRoots) {
    if (!relativePath.startsWith(`${root}/`)) continue;
    const remainder = relativePath.slice(root.length + 1).split('/');
    if (remainder.length >= 2) return `${root}/${remainder[0]}`;
  }
  return detectSubjectPath(relativePath);
}

export function normalizeSubjectName(value) {
  return normalizeTitle(String(value || '').replace(/\b(ii|iii|iv)\b/gi, (roman) => ({
    ii: '2', iii: '3', iv: '4'
  }[roman.toLowerCase()] || roman)));
}

export function suggestedSubjectPath({ subjectName, course, config }) {
  const root = String(
    config.obsidianNewSubjectRoot
    || config.obsidianSubjectRoots?.[0]
    || config.notesSubdir
    || 'Università/Lezioni'
  ).replace(/^\/+|\/+$/g, '');
  const name = sanitizeFilename(subjectName || course || 'Nuova materia', 'Nuova materia');
  return path.posix.join(root, name);
}

export function matchSubject(course, subjects) {
  const needle = normalizeSubjectName(course);
  if (!needle) return null;
  for (const subject of subjects) {
    if (normalizeSubjectName(subject.name) === needle) return subject;
  }
  const scored = subjects.map((subject) => {
    const haystack = normalizeSubjectName(subject.name);
    let score = 0;
    if (haystack.includes(needle) || needle.includes(haystack)) {
      score = Math.min(haystack.length, needle.length) / Math.max(haystack.length, needle.length);
    } else {
      const a = new Set(needle.split(' ').filter((token) => token.length > 2));
      const b = new Set(haystack.split(' ').filter((token) => token.length > 2));
      const intersection = [...a].filter((token) => b.has(token)).length;
      const union = new Set([...a, ...b]).size;
      score = union ? intersection / union : 0;
    }
    return { subject, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 0.5 ? scored[0].subject : null;
}

export function analyzeVaultStructure(vaultPath, { subjectRoots = [] } = {}) {
  const files = walkMarkdown(vaultPath);
  const notes = files.map((file) => noteMetadata(file, vaultPath));
  const groups = new Map();

  for (const note of notes) {
    const subjectPath = subjectPathFromConfig(note.relativePath, subjectRoots);
    if (!subjectPath) continue;
    if (!groups.has(subjectPath)) groups.set(subjectPath, []);
    groups.get(subjectPath).push(note);
  }

  const subjects = [...groups.entries()].map(([relativePath, subjectNotes]) => {
    const name = path.posix.basename(relativePath);
    const namingNumeric = subjectNotes.filter((note) => /^\d{2,4}\s+/.test(note.basename)).length;
    const tags = uniqueStrings(subjectNotes.flatMap((note) => note.tags));
    const allLinks = subjectNotes.reduce((total, note) => total + note.links.length, 0);
    const linkedNotes = subjectNotes.filter((note) => note.links.length > 0).length;
    const headings = subjectNotes.reduce((total, note) => total + note.headings.length, 0);
    return {
      name,
      relativePath,
      notes: subjectNotes.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'it')),
      noteCount: subjectNotes.length,
      tags: tags.slice(0, 30),
      naming: {
        numericPrefixRatio: subjectNotes.length ? namingNumeric / subjectNotes.length : 0,
        sampleNames: subjectNotes.slice(0, 8).map((note) => note.basename)
      },
      stats: {
        links: allLinks,
        linkedNotes,
        headings
      }
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'it'));

  const allNotes = subjects.flatMap((subject) => subject.notes);
  const conventions = {
    totalNotes: notes.length,
    subjectNotes: allNotes.length,
    subjects: subjects.length,
    wikilinkNotes: allNotes.filter((note) => note.links.length > 0).length,
    withAliases: allNotes.filter((note) => note.aliases.length > 0).length,
    withTags: allNotes.filter((note) => note.tags.length > 0).length,
    withMath: allNotes.filter((note) => /(?:^|\s)\$[^$\n]+\$|\$\$/.test(note.summary)).length,
    withCallouts: allNotes.filter((note) => />\s*\[!/.test(note.summary)).length,
    numericPrefixRatio: allNotes.length
      ? allNotes.filter((note) => /^\d{2,4}\s+/.test(note.basename)).length / allNotes.length
      : 0
  };

  return { vaultPath, notes, subjects, conventions, generatedAt: new Date().toISOString() };
}

export function buildAiVaultContext(analysis, matchedSubject, course) {
  const subjectLines = analysis.subjects.map((subject) => {
    const examples = subject.notes.slice(0, 6).map((note) => note.basename).join(' · ');
    return `- ${subject.name} — ${subject.noteCount} note — cartella: ${subject.relativePath}${examples ? ` — esempi: ${examples}` : ''}`;
  });
  const matchedTitles = matchedSubject
    ? matchedSubject.notes.slice(0, 220).map((note) => `- ${note.title}`).join('\n')
    : '(nessuna materia esistente riconosciuta con certezza)';

  return `## Struttura reale del vault Obsidian
Il vault contiene ${analysis.conventions.totalNotes} note Markdown e ${analysis.subjects.length} materie riconosciute.

Materie e cartelle:
${subjectLines.join('\n')}

Materia suggerita per il corso "${course || '(non indicato)'}":
${matchedSubject ? `${matchedSubject.name} — ${matchedSubject.relativePath} — ${matchedSubject.noteCount} note` : 'nessuna corrispondenza certa'}

Titoli delle note esistenti nella materia suggerita (usali per proporre wikilink solo quando pertinenti):
${matchedTitles}

Convenzioni rilevate:
- Le note sono in italiano e usano ampiamente wikilink Obsidian.
- Usa LaTeX inline con $...$ e formule display con $$...$$.
- Usa callout Obsidian come > [!info], > [!warning], > [!tip] quando utili.
- Le immagini nel vault sono allegati con sintassi ![[nome-file]].
- ${Math.round(analysis.conventions.numericPrefixRatio * 100)}% dei file usa un prefisso numerico; NON inserire prefissi numerici nel titolo logico della nota.
- Conserva alias e varianti terminologiche nel frontmatter.
- Non inventare titoli di note esistenti e non inserire wikilink non verificati.`;
}

function atomicWrite(target, content) {
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.uniai-${process.pid}-${Date.now()}.tmp`;
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, target);
}

function relativeToSubject(note, subject) {
  return path.posix.relative(subject.relativePath, note.relativePath);
}

function folderLabel(relativePath) {
  const folder = path.posix.dirname(relativePath);
  return folder === '.' ? 'Radice' : folder.split('/').join(' / ');
}

function indexRowsForNotes(subject) {
  const groups = new Map();
  for (const note of subject.notes) {
    const label = folderLabel(relativeToSubject(note, subject));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(note);
  }
  const sections = [];
  for (const [label, notes] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'it'))) {
    const rows = notes
      .sort((a, b) => a.title.localeCompare(b.title, 'it'))
      .map((note) => {
        const display = note.title.replace(/\|/g, '—');
        const target = note.relativePath.replace(/\.md$/i, '').replace(/\|/g, '—');
        const summary = note.summary ? ` — ${note.summary}` : '';
        return `- [[${target}|${display}]]${summary}`;
      });
    sections.push(`### ${label}\n\n${rows.join('\n')}`);
  }
  return sections.join('\n\n');
}

export function buildIndexMarkdown(subject, analysis) {
  const generatedAt = new Date().toISOString();
  const tags = ['indice', `materia/${slugify(subject.name)}`, 'uniai'];
  return `---
title: "Indice — ${subject.name}"
subject: "${subject.name.replaceAll('"', '\\"')}"
type: "indice-materia"
generated_by: "UniAi"
generated_at: "${generatedAt}"
tags:
${tags.map((tag) => `  - "${tag}"`).join('\n')}
---

# ${subject.name} — Indice delle note

> [!info] Indice generato automaticamente
> ${subject.noteCount} note · ${subject.stats.links} wikilink · ${analysis.subjects.length} materie nel vault.
> Mappa visuale: [[${path.posix.join(subject.relativePath, GENERATED_CANVAS)}|Mappa concettuale Canvas]]
> Mappa Mermaid: [[${path.posix.join(subject.relativePath, GENERATED_MAP.replace(/\.md$/i, ''))}|Mappa concettuale Mermaid]]

## Note per cartella

${indexRowsForNotes(subject)}

## Convenzioni della materia

- Nome materia: **${subject.name}**
- Cartella: \`${subject.relativePath}\`
- Tag ricorrenti: ${subject.tags.length ? subject.tags.slice(0, 12).map((tag) => `#${tag}`).join(' · ') : 'nessuno'}
- Note con wikilink: ${subject.stats.linkedNotes}/${subject.noteCount}
- Sezioni/heading rilevati: ${subject.stats.headings}

> [!warning] File generato
> UniAi rigenera questo indice quando salva una nuova nota nella materia. Le modifiche manuali possono essere sovrascritte.
`;
}

function mermaidSafe(value) {
  return String(value || '')
    .replace(/["\r\n]/g, ' ')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

const CONCEPT_STOPWORDS = new Set([
  'della', 'delle', 'degli', 'dello', 'delli', 'delle', 'dalla', 'dalle', 'dagli', 'dallo',
  'nel', 'nella', 'nelle', 'negli', 'nello', 'sul', 'sulla', 'sulle', 'sugli', 'sullo',
  'con', 'come', 'per', 'tra', 'fra', 'una', 'uno', 'dei', 'delle', 'sono', 'essere',
  'questo', 'questa', 'questi', 'queste', 'quello', 'quella', 'quelli', 'quelle',
  'anche', 'solo', 'ogni', 'tutti', 'tutte', 'altro', 'altra', 'altri', 'altre',
  'quando', 'dove', 'perche', 'quindi', 'allora', 'dopo', 'prima', 'durante',
  'definizione', 'definizioni', 'esempio', 'esempi', 'formula', 'formule',
  'caratteristica', 'caratteristiche', 'introduzione', 'riassunto', 'nota', 'note',
  'parte', 'caso', 'casi', 'generale', 'principale', 'principali', 'metodo', 'metodi',
  'analisi', 'studio', 'considerazioni', 'osservazioni', 'premessa', 'conclusione',
  'conclusioni', 'esercizio', 'esercizi', 'soluzione', 'soluzioni', 'problema', 'problemi',
  'capitolo', 'sezione', 'significato', 'proprieta', 'proprietà', 'grandezza', 'grandezze'
]);

function stemConceptToken(raw) {
  let token = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (token.length < 4) return '';
  if (CONCEPT_STOPWORDS.has(token)) return '';
  if (token.length > 4) token = token.replace(/[aeiou]$/, '');
  return token;
}

function conceptTokens(text) {
  const words = String(text || '').match(/[A-Za-zÀ-ÿ]{4,}/g) || [];
  return words.map(stemConceptToken).filter(Boolean);
}

function cleanConceptLabel(value) {
  return String(value || '')
    .replace(/^\d{2,4}\s+/, '')
    .replace(/\.md$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:\s]+|[-–—:\s]+$/g, '')
    .trim();
}

function shortConceptLabel(value, maxLength = 72) {
  const label = cleanConceptLabel(value);
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength - 1).trim()}…`;
}

function buildConceptVectors(subject) {
  const noteDocs = subject.notes.map((note) => {
    const titleTokens = conceptTokens(cleanConceptLabel(note.basename));
    const headingTokens = conceptTokens(note.headings.join(' '));
    const bodyTokens = conceptTokens(note.bodyText || note.summary || '');
    const frequencies = new Map();
    const add = (token, weight) => frequencies.set(token, (frequencies.get(token) || 0) + weight);
    for (const token of titleTokens) add(token, 3);
    for (const token of headingTokens) add(token, 2);
    for (const token of bodyTokens) add(token, 1);
    return { note, frequencies };
  });

  const documentFrequency = new Map();
  for (const doc of noteDocs) {
    for (const token of doc.frequencies.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  const totalDocs = noteDocs.length;
  return noteDocs.map((doc) => {
    const vector = new Map();
    let normSquared = 0;
    for (const [token, frequency] of doc.frequencies) {
      const idf = Math.log((totalDocs + 1) / ((documentFrequency.get(token) || 0) + 1)) + 1;
      const weight = frequency * idf;
      if (weight <= 0) continue;
      vector.set(token, weight);
      normSquared += weight * weight;
    }
    return { note: doc.note, vector, norm: Math.sqrt(normSquared) || 1 };
  });
}

function cosineSimilarity(left, right) {
  let dot = 0;
  const [small, large] = left.vector.size <= right.vector.size
    ? [left.vector, right.vector]
    : [right.vector, left.vector];
  for (const [token, weight] of small) {
    const other = large.get(token);
    if (other) dot += weight * other;
  }
  return dot / (left.norm * right.norm);
}

function averageVector(vectors) {
  const average = new Map();
  for (const item of vectors) {
    for (const [token, weight] of item.vector) {
      average.set(token, (average.get(token) || 0) + weight / vectors.length);
    }
  }
  let normSquared = 0;
  for (const weight of average.values()) normSquared += weight * weight;
  return { vector: average, norm: Math.sqrt(normSquared) || 1 };
}

function clusterNotes(subject) {
  const docs = buildConceptVectors(subject).filter((doc) => doc.vector.size > 0);
  if (docs.length <= 2) return docs.length ? [docs] : [];
  const k = Math.max(3, Math.min(8, Math.round(Math.sqrt(docs.length) / 1.6)));
  const clusterCount = Math.min(k, docs.length);

  const centrality = docs.map((doc) => docs.reduce((total, other) => total + cosineSimilarity(doc, other), 0));
  const centroids = [];
  const firstIndex = centrality.indexOf(Math.max(...centrality));
  centroids.push(docs[firstIndex]);
  while (centroids.length < clusterCount) {
    let bestIndex = -1;
    let bestDistance = -1;
    docs.forEach((doc, index) => {
      if (centroids.includes(doc)) return;
      const maxSimilarity = Math.max(...centroids.map((centroid) => cosineSimilarity(doc, centroid)));
      const distance = 1 - maxSimilarity;
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    if (bestIndex === -1) break;
    centroids.push(docs[bestIndex]);
  }

  let assignments = new Array(docs.length).fill(-1);
  let currentCentroids = centroids.map((doc) => ({ vector: doc.vector, norm: doc.norm }));
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const nextAssignments = docs.map((doc) => {
      let bestCluster = 0;
      let bestScore = -1;
      currentCentroids.forEach((centroid, index) => {
        const score = cosineSimilarity(doc, centroid);
        if (score > bestScore) {
          bestScore = score;
          bestCluster = index;
        }
      });
      return bestCluster;
    });

    const groups = Array.from({ length: currentCentroids.length }, () => []);
    nextAssignments.forEach((clusterIndex, docIndex) => groups[clusterIndex].push(docs[docIndex]));
    const nextCentroids = groups.map((group, index) => group.length ? averageVector(group) : currentCentroids[index]);
    const changed = nextAssignments.some((value, index) => value !== assignments[index]);
    assignments = nextAssignments;
    currentCentroids = nextCentroids;
    if (!changed) break;
  }

  const groups = Array.from({ length: currentCentroids.length }, () => []);
  assignments.forEach((clusterIndex, docIndex) => groups[clusterIndex].push(docs[docIndex]));
  return groups.filter((group) => group.length > 0);
}

function titlePriority(label) {
  const clean = cleanConceptLabel(label);
  if (!clean) return -1000;
  let score = 0;
  if (clean.length >= 8 && clean.length <= 65) score += 10;
  if (/^soluzione esercizio/i.test(clean)) score -= 4;
  if (/(definizione|esempio|riassunto|formula|indice|guida|chiarimenti)/i.test(clean)) score -= 8;
  return score;
}

export function buildConceptClusters(subject) {
  const groups = clusterNotes(subject);
  const clusters = groups.map((group) => {
    const centrality = group.map((item) => group.reduce((total, other) => total + cosineSimilarity(item, other), 0));
    const sorted = group
      .map((item, index) => ({ ...item, centrality: centrality[index] }))
      .sort((a, b) => {
        const priority = titlePriority(b.note.basename) - titlePriority(a.note.basename);
        return priority || b.centrality - a.centrality || a.note.basename.localeCompare(b.note.basename, 'it');
      });
    const representative = sorted[0]?.note;
    if (!representative) return null;
    const members = sorted
      .filter((item) => item.note.relativePath !== representative.relativePath)
      .slice(0, 3)
      .map((item) => item.note);
    return {
      label: shortConceptLabel(representative.basename),
      representative,
      members,
      notes: [representative, ...members],
      size: group.length,
      centrality: sorted[0]?.centrality || 0
    };
  }).filter(Boolean);

  return clusters
    .sort((a, b) => b.size - a.size || b.centrality - a.centrality)
    .slice(0, 8);
}

export function buildConceptMapMarkdown(subject, analysis) {
  const clusters = buildConceptClusters(subject);
  const lines = [
    'flowchart TD',
    `  ROOT["${mermaidSafe(subject.name)}"]`
  ];
  clusters.forEach((cluster, index) => {
    const clusterId = `C${index}`;
    lines.push(`  ROOT --> ${clusterId}["${mermaidSafe(cluster.label)}"]`);
    cluster.members.forEach((note, memberIndex) => {
      lines.push(`  ${clusterId} --> N${index}_${memberIndex}["${mermaidSafe(shortConceptLabel(note.basename, 55))}"]`);
    });
  });

  const noteRows = clusters.flatMap((cluster) => cluster.notes.map((note) => {
    const target = note.relativePath.replace(/\.md$/i, '').replace(/\|/g, '—');
    return `- [[${target}|${note.basename.replace(/\|/g, '—')}]]`;
  }));

  return `---
title: "Mappa concettuale — ${subject.name}"
subject: "${subject.name.replaceAll('"', '\\"')}"
type: "mappa-concettuale"
generated_by: "UniAi"
generated_at: "${new Date().toISOString()}"
tags:
  - mappa-concettuale
  - "materia/${slugify(subject.name)}"
  - uniai
---

# ${subject.name} — Mappa concettuale semplificata

> [!info] Come è stata generata
> La mappa analizza titoli, heading e contenuti delle note, raggruppa i concetti per similarità semantica e mostra solo i principali nuclei della materia.
> Non rappresenta tutti i wikilink e non sostituisce l'indice completo.

\`\`\`mermaid
${lines.join('\n')}
\`\`\`

## Note di riferimento

${noteRows.join('\n')}

## Collegamenti

- Indice completo: [[${path.posix.join(subject.relativePath, GENERATED_INDEX.replace(/\.md$/i, ''))}|Indice delle note]]
- Canvas interattivo: [[${path.posix.join(subject.relativePath, GENERATED_CANVAS)}|Apri il Canvas]]
`;
}

export function buildCanvasJson(subject) {
  const clusters = buildConceptClusters(subject);
  const nodes = [];
  const edges = [];
  const rootId = 'concept-root';
  nodes.push({
    id: rootId,
    type: 'text',
    text: `# ${subject.name}\n\nMappa concettuale semplificata`,
    x: 0,
    y: 0,
    width: 300,
    height: 120,
    color: '6'
  });

  clusters.forEach((cluster, clusterIndex) => {
    const clusterId = `cluster-${clusterIndex}`;
    const clusterY = clusterIndex * 240;
    nodes.push({
      id: clusterId,
      type: 'text',
      text: `## ${cluster.label}`,
      x: 400,
      y: clusterY,
      width: 300,
      height: 100,
      color: '4'
    });
    edges.push({ id: `edge-root-${clusterIndex}`, fromNode: rootId, toNode: clusterId, toEnd: 'arrow' });

    cluster.notes.forEach((note, noteIndex) => {
      const noteId = `note-${crypto.createHash('sha1').update(note.relativePath).digest('hex').slice(0, 12)}`;
      nodes.push({
        id: noteId,
        type: 'file',
        file: note.relativePath,
        x: 820,
        y: clusterY + (noteIndex - (cluster.notes.length - 1) / 2) * 125,
        width: 280,
        height: 90,
        color: noteIndex === 0 ? '2' : '1'
      });
      edges.push({
        id: `edge-${clusterIndex}-${noteIndex}`,
        fromNode: clusterId,
        toNode: noteId,
        toEnd: 'arrow'
      });
    });
  });

  return JSON.stringify({ nodes, edges }, null, 2);
}

export function rebuildSubjectArtifacts({ vaultPath, subject, analysis }) {
  const subjectDir = path.resolve(vaultPath, subject.relativePath);
  const indexPath = path.join(subjectDir, GENERATED_INDEX);
  const mapPath = path.join(subjectDir, GENERATED_MAP);
  const canvasPath = path.join(subjectDir, GENERATED_CANVAS);
  atomicWrite(indexPath, buildIndexMarkdown(subject, analysis));
  atomicWrite(mapPath, buildConceptMapMarkdown(subject, analysis));
  atomicWrite(canvasPath, buildCanvasJson(subject));
  return {
    subject: subject.name,
    directory: subject.relativePath,
    files: [indexPath, mapPath, canvasPath]
  };
}

export function rebuildAllVaultArtifacts(vaultPath, options = {}) {
  const analysis = analyzeVaultStructure(vaultPath, options);
  const results = analysis.subjects.map((subject) => rebuildSubjectArtifacts({ vaultPath, subject, analysis }));
  return { analysis, results };
}

export function rebuildArtifactsForFile(vaultPath, absoluteFilePath, options = {}) {
  const relativePath = path.relative(vaultPath, absoluteFilePath).split(path.sep).join('/');
  const analysis = analyzeVaultStructure(vaultPath, options);
  const subject = analysis.subjects.find((item) => relativePath.startsWith(`${item.relativePath}/`));
  if (!subject) return null;
  return rebuildSubjectArtifacts({ vaultPath, subject, analysis });
}
