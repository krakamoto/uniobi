import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  analyzeVaultStructure,
  buildAiVaultContext,
  matchSubject,
  rebuildAllVaultArtifacts,
  rebuildArtifactsForFile
} from '../src/vault-analysis.js';
import { findVaultNote, safeVaultDestination, saveNoteToVault, saveNotesToVault, scanVault } from '../src/vault.js';
import { validateLatexDelimiters } from '../src/markdown.js';

test('analisi del vault: riconosce materie e genera gli indici', () => {
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
    assert.equal(existsSync(path.join(subjectDir, '_Mappa concettuale.md')), false);
    assert.equal(existsSync(path.join(subjectDir, '_Mappa concettuale.canvas')), false);

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
    assert.equal(existsSync(path.join(subjectDir, '_Mappa concettuale.canvas')), false);
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


test('le note usano numerazione progressiva 001, 002 senza data', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-numbering-'));
  const subjectDir = path.join(root, 'uni', 'Uni', 'magistrale', 'nuova materia');
  mkdirSync(subjectDir, { recursive: true });
  try {
    const first = safeVaultDestination({
      vaultPath: root,
      relativeDir: 'uni/Uni/magistrale/nuova materia',
      title: 'Prima nota',
      date: '2025-10-31'
    });
    assert.match(path.basename(first), /^001 Prima nota\.md$/);
    writeFileSync(first, '# Prima nota\n');

    const second = safeVaultDestination({
      vaultPath: root,
      relativeDir: 'uni/Uni/magistrale/nuova materia',
      title: 'Seconda nota',
      date: '2025-11-01'
    });
    assert.match(path.basename(second), /^002 Seconda nota\.md$/);
    assert.ok(!path.basename(second).includes('2025-11-01'));
    writeFileSync(second, '# Seconda nota\n');

    const index = rebuildAllVaultArtifacts(root, { subjectRoots: ['uni/Uni/magistrale'] });
    assert.equal(index.analysis.subjects.length, 1);
    const text = readFileSync(path.join(subjectDir, '_Indice.md'), 'utf8');
    assert.match(text, /001 Prima nota/);
    assert.match(text, /002 Seconda nota/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('un job può salvare più note numerate e aggiornare un solo indice', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-multi-save-'));
  const subjectDir = path.join(root, 'uni', 'Uni', 'magistrale', 'controlli');
  mkdirSync(subjectDir, { recursive: true });
  try {
    const saved = saveNotesToVault({
      vaultPath: root,
      notesSubdir: 'Università/Lezioni',
      relativeDir: 'uni/Uni/magistrale/controlli',
      notes: [
        { title: 'Funzione di trasferimento', date: '2025-10-31', markdown: '# Funzione di trasferimento\n\nVedi [[Risposta in frequenza]].\n' },
        { title: 'Risposta in frequenza', date: '2025-10-31', markdown: '# Risposta in frequenza\n' }
      ],
      subjectRoots: ['uni/Uni/magistrale']
    });
    assert.equal(saved.length, 2);
    const firstNote = readFileSync(saved[0].absolutePath, 'utf8');
    assert.match(firstNote, /\[\[002 Risposta in frequenza\]\]/);
    assert.match(path.basename(saved[0].relativePath), /^001 Funzione di trasferimento\.md$/);
    assert.match(path.basename(saved[1].relativePath), /^002 Risposta in frequenza\.md$/);
    const index = readFileSync(path.join(subjectDir, '_Indice.md'), 'utf8');
    assert.match(index, /001 Funzione di trasferimento/);
    assert.match(index, /002 Risposta in frequenza/);
    assert.equal(existsSync(path.join(subjectDir, '_Mappa concettuale.md')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('findVaultNote preferisce la versione numerata quando esiste un duplicato senza numero', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-note-preference-'));
  try {
    const dir = path.join(root, 'Materia');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '01 Carica.md'), '# Carica numerata\n');
    writeFileSync(path.join(dir, 'Carica.md'), '# Carica senza numero\n');
    const notes = scanVault(root, '');
    const resolved = findVaultNote('Carica', notes);
    assert.equal(resolved.title, '01 Carica');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
