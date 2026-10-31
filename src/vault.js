import {
  readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, renameSync, existsSync, unlinkSync
} from 'node:fs';
import path from 'node:path';
import { isPathInside, normalizeTitle, sanitizeFilename, sha256, uniqueStrings } from './utils.js';
import { rebuildArtifactsForFile } from './vault-analysis.js';

const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

function parseFrontmatter(filePath) {
  let content = '';
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return { aliases: [], tags: [] };
  }
  if (!content.startsWith('---')) return { aliases: [], tags: [], content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { aliases: [], tags: [], content };
  const yaml = content.slice(3, end);
  const aliases = [];
  const tags = [];
  let mode = '';
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^aliases\s*:/i.test(line)) {
      mode = 'aliases';
      const inline = line.replace(/^aliases\s*:/i, '').trim();
      if (inline.startsWith('[')) {
        for (const item of inline.replace(/^\[|\]$/g, '').split(',')) {
          const value = item.trim().replace(/^['"]|['"]$/g, '');
          if (value) aliases.push(value);
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
          if (value) tags.push(value);
        }
        mode = '';
      }
      continue;
    }
    if (/^\S/.test(rawLine) && line !== '') mode = '';
    if (mode && /^-\s+/.test(line)) {
      const value = line.replace(/^-\s+/, '').replace(/^['"]|['"]$/g, '').replace(/^#/, '');
      if (value && mode === 'aliases') aliases.push(value);
      if (value && mode === 'tags') tags.push(value);
    }
  }
  return { aliases, tags, content };
}

export function scanVault(vaultPath, notesSubdir = '') {
  const notes = [];
  if (!existsSync(vaultPath)) return notes;
  const skipRoot = notesSubdir ? path.resolve(vaultPath, notesSubdir) : '';

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        if (skipRoot && isPathInside(skipRoot, absolute)) continue;
        const title = entry.name.replace(/\.md$/i, '');
        const meta = parseFrontmatter(absolute);
        notes.push({
          title,
          basename: title,
          relativePath: path.relative(vaultPath, absolute).split(path.sep).join('/'),
          aliases: uniqueStrings(meta.aliases),
          tags: uniqueStrings(meta.tags)
        });
      }
    }
  }

  walk(vaultPath);
  return notes;
}

export function findVaultNote(target, notes) {
  const cleanTarget = String(target || '').trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
  if (!cleanTarget) return null;
  const normalized = normalizeTitle(cleanTarget);
  for (const note of notes) {
    if (normalizeTitle(note.title) === normalized) return note;
    if (note.aliases.some((alias) => normalizeTitle(alias) === normalized)) return note;
    if (normalizeTitle(note.relativePath.replace(/\.md$/i, '')) === normalized) return note;
  }
  return null;
}

function extractWikiTargets(markdown) {
  const targets = [];
  for (const match of String(markdown || '').matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    targets.push(match[1].trim());
  }
  return targets;
}

export function selectWikilinks({ aiLinks = [], markdown = '', course = '', title = '', notes = [], allowCreate = false }) {
  const selected = [];
  const seen = new Set();
  const currentTitle = normalizeTitle(title);

  function add(target, reason, source = 'ai') {
    const clean = String(target || '').replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
    if (!clean) return;
    const key = normalizeTitle(clean);
    if (!key || key === currentTitle || seen.has(key)) return;
    const note = findVaultNote(clean, notes);
    if (!note && !allowCreate) return;
    seen.add(key);
    selected.push({
      target: note ? note.title : clean,
      reason: String(reason || (note ? 'Nota correlata presente nel vault' : 'Nota da creare')),
      exists: Boolean(note),
      relativePath: note ? note.relativePath : null,
      source
    });
  }

  for (const link of aiLinks) {
    if (typeof link === 'string') add(link, 'Segnalato dall’AI');
    else if (link && typeof link === 'object') add(link.target, link.reason, 'ai');
  }

  for (const target of extractWikiTargets(markdown)) add(target, 'Wikilink presente negli appunti', 'markdown');

  if (course) add(course, 'Corso della lezione', 'course');

  const normalizedMarkdown = ` ${normalizeTitle(markdown)} `;
  for (const note of notes) {
    const normalized = normalizeTitle(note.title);
    if (normalized.length < 4) continue;
    const mentioned = normalizedMarkdown.includes(` ${normalized} `);
    if (mentioned) add(note.title, 'Concetto citato negli appunti', 'auto');
  }

  return selected.slice(0, 12);
}

function nextNoteNumber(directory) {
  let maximum = 0;
  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const match = entry.name.match(/^(\d{2,5})(?:\s|[-_.])/);
        if (match) maximum = Math.max(maximum, Number(match[1]));
      }
    }
  }
  walk(directory);
  return String(maximum + 1).padStart(3, '0');
}

export function safeVaultDestination({ vaultPath, notesSubdir, relativeDir, title, date }) {
  if (!vaultPath) throw new Error('OBSIDIAN_VAULT_PATH non configurato.');
  const targetRelative = relativeDir || notesSubdir || '';
  const targetDir = path.resolve(vaultPath, targetRelative);
  if (!isPathInside(path.resolve(vaultPath), targetDir) && targetDir !== path.resolve(vaultPath)) {
    throw new Error('La cartella di destinazione Obsidian non è valida.');
  }
  mkdirSync(targetDir, { recursive: true });
  const cleanTitle = String(title || 'Appunti').replace(/^\d{2,5}[\s-]+/, '');
  const filenameTitle = sanitizeFilename(cleanTitle, 'Appunti');
  let number = Number(nextNoteNumber(targetDir));
  let candidate;
  do {
    const prefix = String(number).padStart(3, '0');
    candidate = path.join(targetDir, `${prefix} ${filenameTitle}.md`);
    number += 1;
  } while (existsSync(candidate));
  return candidate;
}

function writeSingleNote({ vaultPath, notesSubdir, relativeDir, title, date, markdown, jobId, store, idGenerator }) {
  const destination = safeVaultDestination({ vaultPath, notesSubdir, relativeDir, title, date });
  const temp = `${destination}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, markdown, 'utf8');
  renameSync(temp, destination);
  const relativePath = path.relative(vaultPath, destination).split(path.sep).join('/');

  if (store && idGenerator) {
    store.insertVaultFile({
      id: idGenerator(),
      jobId,
      relativePath,
      absolutePath: destination,
      contentHash: sha256(markdown)
    });
  }

  return { title, absolutePath: destination, relativePath };
}

function rebuildAfterSave(vaultPath, saved, subjectRoots) {
  const last = saved[saved.length - 1];
  if (!last) return;
  try {
    const artifacts = rebuildArtifactsForFile(vaultPath, last.absolutePath, { subjectRoots });
    if (artifacts) console.log(`[vault] Indice aggiornato per ${artifacts.subject}`);
  } catch (error) {
    console.error(`[vault] Impossibile aggiornare l'indice: ${error.message}`);
  }
}

export function saveNotesToVault({ vaultPath, notesSubdir, relativeDir, notes, jobId, store, idGenerator, subjectRoots = [] }) {
  const saved = (notes || []).map((note) => writeSingleNote({
    vaultPath,
    notesSubdir,
    relativeDir,
    title: note.title,
    date: note.date,
    markdown: note.markdown,
    jobId,
    store,
    idGenerator
  }));
  rebuildAfterSave(vaultPath, saved, subjectRoots);
  return saved;
}

export function saveNoteToVault({ vaultPath, notesSubdir, relativeDir, title, date, markdown, jobId, store, idGenerator, subjectRoots = [] }) {
  const saved = saveNotesToVault({
    vaultPath,
    notesSubdir,
    relativeDir,
    notes: [{ title, date, markdown }],
    jobId,
    store,
    idGenerator,
    subjectRoots
  });
  return saved[0];
}

export function vaultIsWritable(vaultPath, notesSubdir) {
  try {
    const target = path.resolve(vaultPath, notesSubdir || '');
    mkdirSync(target, { recursive: true });
    const test = path.join(target, `.uniai-write-test-${process.pid}`);
    writeFileSync(test, 'test', 'utf8');
    statSync(test);
    unlinkSync(test);
    return true;
  } catch {
    return false;
  }
}
