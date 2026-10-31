import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createStore } from '../src/db.js';
import { createWorker } from '../src/worker.js';
import { createApp } from '../src/app.js';
import { selectWikilinks, scanVault } from '../src/vault.js';
import { geminiAnalyze } from '../src/ai/gemini.js';
import { analyzeImages } from '../src/ai/index.js';
import { sanitizeFilename, isPathInside } from '../src/utils.js';
import { buildFinalMarkdown, validateLatexDelimiters } from '../src/markdown.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function isInside(parent, child) {
  return isPathInside(parent, child);
}

test('sanitizeFilename rimuove caratteri pericolosi e path traversal', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'etc passwd');
  assert.equal(sanitizeFilename('Lezione: integrali?'), 'Lezione integrali');
  assert.ok(!sanitizeFilename('a/b\\c').includes('/'));
  assert.ok(!isInside('/tmp/vault', '/tmp/vault-other/nota.md'));
});

test('i wikilink non esistenti non vengono inseriti senza opt-in', () => {
  const notes = [{ title: 'Analisi Matematica II', aliases: [], tags: [], relativePath: 'Analisi Matematica II.md' }];
  const links = selectWikilinks({
    aiLinks: [{ target: 'Nota inesistente', reason: 'test' }, { target: 'Analisi Matematica II', reason: 'corso' }],
    markdown: 'Testo con [[Nota inesistente]] e [[Analisi Matematica II]].',
    course: 'Analisi Matematica II',
    title: 'Integrali doppi',
    notes,
    allowCreate: false
  });
  assert.equal(links.length, 1);
  assert.equal(links[0].target, 'Analisi Matematica II');
  assert.equal(links[0].exists, true);
});

test('flusso end-to-end: upload, analisi mock, salvataggio atomico nel vault', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-test-'));
  const uploadDir = path.join(root, 'uploads');
  const vaultPath = path.join(root, 'vault');
  const databasePath = path.join(root, 'uniai.db');
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(vaultPath, { recursive: true });
  writeFileSync(path.join(vaultPath, 'Analisi Matematica II.md'), '# Analisi Matematica II\n');

  const config = loadConfig({
    ...process.env,
    APP_PASSWORD: '',
    DATABASE_URL: databasePath,
    UPLOAD_DIR: uploadDir,
    OBSIDIAN_VAULT_PATH: vaultPath,
    OBSIDIAN_NOTES_SUBDIR: 'Università/Lezioni',
    AI_PROVIDER: 'mock',
    AUTO_SAVE_TO_VAULT: 'false',
    ALLOW_CREATE_MISSING_WIKILINKS: 'false',
    WORKER_POLL_MS: '0',
    WEBDAV_ENABLED: 'true',
    WEBDAV_PATH: '/webdav',
    WEBDAV_USERNAME: 'uniai',
    WEBDAV_PASSWORD: 'test-webdav-password',
    WEBDAV_MAX_UPLOAD_MB: '5'
  }, root);

  const store = createStore(config.databasePath);
  const worker = createWorker({ config, store });
  const app = createApp({ config, store, worker });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const form = new FormData();
  form.append('files', new Blob([PNG_1X1], { type: 'image/png' }), 'appunti.png');
  form.append('course', 'Analisi Matematica II');
  form.append('lesson_date', '2025-10-31');
  form.append('title', 'Integrali doppi');
  form.append('tags', 'integrali, esercizi');

  const uploadResponse = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: form });
  assert.equal(uploadResponse.status, 202);
  const uploadPayload = await uploadResponse.json();
  const jobId = uploadPayload.job.id;
  assert.ok(jobId);

  await worker.waitForIdle();

  const detailResponse = await fetch(`${baseUrl}/api/jobs/${jobId}`);
  assert.equal(detailResponse.status, 200);
  const detailPayload = await detailResponse.json();
  assert.equal(detailPayload.job.status, 'completed');
  assert.match(detailPayload.job.markdown, /^---\n/);
  assert.match(detailPayload.job.markdown, /title: "Integrali doppi"/);
  assert.match(detailPayload.job.markdown, /\[\[Analisi Matematica II\]\]/);
  assert.equal(detailPayload.job.files.length, 1);

  const imageResponse = await fetch(`${baseUrl}${detailPayload.job.files[0].url}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(Buffer.from(await imageResponse.arrayBuffer()).length, PNG_1X1.length);

  const saveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/save-to-vault`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(saveResponse.status, 201);
  const savePayload = await saveResponse.json();
  assert.match(savePayload.vaultPath, /^Università\/Lezioni\/Analisi Matematica II\/001 Integrali doppi\.md$/);

  const savedPath = path.join(vaultPath, savePayload.vaultPath);
  assert.ok(existsSync(savedPath));
  const savedContent = readFileSync(savedPath, 'utf8');
  assert.match(savedContent, /\[\[Analisi Matematica II\]\]/);
  assert.match(savedContent, /source: "UniAi"/);

  const duplicateResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/save-to-vault`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(duplicateResponse.status, 409);

  // WebDAV: autenticazione, PROPFIND, PUT, GET e sincronizzazione bidirezionale col vault.
  const unauthorizedDav = await fetch(`${baseUrl}/webdav/`, { method: 'PROPFIND' });
  assert.equal(unauthorizedDav.status, 401);

  const webdavAuth = `Basic ${Buffer.from('uniai:test-webdav-password').toString('base64')}`;
  const davRoot = await fetch(`${baseUrl}/webdav/`, {
    method: 'PROPFIND',
    headers: { Authorization: webdavAuth, Depth: '1' }
  });
  assert.equal(davRoot.status, 207);
  const davRootXml = await davRoot.text();
  assert.match(davRootXml, /Analisi Matematica II\.md/);

  const davPut = await fetch(`${baseUrl}/webdav/Sync/da-telefono.md`, {
    method: 'PUT',
    headers: { Authorization: webdavAuth, 'Content-Type': 'text/markdown' },
    body: '# Nota sincronizzata\n\nCreata dal client WebDAV.\n'
  });
  assert.equal(davPut.status, 201);
  assert.ok(existsSync(path.join(vaultPath, 'Sync', 'da-telefono.md')));

  const davGet = await fetch(`${baseUrl}/webdav/Sync/da-telefono.md`, {
    headers: { Authorization: webdavAuth }
  });
  assert.equal(davGet.status, 200);
  assert.match(await davGet.text(), /Nota sincronizzata/);

  const davFolder = await fetch(`${baseUrl}/webdav/NuovaCartella/`, {
    method: 'MKCOL',
    headers: { Authorization: webdavAuth }
  });
  assert.equal(davFolder.status, 201);

  const davMove = await fetch(`${baseUrl}/webdav/Sync/da-telefono.md`, {
    method: 'MOVE',
    headers: {
      Authorization: webdavAuth,
      Destination: `${baseUrl}/webdav/NuovaCartella/spostata.md`
    }
  });
  assert.equal(davMove.status, 201);
  assert.ok(existsSync(path.join(vaultPath, 'NuovaCartella', 'spostata.md')));
});

test('scanVault legge titoli e alias dalle note esistenti', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-vault-'));
  try {
    mkdirSync(path.join(root, 'Corsi'), { recursive: true });
    writeFileSync(path.join(root, 'Corsi', 'Algebra.md'), '---\naliases:\n  - Algebra Lineare\ntags:\n  - matematica\n---\n# Algebra\n');
    const notes = scanVault(root, '');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].title, 'Algebra');
    assert.deepEqual(notes[0].aliases, ['Algebra Lineare']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('provider Gemini invia le immagini inline e valida la risposta JSON', async () => {
  const originalFetch = global.fetch;
  let capturedUrl = '';
  let capturedBody = null;
  global.fetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              title: 'Lezione Gemini',
              course: 'Analisi',
              date: '2025-10-31',
              tags: ['test'],
              summary: 'Riassunto',
              extractedText: 'Testo',
              markdown: '# Lezione Gemini\n\nContenuto',
              links: [],
              confidence: 0.9,
              warnings: []
            })
          }]
        }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await geminiAnalyze({
      config: {
        aiApiKey: 'test-key',
        aiModel: 'gemini-2.5-flash',
        aiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta'
      },
      prompt: 'Analizza gli appunti',
      images: [{ mimeType: 'image/png', base64: 'cG5n', dataUrl: 'data:image/png;base64,cG5n' }]
    });
    assert.match(capturedUrl, /models\/gemini-2.5-flash:generateContent$/);
    assert.equal(capturedBody.contents[0].parts[1].inlineData.mimeType, 'image/png');
    assert.equal(capturedBody.contents[0].parts[1].inlineData.data, 'cG5n');
    assert.equal(capturedBody.generationConfig.responseMimeType, 'application/json');
    assert.equal(result.title, 'Lezione Gemini');
  } finally {
    global.fetch = originalFetch;
  }
});


test('il LaTeX non delimitato viene segnalato e correttamente formattato', () => {
  const invalid = validateLatexDelimiters('# Test\n\n\\frac{a}{b} senza delimitatori.');
  assert.equal(invalid.valid, false);
  assert.ok(invalid.warnings.length > 0);

  const valid = validateLatexDelimiters('# Test\n\n$\\frac{a}{b}$ e $$\\int_0^1 x\\,dx$$');
  assert.equal(valid.valid, true);

  const markdown = buildFinalMarkdown({
    aiResult: {
      title: 'Formula',
      markdown: '# Formula\n\nLa formula è \\frac{a}{b}.',
      tags: [],
      aliases: [],
      warnings: [],
      keyConcepts: [],
      conceptRelations: []
    },
    metadata: { title: 'Formula', course: 'Matematica', date: '2025-10-31', tags: [] },
    links: [],
    warnings: [],
    createdAt: '2025-10-31T10:00:00.000Z',
    notes: [],
    allowCreate: false
  });
  assert.match(markdown, /LaTeX non racchiuso/);
});


test('fallback automatico Gemini Flash → Gemini Pro su bassa confidenza', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-ai-fallback-'));
  const imagePath = path.join(root, 'appunti.png');
  writeFileSync(imagePath, PNG_1X1);
  const originalFetch = global.fetch;
  const requestUrls = [];
  global.fetch = async (url, options) => {
    requestUrls.push(String(url));
    const isPro = String(url).includes('gemini-2.5-pro');
    const result = isPro
      ? {
          title: 'Risultato Pro',
          course: 'Test',
          subject: 'Test',
          date: '2025-10-31',
          tags: ['test'],
          summary: 'Risultato del modello avanzato',
          extractedText: 'Trascrizione completa e leggibile prodotta dal modello avanzato.',
          markdown: '# Risultato Pro\n\n## Contenuto\n\nTesto completo.',
          links: [],
          keyConcepts: ['concetto'],
          conceptRelations: [],
          confidence: 0.95,
          warnings: []
        }
      : {
          title: 'Risultato Flash',
          course: 'Test',
          date: '2025-10-31',
          tags: ['test'],
          summary: 'Risultato incerto',
          extractedText: 'Poco testo',
          markdown: '# Risultato Flash\n\nTesto incerto.',
          links: [],
          confidence: 0.2,
          warnings: ['Parte illeggibile nella foto']
        };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await analyzeImages({
      config: {
        aiProvider: 'gemini',
        aiModel: 'gemini-2.5-flash',
        aiApiKey: 'test-key',
        aiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        aiJsonMode: true,
        aiFallbackEnabled: true,
        aiFallbackProvider: 'gemini',
        aiFallbackModel: 'gemini-2.5-pro',
        aiFallbackApiKey: 'test-key',
        aiFallbackBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        aiFallbackMinConfidence: 0.7,
        aiFallbackOnIllegible: true,
        aiFallbackMinCharsPerImage: 10
      },
      files: [{ absolutePath: imagePath, mimeType: 'image/png', originalName: 'appunti.png' }],
      metadata: { course: 'Test', date: '2025-10-31', title: '', tags: [], userNotes: '', files: [] },
      vaultNotes: []
    });
    assert.equal(requestUrls.length, 2);
    assert.match(requestUrls[0], /gemini-2.5-flash:generateContent/);
    assert.match(requestUrls[1], /gemini-2.5-pro:generateContent/);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.modelUsed, 'gemini-2.5-pro');
    assert.equal(result.title, 'Risultato Pro');
    assert.match(result.fallbackReason, /confidenza|illeggibil/i);
  } finally {
    global.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});


test('il modello può restituire più note separate per argomenti distinti', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-multinote-ai-'));
  const imagePath = path.join(root, 'appunti.png');
  writeFileSync(imagePath, PNG_1X1);
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            course: 'Controlli automatici',
            subject: 'controlli automatici',
            date: '2025-10-31',
            summary: 'Due argomenti distinti',
            confidence: 0.92,
            warnings: [],
            notes: [
              {
                title: 'Funzione di trasferimento',
                tags: ['controlli'],
                aliases: ['Transfer function'],
                summary: 'Definizione e proprietà',
                extractedText: 'La funzione di trasferimento mette in relazione ingresso e uscita.',
                markdown: '# Funzione di trasferimento\n\n## Definizione\n\n$G(s)=Y(s)/U(s)$.',
                links: [{ target: 'Risposta in frequenza', reason: 'Concetto correlato', exists: true }],
                keyConcepts: ['funzione di trasferimento'],
                conceptRelations: [],
                confidence: 0.93,
                warnings: []
              },
              {
                title: 'Risposta in frequenza',
                tags: ['controlli'],
                aliases: [],
                summary: 'Analisi nel dominio della frequenza',
                extractedText: 'La risposta in frequenza descrive il comportamento a regime sinusoidale.',
                markdown: '# Risposta in frequenza\n\n## Definizione\n\n$G(j\\omega)$.',
                links: [{ target: 'Funzione di trasferimento', reason: 'Concetto correlato', exists: true }],
                keyConcepts: ['risposta in frequenza'],
                conceptRelations: [],
                confidence: 0.9,
                warnings: []
              }
            ]
          })
        }]
      }
    }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const result = await analyzeImages({
      config: {
        aiProvider: 'gemini',
        aiModel: 'gemini-3.6-flash',
        aiApiKey: 'test-key',
        aiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        aiJsonMode: true,
        aiFallbackEnabled: false,
        aiFallbackProvider: 'gemini',
        aiFallbackModel: '',
        aiFallbackMinConfidence: 0.7,
        aiFallbackOnIllegible: true,
        aiFallbackMinCharsPerImage: 10
      },
      files: [{ absolutePath: imagePath, mimeType: 'image/png', originalName: 'appunti.png' }],
      metadata: { course: 'Controlli automatici', date: '2025-10-31', title: '', tags: [], userNotes: '', files: [] },
      vaultNotes: []
    });
    assert.equal(result.notes.length, 2);
    assert.equal(result.notes[0].title, 'Funzione di trasferimento');
    assert.equal(result.notes[1].title, 'Risposta in frequenza');
    assert.equal(result.noteCount, 2);
  } finally {
    global.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});
