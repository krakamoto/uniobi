import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { materializeFiguresForNotes } from '../src/figures.js';

test('ritaglia una figura dall’immagine originale e sostituisce il placeholder', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-figures-'));
  const uploadDir = path.join(root, 'uploads');
  const vaultPath = path.join(root, 'vault');
  const jobId = 'job-figures-1234';
  const jobUploadDir = path.join(uploadDir, jobId);
  mkdirSync(jobUploadDir, { recursive: true });
  mkdirSync(vaultPath, { recursive: true });
  const source = path.join(jobUploadDir, 'image-1.png');
  await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
  }).png().toFile(source);

  const config = {
    uploadDir,
    vaultPath,
    obsidianAttachmentsDir: 'Allegati/UniAi'
  };
  const job = {
    id: jobId,
    source_files: [{ relativePath: `${jobId}/image-1.png`, mimeType: 'image/png' }]
  };
  try {
    const notes = await materializeFiguresForNotes({
      notes: [{
        title: 'Schema',
        markdown: '# Schema\n\n{{fig1}}\n',
        figures: [{
          id: 'fig1',
          sourceImageIndex: 0,
          bbox: [0, 0, 0.5, 1],
          caption: 'Metà sinistra del grafico',
          kind: 'diagram'
        }]
      }],
      job,
      config
    });
    assert.match(notes[0].markdown, /!\[\[Allegati\/UniAi\/fig-job-figu-n1-f1-meta-sinistra-del-grafico\.png\]\]/);
    assert.match(notes[0].markdown, /Metà sinistra del grafico/);
    assert.equal(notes[0].figures.length, 1);
    const assetPath = path.join(vaultPath, notes[0].figures[0].assetPath);
    assert.ok(existsSync(assetPath));
    const metadata = await sharp(assetPath).metadata();
    assert.ok(metadata.width >= 100 && metadata.width <= 110);
    assert.equal(metadata.height, 100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
