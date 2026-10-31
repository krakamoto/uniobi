import path from 'node:path';
import crypto from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync
} from 'node:fs';
import { normalizeTitle, slugify, uniqueStrings } from './utils.js';

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

function plainSummary(content) {
  let text = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/!\[\[[^\]]+\]\]/g, ' ');
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/[*_`>$]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, 220);
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
        const summary = note.summary ? ` — ${note.summary.slice(0, 140)}` : '';
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

function noteLookup(subject) {
  const byName = new Map();
  for (const note of subject.notes) {
    byName.set(normalizeTitle(note.basename), note);
    byName.set(normalizeTitle(note.title), note);
  }
  return byName;
}

function subjectEdges(subject) {
  const lookup = noteLookup(subject);
  const edgeKeys = new Set();
  const edges = [];
  for (const note of subject.notes) {
    for (const target of note.links) {
      const clean = target.split('/').pop();
      const destination = lookup.get(normalizeTitle(clean));
      if (!destination || destination.relativePath === note.relativePath) continue;
      const key = `${note.relativePath}->${destination.relativePath}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from: note, to: destination });
    }
  }
  return edges;
}

export function buildConceptMapMarkdown(subject, analysis) {
  const edges = subjectEdges(subject);
  const selected = [];
  const selectedSet = new Set();
  for (const edge of edges) {
    for (const note of [edge.from, edge.to]) {
      if (selected.length < 80 && !selectedSet.has(note.relativePath)) {
        selectedSet.add(note.relativePath);
        selected.push(note);
      }
    }
    if (selected.length >= 80) break;
  }
  if (selected.length < 12) {
    for (const note of subject.notes) {
      if (selected.length >= Math.min(24, subject.notes.length)) break;
      if (!selectedSet.has(note.relativePath)) {
        selectedSet.add(note.relativePath);
        selected.push(note);
      }
    }
  }

  const idByPath = new Map();
  selected.forEach((note, index) => idByPath.set(note.relativePath, `N${index}`));
  const lines = [
    'flowchart TD',
    `  SUBJECT["${mermaidSafe(subject.name)}"]`
  ];
  const folderGroups = new Map();
  for (const note of selected) {
    const label = folderLabel(relativeToSubject(note, subject));
    if (!folderGroups.has(label)) folderGroups.set(label, []);
    folderGroups.get(label).push(note);
  }
  let groupIndex = 0;
  for (const [label, notes] of [...folderGroups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'it'))) {
    lines.push(`  subgraph G${groupIndex}["${mermaidSafe(label)}"]`);
    for (const note of notes) {
      lines.push(`    ${idByPath.get(note.relativePath)}["${mermaidSafe(note.title)}"]`);
    }
    lines.push('  end');
    groupIndex += 1;
  }

  const connected = new Set();
  for (const edge of edges) {
    const from = idByPath.get(edge.from.relativePath);
    const to = idByPath.get(edge.to.relativePath);
    if (from && to) {
      lines.push(`  ${from} --> ${to}`);
      connected.add(from);
      connected.add(to);
    }
  }
  for (const note of selected) {
    const id = idByPath.get(note.relativePath);
    if (!connected.has(id)) lines.push(`  SUBJECT --> ${id}`);
  }
  if (edges.length === 0) {
    lines.push('  %% Nessun wikilink tra note: mappa gerarchica per cartella.');
  }

  const displayedNotes = selected.length < subject.noteCount
    ? `La mappa Mermaid mostra ${selected.length} note collegate su ${subject.noteCount}; il Canvas contiene tutte le note.`
    : `La mappa contiene tutte le ${subject.noteCount} note.`;

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

# ${subject.name} — Mappa concettuale

> [!info] Mappa generata automaticamente
> ${displayedNotes}
> Indice completo: [[${path.posix.join(subject.relativePath, GENERATED_INDEX.replace(/\.md$/i, ''))}|Indice delle note]]
> Canvas interattivo: [[${path.posix.join(subject.relativePath, GENERATED_CANVAS)}|Apri il Canvas]]

\`\`\`mermaid
${lines.join('\n')}
\`\`\`

## Come leggere la mappa

- Ogni nodo rappresenta una nota.
- Le frecce rappresentano collegamenti wikilink tra note.
- I nodi senza collegamenti sono raggruppati sotto la materia o la cartella.
- Per esplorare tutte le note e le relazioni usa il Canvas generato.
`;
}

export function buildCanvasJson(subject) {
  const edges = subjectEdges(subject);
  const notes = [...subject.notes].sort((a, b) => {
    const fa = folderLabel(relativeToSubject(a, subject));
    const fb = folderLabel(relativeToSubject(b, subject));
    return fa.localeCompare(fb, 'it') || a.title.localeCompare(b.title, 'it');
  });
  const nodeIdByPath = new Map();
  const nodes = [];
  const colors = ['1', '2', '3', '4', '5', '6'];
  const folderColor = new Map();

  const columns = Math.max(3, Math.min(8, Math.ceil(Math.sqrt(notes.length))));
  const spacingX = 340;
  const spacingY = 160;
  notes.forEach((note, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const folder = folderLabel(relativeToSubject(note, subject));
    if (!folderColor.has(folder)) folderColor.set(folder, colors[folderColor.size % colors.length]);
    const id = `note-${crypto.createHash('sha1').update(note.relativePath).digest('hex').slice(0, 12)}`;
    nodeIdByPath.set(note.relativePath, id);
    nodes.push({
      id,
      type: 'file',
      file: note.relativePath,
      x: col * spacingX,
      y: row * spacingY,
      width: 280,
      height: 100,
      color: folderColor.get(folder)
    });
  });

  const canvasEdges = [];
  for (const edge of edges) {
    const fromNode = nodeIdByPath.get(edge.from.relativePath);
    const toNode = nodeIdByPath.get(edge.to.relativePath);
    if (!fromNode || !toNode) continue;
    canvasEdges.push({
      id: `edge-${crypto.createHash('sha1').update(`${fromNode}->${toNode}`).digest('hex').slice(0, 12)}`,
      fromNode,
      toNode,
      toEnd: 'arrow'
    });
  }

  return JSON.stringify({ nodes, edges: canvasEdges }, null, 2);
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
