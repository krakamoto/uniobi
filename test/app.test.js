import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { preparePdfInputs } from '../src/pdf.js';
import { loadConfig } from '../src/config.js';
import { createStore } from '../src/db.js';
import { createWorker } from '../src/worker.js';
import { createApp } from '../src/app.js';
import { selectWikilinks, scanVault } from '../src/vault.js';
import { geminiAnalyze } from '../src/ai/gemini.js';
import { analyzeImages, shouldUseAdvancedFallback } from '../src/ai/index.js';
import { sanitizeFilename, isPathInside } from '../src/utils.js';
import { buildFinalMarkdown, validateLatexDelimiters } from '../src/markdown.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const PDF_2_PAGES = Buffer.from('JVBERi0xLjcKJcfsj6IKJSVJbnZvY2F0aW9uOiBncyAtcSAtZE5PUEFVU0UgLWRCQVRDSCAtc0RFVklDRT1wZGZ3cml0ZSAtc091dHB1dEZpbGU9PyA/CjUgMCBvYmoKPDwvTGVuZ3RoIDYgMCBSL0ZpbHRlciAvRmxhdGVEZWNvZGU+PgpzdHJlYW0KeJwtizEOwjAUQ/d/Cm+0CyRVpe5IbAwU5QI/IVRBNGlDysDp+dDKli092TPUXkP9tLUbSWGgmfSfYis34mjocO3QtDB3WscaXSNWMCNVFx5CZCwx4RYw5fRmuBRR/KskSGQONjx9bR7UyuVMVb8IZkzrU8Yl+OjB1rLw+BHGmUvxOdQ7OhnqRV+v+zIjZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjE0MQplbmRvYmoKMTAgMCBvYmoKPDwvTGVuZ3RoIDExIDAgUi9GaWx0ZXIgL0ZsYXRlRGVjb2RlPj4Kc3RyZWFtCnicLYu9DsIwEIP3ewpvtAukVaXOILExAMoLHOlRgtKkPykDT09Kq8+SLcseoPYF1MLmpiOFlgYq/i02Mx1Omg73GmUF/aR1XKAukxR0R9mVW+sZzSxoLPoxfBgmeLCLY0CUKYZcv6lK6wtlR29egmFONaNfr8uxtZGdpDiJk68Nnh/WSb6js6Zb4gcZMTCUZW5kc3RyZWFtCmVuZG9iagoxMSAwIG9iagoxNDMKZW5kb2JqCjQgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94IFswIDAgNTk1IDg0Ml0KL1JvdGF0ZSAwL1BhcmVudCAzIDAgUgovUmVzb3VyY2VzPDwvUHJvY1NldFsvUERGIC9UZXh0XQovRm9udCA4IDAgUgo+PgovQ29udGVudHMgNSAwIFIKPj4KZW5kb2JqCjkgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94IFswIDAgNTk1IDg0Ml0KL1JvdGF0ZSAwL1BhcmVudCAzIDAgUgovUmVzb3VyY2VzPDwvUHJvY1NldFsvUERGIC9UZXh0XQovRm9udCAxMiAwIFIKPj4KL0NvbnRlbnRzIDEwIDAgUgo+PgplbmRvYmoKMyAwIG9iago8PCAvVHlwZSAvUGFnZXMgL0tpZHMgWwo0IDAgUgo5IDAgUgpdIC9Db3VudCAyCj4+CmVuZG9iagoxIDAgb2JqCjw8L1R5cGUgL0NhdGFsb2cgL1BhZ2VzIDMgMCBSCi9NZXRhZGF0YSAxMyAwIFIKPj4KZW5kb2JqCjggMCBvYmoKPDwvUjcKNyAwIFI+PgplbmRvYmoKMTIgMCBvYmoKPDwvUjcKNyAwIFI+PgplbmRvYmoKNyAwIG9iago8PC9CYXNlRm9udC9IZWx2ZXRpY2EvVHlwZS9Gb250Ci9TdWJ0eXBlL1R5cGUxPj4KZW5kb2JqCjEzIDAgb2JqCjw8L1R5cGUvTWV0YWRhdGEKL1N1YnR5cGUvWE1ML0xlbmd0aCAxMTgzPj5zdHJlYW0KPD94cGFja2V0IGJlZ2luPSfvu78nIGlkPSdXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQnPz4KPD9hZG9iZS14YXAtZmlsdGVycyBlc2M9IkNSTEYiPz4KPHg6eG1wbWV0YSB4bWxuczp4PSdhZG9iZTpuczptZXRhLycgeDp4bXB0az0nWE1QIHRvb2xraXQgMi45LjEtMTMsIGZyYW1ld29yayAxLjYnPgo8cmRmOlJERiB4bWxuczpyZGY9J2h0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMnIHhtbG5zOmlYPSdodHRwOi8vbnMuYWRvYmUuY29tL2lYLzEuMC8nPgo8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczpwZGY9J2h0dHA6Ly9ucy5hZG9iZS5jb20vcGRmLzEuMy8nIHBkZjpQcm9kdWNlcj0nR1BMIEdob3N0c2NyaXB0IDEwLjAwLjAnLz4KPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSdodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvJz48eG1wOk1vZGlmeURhdGU+MjAyNi0xMS0wNVQxMDowMjoxMyswMTowMDwveG1wOk1vZGlmeURhdGU+Cjx4bXA6Q3JlYXRlRGF0ZT4yMDI2LTExLTA1VDEwOjAyOjEzKzAxOjAwPC94bXA6Q3JlYXRlRGF0ZT4KPHhtcDpDcmVhdG9yVG9vbD5Vbmtub3duQXBwbGljYXRpb248L3htcDpDcmVhdG9yVG9vbD48L3JkZjpEZXNjcmlwdGlvbj4KPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eGFwTU09J2h0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8nIHhhcE1NOkRvY3VtZW50SUQ9J3V1aWQ6MjQxMjkxODUtMTExNC0xMWZkLTAwMDAtY2M4MzZkOGVmZGEyJy8+CjxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOmRjPSdodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLycgZGM6Zm9ybWF0PSdhcHBsaWNhdGlvbi9wZGYnPjxkYzp0aXRsZT48cmRmOkFsdD48cmRmOmxpIHhtbDpsYW5nPSd4LWRlZmF1bHQnPlVudGl0bGVkPC9yZGY6bGk+PC9yZGY6QWx0PjwvZGM6dGl0bGU+PC9yZGY6RGVzY3JpcHRpb24+CjwvcmRmOlJERj4KPC94OnhtcG1ldGE+CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKPD94cGFja2V0IGVuZD0ndyc/PgplbmRzdHJlYW0KZW5kb2JqCjIgMCBvYmoKPDwvUHJvZHVjZXIoR1BMIEdob3N0c2NyaXB0IDEwLjAwLjApCi9DcmVhdGlvbkRhdGUoRDoyMDI2MTEwNTEwMDIxMyswMScwMCcpCi9Nb2REYXRlKEQ6MjAyNjExMDUxMDAyMTMrMDEnMDAnKT4+ZW5kb2JqCnhyZWYKMCAxNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDA5MDIgMDAwMDAgbiAKMDAwMDAwMjM1MCAwMDAwMCBuIAowMDAwMDAwODM3IDAwMDAwIG4gCjAwMDAwMDA1NTMgMDAwMDAgbiAKMDAwMDAwMDA4OCAwMDAwMCBuIAowMDAwMDAwMjk5IDAwMDAwIG4gCjAwMDAwMDEwMjYgMDAwMDAgbiAKMDAwMDAwMDk2NyAwMDAwMCBuIAowMDAwMDAwNjk0IDAwMDAwIG4gCjAwMDAwMDAzMTggMDAwMDAgbiAKMDAwMDAwMDUzMyAwMDAwMCBuIAowMDAwMDAwOTk2IDAwMDAwIG4gCjAwMDAwMDEwOTAgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSAxNCAvUm9vdCAxIDAgUiAvSW5mbyAyIDAgUgovSUQgWzwxQjIwRTNGMzA3NTk4QzMyMDQ2RTdCNjc3QUZCMTE3NT48MUIyMEUzRjMwNzU5OEMzMjA0NkU3QjY3N0FGQjExNzU+XQo+PgpzdGFydHhyZWYKMjQ3NgolJUVPRgo=', 'base64');

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

  assert.equal(savePayload.autoRemoved, true);
  const removedAfterSave = await fetch(`${baseUrl}/api/jobs/${jobId}`);
  assert.equal(removedAfterSave.status, 404);
  assert.equal(existsSync(savedPath), true);

  // Un job non ancora salvato viene eliminato completamente dal server.
  const unsavedForm = new FormData();
  unsavedForm.append('course', 'Analisi Matematica II');
  unsavedForm.append('lessonDate', '2024-10-28');
  unsavedForm.append('requestedTitle', 'Bozza da eliminare');
  unsavedForm.append('files', new Blob([PNG_1X1], { type: 'image/png' }), 'bozza.png');
  const unsavedUpload = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: unsavedForm });
  assert.equal(unsavedUpload.status, 202);
  const unsavedId = (await unsavedUpload.json()).job.id;
  await worker.waitForIdle();

  const unsavedDelete = await fetch(`${baseUrl}/api/jobs/${unsavedId}`, { method: 'DELETE' });
  assert.equal(unsavedDelete.status, 200);
  const unsavedDeletePayload = await unsavedDelete.json();
  assert.equal(unsavedDeletePayload.ok, true);
  assert.equal(unsavedDeletePayload.vaultFilesPreserved, true);
  const unsavedDetail = await fetch(`${baseUrl}/api/jobs/${unsavedId}`);
  assert.equal(unsavedDetail.status, 404);

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


test('upload accetta più di 10 immagini in un singolo job', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-many-images-'));
  const uploadDir = path.join(root, 'uploads');
  const vaultPath = path.join(root, 'vault');
  const databasePath = path.join(root, 'uniai.db');
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(vaultPath, { recursive: true });

  const config = loadConfig({
    ...process.env,
    APP_PASSWORD: '',
    DATABASE_URL: databasePath,
    UPLOAD_DIR: uploadDir,
    OBSIDIAN_VAULT_PATH: vaultPath,
    AI_PROVIDER: 'mock',
    AUTO_SAVE_TO_VAULT: 'false',
    WORKER_POLL_MS: '0',
    MAX_FILES_PER_UPLOAD: '50'
  }, root);

  assert.equal(config.maxFilesPerUpload, 50);
  const store = createStore(config.databasePath);
  const worker = createWorker({ config, store });
  const app = createApp({ config, store, worker });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await worker.waitForIdle();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const form = new FormData();
  for (let index = 1; index <= 12; index += 1) {
    form.append('files', new Blob([PNG_1X1], { type: 'image/png' }), `pagina-${index}.png`);
  }
  form.append('course', 'Analisi Matematica II');

  const uploadResponse = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: form });
  assert.equal(uploadResponse.status, 202);
  const uploadPayload = await uploadResponse.json();
  assert.ok(uploadPayload.job.id);

  const detailResponse = await fetch(`${baseUrl}/api/jobs/${uploadPayload.job.id}`);
  assert.equal(detailResponse.status, 200);
  const detailPayload = await detailResponse.json();
  assert.equal(detailPayload.job.files.length, 12);

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  const healthPayload = await healthResponse.json();
  assert.equal(healthPayload.maxFilesPerUpload, 50);
});


test('upload PDF: estrae il testo e completa il job senza rasterizzare pagine digitali', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-pdf-'));
  const uploadDir = path.join(root, 'uploads');
  const vaultPath = path.join(root, 'vault');
  const databasePath = path.join(root, 'uniai.db');
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(vaultPath, { recursive: true });

  const config = loadConfig({
    ...process.env,
    APP_PASSWORD: '',
    DATABASE_URL: databasePath,
    UPLOAD_DIR: uploadDir,
    OBSIDIAN_VAULT_PATH: vaultPath,
    AI_PROVIDER: 'mock',
    AUTO_SAVE_TO_VAULT: 'false',
    WORKER_POLL_MS: '0',
    PDF_TEXT_EXTRACTION_ENABLED: 'true',
    PDF_TEXT_PAGE_MIN_CHARS: '10'
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
    await worker.waitForIdle();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const form = new FormData();
  form.append('files', new Blob([PDF_2_PAGES], { type: 'application/pdf' }), 'appunti.pdf');
  form.append('course', 'Analisi Matematica II');

  const uploadResponse = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: form });
  assert.equal(uploadResponse.status, 202);
  const uploadPayload = await uploadResponse.json();
  const jobId = uploadPayload.job.id;

  await worker.waitForIdle();
  const detailResponse = await fetch(`${baseUrl}/api/jobs/${jobId}`);
  assert.equal(detailResponse.status, 200);
  const detailPayload = await detailResponse.json();
  assert.equal(detailPayload.job.status, 'completed');
  assert.equal(detailPayload.job.files.length, 1);
  assert.equal(detailPayload.job.result_json.ai.pdf.pdfCount, 1);
  assert.equal(detailPayload.job.result_json.ai.pdf.totalPages, 2);
  assert.equal(detailPayload.job.result_json.ai.pdf.textPages, 2);
  assert.equal(detailPayload.job.result_json.ai.pdf.renderedPages, 0);
  assert.equal(detailPayload.job.result_json.ai.inputImages.length, 0);
});

test('PDF multi-pagina viene diviso in parti e completato dal worker', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-pdf-split-'));
  const uploadDir = path.join(root, 'uploads');
  const vaultPath = path.join(root, 'vault');
  const databasePath = path.join(root, 'uniai.db');
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(vaultPath, { recursive: true });

  const pdfInputs = [];
  for (let i = 0; i < 4; i += 1) {
    const part = path.join(root, `source-${i}.pdf`);
    writeFileSync(part, PDF_2_PAGES);
    pdfInputs.push(part);
  }
  const multiPdf = path.join(root, 'appunti-8-pagine.pdf');
  execFileSync('pdfunite', [...pdfInputs, multiPdf]);

  const config = loadConfig({
    ...process.env,
    APP_PASSWORD: '',
    DATABASE_URL: databasePath,
    UPLOAD_DIR: uploadDir,
    OBSIDIAN_VAULT_PATH: vaultPath,
    AI_PROVIDER: 'mock',
    AUTO_SAVE_TO_VAULT: 'false',
    WORKER_POLL_MS: '0',
    PDF_TEXT_EXTRACTION_ENABLED: 'true',
    PDF_TEXT_PAGE_MIN_CHARS: '10',
    PDF_PAGES_PER_ANALYSIS: '3',
    PDF_MAX_ANALYSIS_PARTS: '10',
    PDF_MAX_PAGES_PER_JOB: '20',
    PDF_MAX_PAGES_PER_FILE: '20'
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
    await worker.waitForIdle();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const form = new FormData();
  form.append('files', new Blob([await import('node:fs/promises').then((fs) => fs.readFile(multiPdf))], { type: 'application/pdf' }), 'appunti-8-pagine.pdf');
  form.append('course', 'Analisi Matematica II');
  const uploadResponse = await fetch(`${baseUrl}/api/uploads`, { method: 'POST', body: form });
  assert.equal(uploadResponse.status, 202);
  const uploadPayload = await uploadResponse.json();
  await worker.waitForIdle();
  const detailResponse = await fetch(`${baseUrl}/api/jobs/${uploadPayload.job.id}`);
  assert.equal(detailResponse.status, 200);
  const job = (await detailResponse.json()).job;
  assert.equal(job.status, 'completed');
  assert.equal(job.result_json.ai.pdf.totalPages, 8);
  assert.equal(job.result_json.ai.pdf.analysisParts, 3);
  assert.equal(job.result_json.ai.chunking.partCount, 3);
  assert.ok(job.result_json.notes.length >= 1);
});

test('PDF digitale con figure viene rasterizzato per permettere il ritaglio', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-pdf-figure-'));
  const uploadDir = path.join(root, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const psPath = path.join(root, 'figura.ps');
  const pdfPath = path.join(root, 'figura.pdf');
  writeFileSync(psPath, '%!PS-Adobe-3.0\n/Helvetica findfont 22 scalefont setfont\n72 720 moveto (Figura 1 - schema di prova con testo) show\nshowpage\n');
  execFileSync('ps2pdf', [psPath, pdfPath]);
  try {
    const result = await preparePdfInputs({
      files: [{ absolutePath: pdfPath, originalName: 'figura.pdf', mimeType: 'application/pdf' }],
      config: {
        uploadDir,
        pdfMaxPagesPerFile: 5,
        pdfMaxPagesPerJob: 5,
        pdfPagesPerAnalysis: 6,
        pdfMaxAnalysisParts: 5,
        pdfTextExtractionEnabled: true,
        pdfTextPageMinChars: 5,
        pdfMaxTextCharsPerJob: 120000,
        pdfRenderFigurePages: true,
        pdfFigureRenderMaxSide: 400,
        pdfRenderMaxSide: 400,
        pdfJpegQuality: 60,
        imageMaxSide: 400,
        maxAiImagesPerJob: 10
      },
      jobId: 'figura-job'
    });
    assert.equal(result.stats.totalPages, 1);
    assert.equal(result.stats.textPages, 1);
    assert.equal(result.stats.figurePages, 1);
    assert.equal(result.parts.length, 1);
    assert.equal(result.parts[0].pdfTextSections.length, 1);
    assert.equal(result.parts[0].imageInputs.length, 1);
    assert.equal(result.parts[0].imageInputs[0].inputKind, 'pdf-figure-page');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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


test('le parti illeggibili non attivano fallback se disabilitato', () => {
  const base = {
    notes: [{
      title: 'Appunti parziali',
      markdown: '# Appunti parziali\n\n> [!warning] Parte illeggibile\n> La seconda riga non è comprensibile.',
      extractedText: 'Testo parziale',
      confidence: 0.2,
      warnings: ['Parte illeggibile nella foto manoscritta']
    }],
    warnings: ['Parte illeggibile nella foto manoscritta'],
    confidence: 0.2,
    analyzedImageIndexes: [0, 1]
  };
  const config = {
    aiProvider: 'claude',
    aiFallbackEnabled: true,
    aiFallbackModel: 'claude-sonnet-5-5',
    aiFallbackOnIllegible: false,
    aiFallbackMinConfidence: 0.7,
    aiFallbackMinCharsPerImage: 80
  };
  const noFallback = shouldUseAdvancedFallback(base, [{}, {}], config);
  assert.equal(noFallback.needed, false);
  const missingCoverage = shouldUseAdvancedFallback({ ...base, analyzedImageIndexes: [0] }, [{}, {}], config);
  assert.equal(missingCoverage.needed, true);
  assert.match(missingCoverage.reason, /immagini non analizzate/i);
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
          warnings: [],
          analyzedImageIndexes: [0]
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
          warnings: ['Parte illeggibile nella foto'],
          analyzedImageIndexes: [0]
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
        aiFallbackMinCharsPerImage: 10,
        aiRetryMaxAttempts: 1,
        aiRetryBaseDelayMs: 0,
        aiRetryMaxDelayMs: 0
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


test('DeepSeek Flash usa l’API OpenAI-compatible con input immagine', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-deepseek-'));
  const imagePath = path.join(root, 'appunti.png');
  writeFileSync(imagePath, PNG_1X1);
  const originalFetch = global.fetch;
  let capturedUrl = '';
  let capturedBody = null;
  global.fetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(options.body);
    const result = {
      analyzedImageIndexes: [0],
      course: 'Test',
      subject: 'Test',
      date: '2026-11-03',
      summary: 'Analisi DeepSeek',
      confidence: 0.9,
      warnings: [],
      notes: [{
        title: 'Nota DeepSeek',
        markdown: '# Nota DeepSeek\n\nContenuto completo.',
        extractedText: 'Trascrizione completa',
        tags: [], aliases: [], keyConcepts: [], conceptRelations: [], figures: [], links: [], confidence: 0.9, warnings: []
      }]
    };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 800, completion_tokens: 200, total_tokens: 1000, prompt_tokens_details: { cached_tokens: 50 } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const result = await analyzeImages({
      config: {
        aiProvider: 'deepseek',
        aiModel: 'deepseek-flash',
        aiApiKey: 'deepseek-test-key',
        aiBaseUrl: 'https://api.deepseek.com',
        aiJsonMode: true,
        aiFallbackEnabled: false,
        aiFallbackMinConfidence: 0.7,
        aiFallbackOnIllegible: true,
        aiFallbackMinCharsPerImage: 10,
        aiRetryMaxAttempts: 1,
        aiRetryBaseDelayMs: 0,
        aiRetryMaxDelayMs: 0
      },
      files: [{ absolutePath: imagePath, mimeType: 'image/png', originalName: 'appunti.png' }],
      metadata: { course: 'Test', date: '2026-11-03', title: '', tags: [], userNotes: '', files: [] },
      vaultNotes: []
    });
    assert.equal(capturedUrl, 'https://api.deepseek.com/chat/completions');
    assert.equal(capturedBody.model, 'deepseek-flash');
    assert.deepEqual(capturedBody.response_format, { type: 'json_object' });
    assert.deepEqual(capturedBody.thinking, { type: 'disabled' });
    assert.equal(capturedBody.max_tokens, 32768);
    const userParts = capturedBody.messages.find((message) => message.role === 'user').content;
    assert.ok(userParts.some((part) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/jpeg;base64,')));
    assert.equal(result.title, 'Nota DeepSeek');
    assert.deepEqual(result.analyzedImageIndexes, [0]);
    assert.equal(result.usage.inputTokens, 800);
    assert.equal(result.usage.outputTokens, 200);
    assert.equal(result.usage.cachedInputTokens, 50);
  } finally {
    global.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Claude Haiku usa Message Batches con immagini e completa il polling', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-claude-batch-'));
  const imagePath = path.join(root, 'appunti.png');
  writeFileSync(imagePath, PNG_1X1);
  const originalFetch = global.fetch;
  let createBody = null;
  let createHeaders = null;
  let resultsRequested = false;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/v1/messages/batches') && options.method === 'POST') {
      createBody = JSON.parse(options.body);
      createHeaders = options.headers;
      return new Response(JSON.stringify({ id: 'msgbatch_test', processing_status: 'in_progress' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target.endsWith('/v1/messages/batches/msgbatch_test') && options.method === 'GET') {
      return new Response(JSON.stringify({ id: 'msgbatch_test', processing_status: 'ended', results_url: 'https://api.anthropic.com/v1/messages/batches/msgbatch_test/results' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target.endsWith('/v1/messages/batches/msgbatch_test/results')) {
      resultsRequested = true;
      const result = {
        analyzedImageIndexes: [1],
        course: 'Test',
        subject: 'Test',
        date: '2026-11-03',
        summary: 'Analisi Claude',
        confidence: 0.9,
        warnings: [],
        notes: [{
          title: 'Nota Claude',
          markdown: '# Nota Claude\n\nContenuto completo.',
          extractedText: 'Trascrizione Claude completa.',
          tags: [], aliases: [], keyConcepts: [], conceptRelations: [], figures: [{ id: 'fig1', sourceImageIndex: 1, bbox: [0.1, 0.1, 0.2, 0.2], caption: 'Test', kind: 'diagram' }], links: [], confidence: 0.9, warnings: []
        }]
      };
      const line = JSON.stringify({
        custom_id: createBody.requests[0].custom_id,
        result: {
          type: 'succeeded',
          message: { content: [{ type: 'text', text: JSON.stringify(result) }], usage: { input_tokens: 1200, output_tokens: 345, cache_read_input_tokens: 100 } }
        }
      });
      return new Response(line + '\n', { status: 200, headers: { 'Content-Type': 'application/x-jsonlines' } });
    }
    throw new Error(`URL inatteso: ${target}`);
  };

  try {
    const result = await analyzeImages({
      config: {
        aiProvider: 'claude',
        aiModel: 'claude-haiku-5-5',
        aiApiKey: 'claude-test-key',
        aiBaseUrl: 'https://api.anthropic.com',
        aiMaxOutputTokens: 32768,
        aiClaudeUseBatch: true,
        aiClaudeBatchPollMs: 0,
        aiClaudeBatchTimeoutMs: 10000,
        aiFallbackEnabled: false,
        aiFallbackMinConfidence: 0.7,
        aiFallbackOnIllegible: true,
        aiFallbackMinCharsPerImage: 10,
        aiRetryMaxAttempts: 1,
        aiRetryBaseDelayMs: 0,
        aiRetryMaxDelayMs: 0
      },
      files: [{ absolutePath: imagePath, mimeType: 'image/png', originalName: 'appunti.png' }],
      metadata: { course: 'Test', date: '2026-11-03', title: '', tags: [], userNotes: '', files: [] },
      vaultNotes: []
    });
    assert.equal(createBody.requests[0].params.model, 'claude-haiku-5-5');
    assert.equal(createBody.requests[0].params.max_tokens, 32768);
    assert.equal(createHeaders['anthropic-version'], '2023-06-01');
    assert.ok(createBody.requests[0].params.messages[0].content.some((part) => part.type === 'image' && part.source.type === 'base64'));
    assert.equal(resultsRequested, true);
    assert.equal(result.title, 'Nota Claude');
    assert.deepEqual(result.analyzedImageIndexes, [0]);
    assert.equal(result.notes[0].figures[0].sourceImageIndex, 0);
    assert.equal(result.usage.inputTokens, 1200);
    assert.equal(result.usage.outputTokens, 345);
    assert.equal(result.usage.cachedInputTokens, 100);
    assert.equal(result.imageProcessing.length, 1);
  } finally {
    global.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Claude usa il provider di emergenza se primario e fallback non hanno chiave', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-claude-emergency-'));
  const imagePath = path.join(root, 'appunti.png');
  writeFileSync(imagePath, PNG_1X1);
  try {
    const result = await analyzeImages({
      config: {
        aiProvider: 'claude',
        aiModel: 'claude-haiku-5-5',
        aiApiKey: '',
        aiBaseUrl: 'https://api.anthropic.com',
        aiMaxOutputTokens: 32768,
        aiClaudeUseBatch: true,
        aiClaudeBatchPollMs: 0,
        aiClaudeBatchTimeoutMs: 10000,
        aiFallbackEnabled: true,
        aiFallbackProvider: 'claude',
        aiFallbackModel: 'claude-sonnet-5-5',
        aiFallbackApiKey: '',
        aiFallbackBaseUrl: 'https://api.anthropic.com',
        aiFallbackMinConfidence: 0.7,
        aiFallbackOnIllegible: true,
        aiFallbackMinCharsPerImage: 10,
        aiEmergencyEnabled: true,
        aiEmergencyProvider: 'mock',
        aiEmergencyModel: 'mock-emergency',
        aiEmergencyApiKey: '',
        aiEmergencyBaseUrl: '',
        aiRetryMaxAttempts: 1,
        aiRetryBaseDelayMs: 0,
        aiRetryMaxDelayMs: 0
      },
      files: [{ absolutePath: imagePath, mimeType: 'image/png', originalName: 'appunti.png' }],
      metadata: { course: 'Test', date: '2026-11-03', title: '', tags: [], userNotes: '', files: [] },
      vaultNotes: []
    });
    assert.equal(result.emergencyUsed, true);
    assert.equal(result.notes.length > 0, true);
    assert.deepEqual(result.analyzedImageIndexes, [0]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Gemini ritenta gli errori 503 e verifica la copertura di tutte le immagini', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-ai-retry-'));
  const imageA = path.join(root, 'a.png');
  const imageB = path.join(root, 'b.png');
  writeFileSync(imageA, PNG_1X1);
  writeFileSync(imageB, PNG_1X1);
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('high demand', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
    const incomplete = calls === 2;
    const result = {
      analyzedImageIndexes: incomplete ? [0] : [0, 1],
      course: 'Test',
      subject: 'Test',
      date: '2025-10-31',
      summary: 'Analisi',
      confidence: 0.9,
      warnings: [],
      notes: incomplete
        ? [{ title: 'Nota A', markdown: '# Nota A\n\nTesto sufficientemente lungo per il test.', extractedText: 'Testo A', tags: [], aliases: [], keyConcepts: [], conceptRelations: [], figures: [], links: [], confidence: 0.9, warnings: [] }]
        : [
            { title: 'Nota A', markdown: '# Nota A\n\nTesto sufficientemente lungo per il test.', extractedText: 'Testo A', tags: [], aliases: [], keyConcepts: [], conceptRelations: [], figures: [], links: [], confidence: 0.9, warnings: [] },
            { title: 'Nota B', markdown: '# Nota B\n\nTesto sufficientemente lungo per il test.', extractedText: 'Testo B', tags: [], aliases: [], keyConcepts: [], conceptRelations: [], figures: [], links: [], confidence: 0.9, warnings: [] }
          ]
    };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await analyzeImages({
      config: {
        aiProvider: 'gemini',
        aiModel: 'gemini-test',
        aiApiKey: 'test-key',
        aiBaseUrl: 'https://example.test',
        aiFallbackEnabled: false,
        aiFallbackMinConfidence: 0.7,
        aiFallbackOnIllegible: true,
        aiFallbackMinCharsPerImage: 10,
        aiRetryMaxAttempts: 4,
        aiRetryBaseDelayMs: 0,
        aiRetryMaxDelayMs: 0
      },
      files: [
        { absolutePath: imageA, mimeType: 'image/png', originalName: 'a.png' },
        { absolutePath: imageB, mimeType: 'image/png', originalName: 'b.png' }
      ],
      metadata: { course: 'Test', date: '2025-10-31', title: '', tags: [], userNotes: '', files: [] },
      vaultNotes: []
    });
    assert.equal(calls, 3);
    assert.equal(result.retryAttempts, 3);
    assert.deepEqual(result.analyzedImageIndexes, [0, 1]);
    assert.equal(result.notes.length, 2);
  } finally {
    global.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('oltre la soglia non avvia un fallback foto-per-foto costoso', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-cost-guard-'));
  const files = [];
  for (let i = 0; i < 7; i += 1) {
    const file = path.join(root, `foto-${i}.png`);
    writeFileSync(file, PNG_1X1);
    files.push({ absolutePath: file, mimeType: 'image/png', originalName: `foto-${i}.png` });
  }
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response('high demand', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  };
  try {
    await assert.rejects(() => analyzeImages({
      config: {
        aiProvider: 'gemini',
        aiModel: 'gemini-test',
        aiApiKey: 'test-key',
        aiBaseUrl: 'https://example.test',
        aiFallbackEnabled: false,
        aiFallbackMinConfidence: 0.7,
        aiFallbackOnIllegible: false,
        aiFallbackMinCharsPerImage: 10,
        aiPerImageFallbackMaxImages: 6,
        aiMaxProviderCallsPerJob: 10,
        aiRetryMaxAttempts: 1,
        aiRetryBaseDelayMs: 0,
        aiRetryMaxDelayMs: 0
      },
      files,
      metadata: { course: 'Test', date: '2026-11-03', title: '', tags: [], userNotes: '', files: [] },
      vaultNotes: []
    }), /disattivato oltre 6 foto/);
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('se il batch Gemini fallisce analizza ogni foto separatamente', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-ai-per-image-'));
  const imageA = path.join(root, 'a.png');
  const imageB = path.join(root, 'b.png');
  writeFileSync(imageA, PNG_1X1);
  writeFileSync(imageB, PNG_1X1);
  const originalFetch = global.fetch;
  let batchCalls = 0;
  let singleCalls = 0;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const parts = body.contents[0].parts.filter((part) => part.inlineData);
    if (parts.length > 1) {
      batchCalls += 1;
      return new Response('high demand', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
    singleCalls += 1;
    const promptText = body.contents[0].parts[0].text;
    const originalIndex = promptText.includes('indice originale 1') ? 1 : 0;
    const result = {
      analyzedImageIndexes: [0],
      course: 'Test',
      subject: 'Test',
      date: '2025-10-31',
      summary: `Analisi foto ${originalIndex + 1}`,
      confidence: 0.9,
      warnings: [],
      notes: [{
        title: `Nota foto ${originalIndex + 1}`,
        markdown: `# Nota foto ${originalIndex + 1}\n\nContenuto completo della foto.`,
        extractedText: `Testo foto ${originalIndex + 1}`,
        tags: [], aliases: [], keyConcepts: [], conceptRelations: [], figures: [], links: [], confidence: 0.9, warnings: []
      }]
    };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await analyzeImages({
      config: {
        aiProvider: 'gemini',
        aiModel: 'gemini-test',
        aiApiKey: 'test-key',
        aiBaseUrl: 'https://example.test',
        aiFallbackEnabled: false,
        aiFallbackMinConfidence: 0.7,
        aiFallbackOnIllegible: true,
        aiFallbackMinCharsPerImage: 10,
        aiRetryMaxAttempts: 2,
        aiRetryBaseDelayMs: 0,
        aiRetryMaxDelayMs: 0
      },
      files: [
        { absolutePath: imageA, mimeType: 'image/png', originalName: 'a.png' },
        { absolutePath: imageB, mimeType: 'image/png', originalName: 'b.png' }
      ],
      metadata: { course: 'Test', date: '2025-10-31', title: '', tags: [], userNotes: '', files: [] },
      vaultNotes: []
    });
    assert.equal(batchCalls, 2);
    assert.equal(singleCalls, 2);
    assert.equal(result.perImageFallbackUsed, true);
    assert.deepEqual(result.analyzedImageIndexes, [0, 1]);
    assert.equal(result.notes.length, 2);
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
            analyzedImageIndexes: [0],
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
        aiFallbackMinCharsPerImage: 10,
        aiRetryMaxAttempts: 1,
        aiRetryBaseDelayMs: 0,
        aiRetryMaxDelayMs: 0
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
