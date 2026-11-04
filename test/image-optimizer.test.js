import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { optimizeImageForAi } from '../src/image-optimizer.js';

test('ottimizzatore ritaglia i margini e limita la risoluzione', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-image-optimizer-'));
  const imagePath = path.join(root, 'notes.png');
  const svg = Buffer.from(`<svg width="1200" height="900" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <rect x="300" y="250" width="520" height="340" fill="black"/>
    <rect x="340" y="290" width="440" height="20" fill="white"/>
    <rect x="340" y="340" width="380" height="20" fill="white"/>
    <rect x="340" y="390" width="420" height="20" fill="white"/>
  </svg>`);
  writeFileSync(imagePath, await sharp(svg).png().toBuffer());
  try {
    const optimized = await optimizeImageForAi(imagePath, {
      maxSide: 800,
      quality: 88,
      cropEnabled: true,
      maxInkLossRatio: 0.02,
      minContentRatio: 0.08
    });
    assert.equal(optimized.originalWidth, 1200);
    assert.equal(optimized.originalHeight, 900);
    assert.equal(optimized.cropApplied, true);
    assert.ok(optimized.cropBox.width < 1200);
    assert.ok(optimized.cropBox.height < 900);
    assert.ok(optimized.width <= 800);
    assert.ok(optimized.height <= 800);
    assert.ok(optimized.cropMetrics.inkLossRatio <= 0.02);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ottimizzatore non ritaglia un’immagine senza contenuto sufficiente', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'uniai-image-blank-'));
  const imagePath = path.join(root, 'blank.png');
  writeFileSync(imagePath, await sharp({ create: { width: 900, height: 700, channels: 3, background: '#ffffff' } }).png().toBuffer());
  try {
    const optimized = await optimizeImageForAi(imagePath, {
      maxSide: 600,
      quality: 85,
      cropEnabled: true
    });
    assert.equal(optimized.cropApplied, false);
    assert.equal(optimized.width, 600);
    assert.ok(optimized.cropReason.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
