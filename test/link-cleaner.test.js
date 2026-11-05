import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanBrokenWikilinks, scanBrokenWikilinks } from '../src/link-cleaner.js';

test('cleanBrokenWikilinks rimuove i link a note cancellate ma conserva quelli validi', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-links-'));
  try {
    mkdirSync(path.join(root, 'Corso'), { recursive: true });
    writeFileSync(path.join(root, 'Corso', 'Esistente.md'), '# Esistente\n');
    const source = path.join(root, 'Corso', 'Sorgente.md');
    writeFileSync(source, '# Sorgente\n\nVedi [[Esistente]] e [[Cancellata|testo alternativo]].\n\n![[immagine.png]]\n');

    const before = scanBrokenWikilinks({ vaultPath: root });
    assert.equal(before.broken.length, 1);
    assert.equal(before.broken[0].target, 'Cancellata');

    const result = cleanBrokenWikilinks({ vaultPath: root, dryRun: false });
    assert.equal(result.changedFiles, 1);
    assert.equal(result.removedLinks, 1);
    const cleaned = readFileSync(source, 'utf8');
    assert.match(cleaned, /\[\[Esistente\]\]/);
    assert.doesNotMatch(cleaned, /\[\[Cancellata/);
    assert.match(cleaned, /testo alternativo/);
    assert.match(cleaned, /!\[\[immagine\.png\]\]/);
    assert.equal(scanBrokenWikilinks({ vaultPath: root }).broken.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
