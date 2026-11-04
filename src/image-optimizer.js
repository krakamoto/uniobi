import sharp from 'sharp';

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function detectContentBox(imageBuffer, options = {}) {
  const analysisSide = clamp(Number(options.analysisSide) || 640, 256, 1200);
  const threshold = clamp(Number(options.threshold) || 24, 8, 80);
  const paddingRatio = clamp(Number(options.paddingRatio) || 0.02, 0, 0.1);
  const maxInkLossRatio = clamp(Number(options.maxInkLossRatio) || 0.02, 0, 0.1);
  const minContentRatio = clamp(Number(options.minContentRatio) || 0.08, 0.01, 0.8);

  const { data, info } = await sharp(imageBuffer)
    .flatten({ background: '#ffffff' })
    .resize({ width: analysisSide, height: analysisSide, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  if (!width || !height) throw new Error('Immagine non valida per il rilevamento contenuto.');

  const borderR = [];
  const borderG = [];
  const borderB = [];
  const borderSize = Math.max(2, Math.floor(Math.min(width, height) * 0.015));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= borderSize && x < width - borderSize && y >= borderSize && y < height - borderSize) continue;
      const offset = (y * width + x) * 3;
      borderR.push(data[offset]);
      borderG.push(data[offset + 1]);
      borderB.push(data[offset + 2]);
    }
  }
  const bgR = median(borderR);
  const bgG = median(borderG);
  const bgB = median(borderB);

  const mask = new Uint8Array(width * height);
  const rowCounts = new Uint32Array(height);
  const colCounts = new Uint32Array(width);
  let inkTotal = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const diff = Math.max(
        Math.abs(data[offset] - bgR),
        Math.abs(data[offset + 1] - bgG),
        Math.abs(data[offset + 2] - bgB)
      );
      if (diff > threshold) {
        mask[y * width + x] = 1;
        rowCounts[y] += 1;
        colCounts[x] += 1;
        inkTotal += 1;
      }
    }
  }

  if (inkTotal < Math.max(16, width * height * 0.0005)) {
    return {
      applied: false,
      reason: 'contenuto insufficiente per un crop sicuro',
      metrics: { width, height, inkTotal, threshold, background: [bgR, bgG, bgB] }
    };
  }

  const rowMin = Math.max(2, Math.floor(width * 0.004));
  const colMin = Math.max(2, Math.floor(height * 0.004));
  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;
  while (top < height && rowCounts[top] < rowMin) top += 1;
  while (bottom >= top && rowCounts[bottom] < rowMin) bottom -= 1;
  while (left < width && colCounts[left] < colMin) left += 1;
  while (right >= left && colCounts[right] < colMin) right -= 1;
  if (top > bottom || left > right) {
    return {
      applied: false,
      reason: 'bounding box non rilevato',
      metrics: { width, height, inkTotal, threshold, background: [bgR, bgG, bgB] }
    };
  }

  const padX = Math.floor(width * paddingRatio);
  const padY = Math.floor(height * paddingRatio);
  left = clamp(left - padX, 0, width - 1);
  right = clamp(right + padX, 0, width - 1);
  top = clamp(top - padY, 0, height - 1);
  bottom = clamp(bottom + padY, 0, height - 1);

  let inkInside = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (mask[y * width + x]) inkInside += 1;
    }
  }
  const inkLossRatio = inkTotal ? (inkTotal - inkInside) / inkTotal : 1;
  const contentRatio = ((right - left + 1) * (bottom - top + 1)) / (width * height);
  const metrics = {
    width,
    height,
    threshold,
    background: [bgR, bgG, bgB],
    inkTotal,
    inkInside,
    inkLossRatio,
    contentRatio: Number(contentRatio.toFixed(4))
  };

  if (contentRatio >= 0.985) {
    return { applied: false, reason: 'contenuto già esteso a tutta la pagina', metrics };
  }
  if (contentRatio < minContentRatio) {
    return { applied: false, reason: 'crop troppo aggressivo', metrics };
  }
  if (inkLossRatio > maxInkLossRatio) {
    return { applied: false, reason: `perdita eccessiva di contenuto (${(inkLossRatio * 100).toFixed(2)}%)`, metrics };
  }

  return { applied: true, box: { left, top, width: right - left + 1, height: bottom - top + 1 }, metrics };
}

export async function optimizeImageForAi(filePath, options = {}) {
  const maxSide = clamp(Number(options.maxSide) || 1600, 512, 4096);
  const quality = clamp(Number(options.quality) || 88, 40, 100);
  const cropEnabled = options.cropEnabled !== false;
  const oriented = await sharp(filePath).rotate().toBuffer({ resolveWithObject: true });
  const originalWidth = oriented.info.width;
  const originalHeight = oriented.info.height;
  let detection = { applied: false, reason: 'crop disabilitato', metrics: {} };
  let cropBox = null;

  if (cropEnabled) {
    try {
      detection = await detectContentBox(oriented.data, {
        analysisSide: options.analysisSide,
        threshold: options.threshold,
        paddingRatio: options.paddingRatio,
        maxInkLossRatio: options.maxInkLossRatio,
        minContentRatio: options.minContentRatio
      });
      if (detection.applied) {
        const scaleX = originalWidth / detection.metrics.width;
        const scaleY = originalHeight / detection.metrics.height;
        cropBox = {
          left: clamp(Math.floor(detection.box.left * scaleX), 0, originalWidth - 1),
          top: clamp(Math.floor(detection.box.top * scaleY), 0, originalHeight - 1),
          width: clamp(Math.ceil(detection.box.width * scaleX), 1, originalWidth),
          height: clamp(Math.ceil(detection.box.height * scaleY), 1, originalHeight)
        };
        cropBox.width = Math.min(cropBox.width, originalWidth - cropBox.left);
        cropBox.height = Math.min(cropBox.height, originalHeight - cropBox.top);
      }
    } catch (error) {
      detection = { applied: false, reason: `crop non disponibile: ${error.message}`, metrics: {} };
      cropBox = null;
    }
  }

  let pipeline = sharp(oriented.data);
  if (cropBox) pipeline = pipeline.extract(cropBox);
  const result = await pipeline
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    mimeType: 'image/jpeg',
    width: result.info.width,
    height: result.info.height,
    originalWidth,
    originalHeight,
    cropApplied: Boolean(cropBox),
    cropBox,
    cropReason: detection.reason || '',
    cropMetrics: detection.metrics || {},
    maxSide,
    quality,
    outputBytes: result.data.length
  };
}
