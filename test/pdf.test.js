import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPdfFile, preparePdfInputs, validatePdfUploads } from '../src/pdf.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/two-pages.pdf', import.meta.url));

test('riconosce i PDF da MIME o estensione', () => {
  assert.equal(isPdfFile({ mimeType: 'application/pdf', originalName: 'appunti.bin' }), true);
  assert.equal(isPdfFile({ mimeType: 'application/octet-stream', originalName: 'appunti.PDF' }), true);
  assert.equal(isPdfFile({ mimeType: 'image/png', originalName: 'foto.png' }), false);
});

test('prepara PDF digitali come testo e PDF forzati come pagine immagine', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-pdf-prep-'));
  const uploadDir = path.join(root, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const jobId = 'pdf-job';
  const pdfPath = path.join(uploadDir, jobId, 'appunti.pdf');
  mkdirSync(path.dirname(pdfPath), { recursive: true });
  copyFileSync(FIXTURE, pdfPath);

  const config = {
    uploadDir,
    imageMaxSide: 1600,
    imageJpegQuality: 88,
    pdfMaxPagesPerFile: 30,
    pdfMaxPagesPerJob: 24,
    pdfRecommendedPagesPerJob: 6,
    pdfTextExtractionEnabled: true,
    pdfTextPageMinChars: 20,
    pdfMaxTextCharsPerJob: 120000,
    maxAiImagesPerJob: 50
  };
  const files = [{
    absolutePath: pdfPath,
    relativePath: `${jobId}/appunti.pdf`,
    originalName: 'appunti.pdf',
    mimeType: 'application/pdf'
  }];

  try {
    const textOnly = await preparePdfInputs({ files, config, jobId });
    assert.equal(textOnly.stats.totalPages, 2);
    assert.equal(textOnly.stats.textPages, 2);
    assert.equal(textOnly.stats.renderedPages, 0);
    assert.equal(textOnly.imageInputs.length, 0);
    assert.equal(textOnly.pdfTextSections.length, 2);

    const rasterized = await preparePdfInputs({
      files,
      config: { ...config, pdfTextExtractionEnabled: false },
      jobId
    });
    assert.equal(rasterized.stats.textPages, 0);
    assert.equal(rasterized.stats.renderedPages, 2);
    assert.equal(rasterized.imageInputs.length, 2);
    assert.deepEqual(rasterized.imageInputs.map((item) => item.pdfPage), [1, 2]);
    for (const input of rasterized.imageInputs) assert.ok(existsSync(input.absolutePath));

    await assert.rejects(
      () => validatePdfUploads(files.map((file) => ({ ...file, path: pdfPath })), { ...config, pdfMaxPagesPerJob: 1 }),
      /limite per elaborazione è 1/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
