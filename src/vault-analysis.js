import path from 'node:path';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync
} from 'node:fs';
import { normalizeTitle, sanitizeFilename, slugify, uniqueStrings } from './utils.js';
import { validateLatexDelimiters } from './markdown.js';

export const GENERATED_INDEX = '_Indice.md';
const GENERATED_FILES = new Set([GENERATED_INDEX]);
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
    size: stat.size,
    mtime: stat.mtime.toISOString()
  };
}


function canonicalNotes(notes) {
  const numberedKeys = new Set();
  for (const note of notes) {
    if (!/^\d{2,5}\s+/.test(note.basename)) continue;
    const key = `${note.folder}|${note.basename.replace(/^\d{2,5}\s+/, '').toLocaleLowerCase('it')}`;
    numberedKeys.add(key);
  }
  return notes.filter((note) => {
    if (/^\d{2,5}\s+/.test(note.basename)) return true;
    const key = `${note.folder}|${note.basename.toLocaleLowerCase('it')}`;
    return !numberedKeys.has(key);
  });
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
  const notes = canonicalNotes(files.map((file) => noteMetadata(file, vaultPath)));
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

function indexRowsForNotes(subject, analysis) {
  const groups = new Map();
  const basenameCounts = new Map();
  for (const item of analysis.subjects) {
    for (const note of item.notes) {
      const key = note.basename.toLocaleLowerCase('it');
      basenameCounts.set(key, (basenameCounts.get(key) || 0) + 1);
    }
  }
  for (const note of subject.notes) {
    const label = folderLabel(relativeToSubject(note, subject));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(note);
  }
  const sections = [];
  for (const [label, notes] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'it'))) {
    const rows = notes
      .sort((a, b) => a.basename.localeCompare(b.basename, 'it', { numeric: true }))
      .map((note) => {
        const display = note.title.replace(/\|/g, '—');
        const basenameKey = note.basename.toLocaleLowerCase('it');
        const target = basenameCounts.get(basenameKey) === 1
          ? note.basename.replace(/\|/g, '—')
          : note.relativePath.replace(/\.md$/i, '').replace(/\|/g, '—');
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

## Note per cartella

${indexRowsForNotes(subject, analysis)}

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

export function rebuildSubjectArtifacts({ vaultPath, subject, analysis }) {
  const subjectDir = path.resolve(vaultPath, subject.relativePath);
  const indexPath = path.join(subjectDir, GENERATED_INDEX);
  atomicWrite(indexPath, buildIndexMarkdown(subject, analysis));
  return {
    subject: subject.name,
    directory: subject.relativePath,
    files: [indexPath]
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
