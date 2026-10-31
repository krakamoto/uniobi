import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  analyzeVaultStructure,
  buildAiVaultContext,
  matchSubject,
  rebuildAllVaultArtifacts,
  rebuildArtifactsForFile
} from '../src/vault-analysis.js';
import { saveNoteToVault } from '../src/vault.js';
import { validateLatexDelimiters } from '../src/markdown.js';

test('analisi del vault: riconosce materie, indici e mappe concettuali', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-vault-analysis-'));
  const subjectDir = path.join(root, 'uni', 'Uni', 'triennale', 'analisi matematica');
  mkdirSync(subjectDir, { recursive: true });
  writeFileSync(path.join(subjectDir, '00 limiti.md'), '# Limiti\n\n## Definizione\n\nVedi [[01 derivate]].\n');
  writeFileSync(path.join(subjectDir, '01 derivate.md'), '# Derivate\n\n## Regole\n\nDerivate fondamentali.\n');

  try {
    const analysis = analyzeVaultStructure(root, { subjectRoots: ['uni/Uni/triennale'] });
    assert.equal(analysis.subjects.length, 1);
    assert.equal(analysis.subjects[0].name, 'analisi matematica');
    assert.equal(analysis.subjects[0].noteCount, 2);
    assert.equal(matchSubject('Analisi Matematica II', analysis.subjects)?.name, 'analisi matematica');

    const context = buildAiVaultContext(analysis, analysis.subjects[0], 'Analisi Matematica II');
    assert.match(context, /analisi matematica/);
    assert.match(context, /00 limiti/);

    const rebuilt = rebuildAllVaultArtifacts(root, { subjectRoots: ['uni/Uni/triennale'] });
    assert.equal(rebuilt.results.length, 1);
    const index = readFileSync(path.join(subjectDir, '_Indice.md'), 'utf8');
    assert.match(index, /\[\[uni\/Uni\/triennale\/analisi matematica\/00 limiti\|Limiti\]\]/);
    assert.match(index, /_Mappa concettuale\.canvas/);

    const map = readFileSync(path.join(subjectDir, '_Mappa concettuale.md'), 'utf8');
    assert.match(map, /```mermaid/);
    assert.match(map, /N0/);

    const canvas = JSON.parse(readFileSync(path.join(subjectDir, '_Mappa concettuale.canvas'), 'utf8'));
    assert.equal(canvas.nodes.length, 2);
    assert.equal(canvas.edges.length, 1);

    writeFileSync(path.join(subjectDir, '02 integrali.md'), '# Integrali\n\n## Definizione\n\nArea sotto una curva.\n');
    const updated = rebuildArtifactsForFile(root, path.join(subjectDir, '02 integrali.md'), {
      subjectRoots: ['uni/Uni/triennale']
    });
    assert.equal(updated.subject, 'analisi matematica');
    const updatedIndex = readFileSync(path.join(subjectDir, '_Indice.md'), 'utf8');
    assert.match(updatedIndex, /02 integrali/);
    assert.match(updatedIndex, /3 note/);

    const saved = saveNoteToVault({
      vaultPath: root,
      notesSubdir: 'Università/Lezioni',
      relativeDir: 'uni/Uni/triennale/analisi matematica',
      title: 'Serie numeriche',
      date: '2025-10-31',
      markdown: '# Serie numeriche\n\n## Convergenza\n',
      subjectRoots: ['uni/Uni/triennale']
    });
    assert.match(saved.relativePath, /analisi matematica/);
    assert.ok(readFileSync(path.join(subjectDir, '_Indice.md'), 'utf8').includes('Serie numeriche'));
    assert.ok(readFileSync(path.join(subjectDir, '_Mappa concettuale.canvas'), 'utf8').includes('Serie numeriche'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('gli indici generati non spezzano le formule LaTeX', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-vault-latex-'));
  const subjectDir = path.join(root, 'uni', 'Uni', 'triennale', 'fisica');
  mkdirSync(subjectDir, { recursive: true });
  const longIntro = 'Introduzione molto lunga alla lezione. '.repeat(10);
  writeFileSync(
    path.join(subjectDir, '00 formula.md'),
    `# Formula\n\n${longIntro}\n\n$$\n\\frac{a}{b} = c\n$$\n`
  );
  try {
    rebuildAllVaultArtifacts(root, { subjectRoots: ['uni/Uni/triennale'] });
    const index = readFileSync(path.join(subjectDir, '_Indice.md'), 'utf8');
    assert.equal(validateLatexDelimiters(index).valid, true);
    assert.match(index, /\$\$|…/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
