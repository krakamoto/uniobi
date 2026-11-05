import path from 'node:path';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { findVaultNote, scanVault } from './vault.js';

const ATTACHMENT_EXTENSION = /\.(png|jpe?g|webp|gif|svg|pdf|mp3|mp4|wav|ogg|m4a)$/i;

function isAttachmentTarget(vaultPath, target) {
  if (!ATTACHMENT_EXTENSION.test(target)) return false;
  const absolute = path.resolve(vaultPath, target);
  return existsSync(absolute);
}

function linkReplacement(target, label) {
  const visible = String(label || target || '').trim();
  return visible || target;
}

export function scanBrokenWikilinks({ vaultPath }) {
  const notes = scanVault(vaultPath, '');
  const broken = [];
  for (const note of notes) {
    const absolute = path.join(vaultPath, note.relativePath);
    const markdown = readFileSync(absolute, 'utf8');
    const regex = /(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
    for (const match of markdown.matchAll(regex)) {
      const target = String(match[1] || '').trim();
      if (!target) continue;
      if (isAttachmentTarget(vaultPath, target)) continue;
      if (findVaultNote(target, notes)) continue;
      broken.push({
        source: note.relativePath,
        target,
        label: match[2] ? String(match[2]).trim() : '',
        full: match[0]
      });
    }
  }
  return { notes, broken };
}

export function cleanBrokenWikilinks({ vaultPath, dryRun = true }) {
  const notes = scanVault(vaultPath, '');
  const changes = [];
  for (const note of notes) {
    const absolute = path.join(vaultPath, note.relativePath);
    const original = readFileSync(absolute, 'utf8');
    let removed = 0;
    const cleaned = original.replace(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (full, rawTarget, rawLabel) => {
      const target = String(rawTarget || '').trim();
      if (!target) return full;
      if (isAttachmentTarget(vaultPath, target) || findVaultNote(target, notes)) return full;
      removed += 1;
      return linkReplacement(target, rawLabel);
    });
    if (removed > 0) {
      changes.push({ relativePath: note.relativePath, removed, markdown: cleaned });
    }
  }

  if (!dryRun) {
    for (const change of changes) {
      const absolute = path.join(vaultPath, change.relativePath);
      const temporary = `${absolute}.uniai-tmp`;
      writeFileSync(temporary, change.markdown, 'utf8');
      renameSync(temporary, absolute);
    }
  }

  return {
    changedFiles: changes.length,
    removedLinks: changes.reduce((sum, change) => sum + change.removed, 0),
    changes: changes.map((change) => ({ relativePath: change.relativePath, removed: change.removed }))
  };
}
