import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyVaultRenumber, planVaultRenumber } from '../src/vault-renumber.js';

test('rinumera le note senza buchi e aggiorna i wikilink', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-renumber-'));
  try {
    const dir = path.join(root, 'Materia');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(root, 'image.png'), 'x');
    writeFileSync(path.join(dir, '001 Prima.md'), '# Prima\n');
    writeFileSync(path.join(dir, '005 Quinta.md'), '# Quinta\n');
    writeFileSync(path.join(dir, '009 Nona.md'), '# Nona\n');
    writeFileSync(path.join(dir, '_Indice.md'), '[[005 Quinta|Quinta]]\n[[009 Nona]]\n![[image.png]]\n');

    const plan = planVaultRenumber({ vaultPath: root, onlyGenerated: false });
    assert.equal(plan.directories.length, 1);
    applyVaultRenumber({ vaultPath: root, plan });

    assert.ok(existsSync(path.join(dir, '001 Prima.md')));
    assert.ok(existsSync(path.join(dir, '002 Quinta.md')));
    assert.ok(existsSync(path.join(dir, '003 Nona.md')));
    assert.equal(existsSync(path.join(dir, '005 Quinta.md')), false);
    const index = readFileSync(path.join(dir, '_Indice.md'), 'utf8');
    assert.match(index, /\[\[002 Quinta\|Quinta\]\]/);
    assert.match(index, /\[\[003 Nona\]\]/);
    assert.match(index, /!\[\[image\.png\]\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
