import path from 'node:path';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const NUMBERED_NOTE = /^(\d{3,5})\s+(.+)\.md$/i;
const TEMP_MARKER = '.uniai-renumber-tmp-';

function isUniAiGenerated(absolutePath) {
  try {
    return /^source:\s*["']?UniAi["']?\s*$/mi.test(readFileSync(absolutePath, 'utf8').slice(0, 3000));
  } catch {
    return false;
  }
}

function walkMarkdownDirectories(root, callback, onlyGenerated) {
  if (!existsSync(root)) return;
  const entries = readdirSync(root, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'));
  const numbered = files
    .map((entry) => {
      const match = entry.name.match(NUMBERED_NOTE);
      return match ? { name: entry.name, number: Number(match[1]), title: match[2] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, 'it'));
  const eligible = onlyGenerated
    ? numbered.filter((file) => isUniAiGenerated(path.join(root, file.name)))
    : numbered;
  if (eligible.length > 0) callback(root, eligible);
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) walkMarkdownDirectories(path.join(root, entry.name), callback, onlyGenerated);
  }
}

function linkTargetUpdate(rawTarget, mapping) {
  const target = String(rawTarget || '').trim();
  if (!target) return null;
  const candidates = [target];
  if (target.startsWith('./')) candidates.push(target.slice(2));
  for (const candidate of candidates) {
    if (mapping.has(candidate)) return mapping.get(candidate);
  }
  return null;
}

function updateLinksInMarkdown(markdown, mapping) {
  let changes = 0;
  const updated = markdown.replace(/(?<!!)\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g, (full, rawTarget, heading, label) => {
    const replacement = linkTargetUpdate(rawTarget, mapping);
    if (!replacement) return full;
    changes += 1;
    return `[[${replacement}${heading || ''}${label || ''}]]`;
  });
  return { markdown: updated, changes };
}

export function planVaultRenumber({ vaultPath, onlyGenerated = false }) {
  const directories = [];
  walkMarkdownDirectories(vaultPath, (directory, files) => {
    const changes = files.map((file, index) => {
      const newName = `${String(index + 1).padStart(3, '0')} ${file.title}.md`;
      return { oldName: file.name, newName, oldNumber: file.number, newNumber: index + 1 };
    }).filter((change) => change.oldName !== change.newName);
    if (changes.length > 0) directories.push({ directory, changes });
  }, onlyGenerated);
  return { directories, onlyGenerated };
}

export function applyVaultRenumber({ vaultPath, plan }) {
  const mapping = new Map();
  const renamed = [];
  for (const item of plan.directories) {
    for (const change of item.changes) {
      const oldAbsolute = path.join(item.directory, change.oldName);
      const oldBase = change.oldName.replace(/\.md$/i, '');
      const newBase = change.newName.replace(/\.md$/i, '');
      const oldRelative = path.relative(vaultPath, oldAbsolute).split(path.sep).join('/').replace(/\.md$/i, '');
      const newRelative = path.relative(vaultPath, path.join(item.directory, change.newName)).split(path.sep).join('/').replace(/\.md$/i, '');
      mapping.set(oldBase, newBase);
      mapping.set(oldRelative, newRelative);
      renamed.push({ oldAbsolute, newAbsolute: path.join(item.directory, change.newName), oldName: change.oldName, newName: change.newName, directory: item.directory });
    }
  }

  // Rinomina in due fasi per evitare collisioni tra numeri vecchi e nuovi.
  const temps = [];
  for (let index = 0; index < renamed.length; index += 1) {
    const item = renamed[index];
    const temporary = path.join(item.directory, `${TEMP_MARKER}${index}.md`);
    renameSync(item.oldAbsolute, temporary);
    temps.push({ ...item, temporary });
  }
  for (const item of temps) renameSync(item.temporary, item.newAbsolute);

  const updatedNotes = [];
  const seen = new Set();
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        if (seen.has(absolute)) continue;
        seen.add(absolute);
        const original = readFileSync(absolute, 'utf8');
        const result = updateLinksInMarkdown(original, mapping);
        if (result.changes > 0) {
          const temporary = `${absolute}.uniai-links-tmp`;
          writeFileSync(temporary, result.markdown, 'utf8');
          renameSync(temporary, absolute);
          updatedNotes.push({ relativePath: path.relative(vaultPath, absolute).split(path.sep).join('/'), changes: result.changes });
        }
      }
    }
  }
  walk(vaultPath);
  return { renamed, updatedNotes };
}

export function vaultRenumberSummary(plan) {
  return {
    directories: plan.directories.length,
    renames: plan.directories.reduce((total, item) => total + item.changes.length, 0),
    details: plan.directories.map((item) => ({
      directory: item.directory,
      changes: item.changes
    }))
  };
}
