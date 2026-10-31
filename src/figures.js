import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { isPathInside, sanitizeFilename, slugify, uniqueStrings } from './utils.js';

function normalizeBbox(value, metadata) {
  let x;
  let y;
  let width;
  let height;
  if (Array.isArray(value) && value.length >= 4) {
    [x, y, width, height] = value.map(Number);
  } else if (value && typeof value === 'object') {
    x = Number(value.x ?? value.left);
    y = Number(value.y ?? value.top);
    width = Number(value.width ?? value.w);
    height = Number(value.height ?? value.h);
  }
  if (![x, y, width, height].every(Number.isFinite)) return null;

  // Supporta sia coordinate normalizzate 0..1 sia coordinate in pixel.
  if (Math.max(x, y, width, height) > 1.5) {
    x /= metadata.width;
    y /= metadata.height;
    width /= metadata.width;
    height /= metadata.height;
  }

  const padding = 0.015;
  x = Math.max(0, x - padding);
  y = Math.max(0, y - padding);
  width = Math.min(1 - x, width + padding * 2);
  height = Math.min(1 - y, height + padding * 2);
  if (width <= 0.01 || height <= 0.01) return null;

  const left = Math.max(0, Math.floor(x * metadata.width));
  const top = Math.max(0, Math.floor(y * metadata.height));
  const right = Math.min(metadata.width, Math.ceil((x + width) * metadata.width));
  const bottom = Math.min(metadata.height, Math.ceil((y + height) * metadata.height));
  if (right - left < 24 || bottom - top < 24) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function figureEmbed(config, fileName, caption) {
  const relative = path.posix.join(config.obsidianAttachmentsDir, fileName);
  const cleanCaption = String(caption || '').replace(/\s+/g, ' ').trim();
  return `![[${relative}]]${cleanCaption ? `\n*${cleanCaption}*` : ''}`;
}

export async function materializeFiguresForNotes({ notes, job, config }) {
  const sourceFiles = (job.source_files || []).map((file) => path.resolve(config.uploadDir, file.relativePath));
  const attachmentsDir = path.resolve(config.vaultPath, config.obsidianAttachmentsDir);
  if (!isPathInside(config.vaultPath, attachmentsDir) && attachmentsDir !== path.resolve(config.vaultPath)) {
    throw new Error('La cartella allegati configurata non è valida.');
  }
  mkdirSync(attachmentsDir, { recursive: true });

  const result = [];
  for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
    const note = notes[noteIndex];
    let markdown = String(note.markdown || '');
    const figures = Array.isArray(note.figures) ? note.figures : [];
    const unplaced = [];
    const materializedFigures = [];

    for (let figureIndex = 0; figureIndex < figures.length; figureIndex += 1) {
      const figure = figures[figureIndex] || {};
      const sourceIndex = Number.isInteger(Number(figure.sourceImageIndex)) ? Number(figure.sourceImageIndex) : 0;
      const sourcePath = sourceFiles[sourceIndex] || sourceFiles[0];
      if (!sourcePath || !existsSync(sourcePath)) {
        unplaced.push(`Figura non disponibile: ${figure.caption || figure.id || figureIndex + 1}`);
        continue;
      }
      try {
        const image = sharp(sourcePath).rotate();
        const metadata = await image.metadata();
        const bbox = normalizeBbox(figure.bbox, metadata);
        if (!bbox) {
          unplaced.push(`Coordinate non valide per la figura: ${figure.caption || figure.id || figureIndex + 1}`);
          continue;
        }
        const caption = String(figure.caption || figure.label || `Figura ${figureIndex + 1}`).trim();
        const base = slugify(caption || figure.kind || 'figura');
        const fileName = sanitizeFilename(
          `fig-${String(job.id).slice(0, 8)}-n${noteIndex + 1}-f${figureIndex + 1}-${base}.png`,
          `figura-${figureIndex + 1}.png`
        );
        const destination = path.join(attachmentsDir, fileName);
        await sharp(sourcePath)
          .rotate()
          .extract(bbox)
          .png({ quality: 92 })
          .toFile(destination);
        const embed = figureEmbed(config, fileName, caption);
        const figId = String(figure.id || '').trim();
        const placeholderPatterns = figId
          ? [
              new RegExp(`\\{\\{\\s*fig(?:ure)?\\s*:\\s*${figId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'gi'),
              new RegExp(`\\{\\{\\s*${figId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'gi')
            ]
          : [];
        let placed = false;
        for (const pattern of placeholderPatterns) {
          const before = markdown;
          markdown = markdown.replace(pattern, embed);
          if (markdown !== before) {
            placed = true;
            break;
          }
        }
        if (!placed) unplaced.push(embed);
        materializedFigures.push({
          ...figure,
          assetPath: path.posix.join(config.obsidianAttachmentsDir, fileName),
          caption,
          embed
        });
      } catch (error) {
        unplaced.push(`Ritaglio non riuscito: ${figure.caption || figure.id || figureIndex + 1} (${error.message})`);
      }
    }

    if (unplaced.length > 0) {
      const unplacedEmbeds = unplaced.filter((item) => item.startsWith('!['));
      const warnings = unplaced.filter((item) => !item.startsWith('!['));
      if (unplacedEmbeds.length > 0) {
        markdown = `${markdown.replace(/\s+$/, '')}\n\n## Figure\n\n${unplacedEmbeds.join('\n\n')}\n`;
      }
      if (warnings.length > 0) {
        note.warnings = uniqueStrings([...(note.warnings || []), ...warnings]);
      }
    }

    result.push({
      ...note,
      markdown,
      figures: materializedFigures
    });
  }

  return result;
}
