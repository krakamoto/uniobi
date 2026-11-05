import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { isPathInside } from './utils.js';

const execFileAsync = promisify(execFile);
export const PDF_MIME_TYPE = 'application/pdf';

function extensionOf(file) {
  return path.extname(String(file?.originalName || file?.originalname || file?.relativePath || file?.path || '')).toLowerCase();
}

export function isPdfFile(file) {
  const mime = String(file?.mimeType || file?.mimetype || '').toLowerCase();
  return mime === PDF_MIME_TYPE || extensionOf(file) === '.pdf';
}

async function runPdfCommand(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      timeout: options.timeout || 120000,
      maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
      windowsHide: true
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Il supporto PDF richiede il comando "${command}" (pacchetto poppler-utils) installato sul server.`);
    }
    const detail = String(error?.stderr || error?.message || '').trim().slice(0, 500);
    throw new Error(`Elaborazione PDF non riuscita (${command}): ${detail || 'errore sconosciuto'}`);
  }
}

export async function inspectPdf(absolutePath) {
  if (!absolutePath || !existsSync(absolutePath)) throw new Error('File PDF non trovato.');
  const stats = statSync(absolutePath);
  if (!stats.isFile() || stats.size === 0) throw new Error('File PDF vuoto o non valido.');
  const { stdout } = await runPdfCommand('pdfinfo', [absolutePath], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  const pagesMatch = String(stdout || '').match(/^Pages:\s+(\d+)\s*$/mi);
  const encryptedMatch = String(stdout || '').match(/^Encrypted:\s+(.+)$/mi);
  const pages = Number(pagesMatch?.[1]);
  if (!Number.isInteger(pages) || pages < 1) throw new Error('Impossibile determinare il numero di pagine del PDF.');
  if (encryptedMatch && !/^no\b/i.test(encryptedMatch[1].trim())) {
    throw new Error('Il PDF è protetto da password e non può essere analizzato. Rimuovi la protezione e riprova.');
  }
  return {
    pages,
    fileSize: stats.size,
    encrypted: Boolean(encryptedMatch && !/^no\b/i.test(encryptedMatch[1].trim()))
  };
}

export async function extractPdfTextPages(absolutePath, expectedPages = 0) {
  const args = ['-layout', '-enc', 'UTF-8'];
  if (expectedPages > 0) args.push('-f', '1', '-l', String(expectedPages));
  args.push(absolutePath, '-');
  const { stdout } = await runPdfCommand('pdftotext', args, {
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024
  });
  const pages = String(stdout || '').split('\f');
  if (pages.length > 0 && pages[pages.length - 1].trim() === '') pages.pop();
  return pages;
}

export async function renderPdfPage({ absolutePath, pageNumber, outputPath, maxSide = 1600, jpegQuality = 88 }) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const side = Math.max(512, Math.min(4096, Number(maxSide) || 1600));
  const quality = Math.max(40, Math.min(100, Number(jpegQuality) || 88));
  const prefix = outputPath.replace(/\.jpe?g$/i, '');
  await runPdfCommand('pdftoppm', [
    '-f', String(pageNumber),
    '-l', String(pageNumber),
    '-singlefile',
    '-jpeg',
    '-jpegopt', `quality=${quality}`,
    '-scale-to', String(side),
    absolutePath,
    prefix
  ], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const renderedPath = `${prefix}.jpg`;
  if (!existsSync(renderedPath)) throw new Error(`Rendering della pagina ${pageNumber} non riuscito.`);
  return renderedPath;
}

function meaningfulTextLength(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().length;
}

function figurePageHeuristic(text) {
  return /(figura|fig\.|schema|diagramma|grafico|tabella|circuito|immagine|foto)/i.test(String(text || ''));
}

async function detectEmbeddedImagePages(absolutePath) {
  try {
    const { stdout } = await runPdfCommand('pdfimages', ['-list', absolutePath], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const pages = new Set();
    for (const line of String(stdout || '').split('\n')) {
      const match = line.match(/^\s*(\d+)\s+\d+\s+/);
      if (match) pages.add(Number(match[1]));
    }
    return pages;
  } catch {
    return new Set();
  }
}

export async function validatePdfUploads(files, config) {
  const pdfFiles = (files || []).filter(isPdfFile);
  if (pdfFiles.length === 0) return { pdfCount: 0, totalPages: 0, files: [] };
  const maxPerFile = Math.max(1, Number(config.pdfMaxPagesPerFile) || 30);
  const maxPerJob = Math.max(1, Number(config.pdfMaxPagesPerJob) || 24);
  const inspected = [];
  let totalPages = 0;
  for (const file of pdfFiles) {
    const info = await inspectPdf(file.absolutePath || file.path);
    if (info.pages > maxPerFile) {
      throw new Error(`Il PDF "${file.originalName || file.originalname || path.basename(file.path)}" ha ${info.pages} pagine. Il limite per file è ${maxPerFile}; suddividilo in PDF più piccoli.`);
    }
    totalPages += info.pages;
    inspected.push({ file, ...info });
  }
  if (totalPages > maxPerJob) {
    throw new Error(`I PDF caricati contengono ${totalPages} pagine in totale. Il limite per elaborazione è ${maxPerJob}; carica meno pagine per ridurre i token e i tempi di analisi.`);
  }
  return { pdfCount: inspected.length, totalPages, files: inspected };
}

export async function preparePdfInputs({ files, config, jobId }) {
  const maxPerFile = Math.max(1, Number(config.pdfMaxPagesPerFile) || 60);
  const maxPerJob = Math.max(1, Number(config.pdfMaxPagesPerJob) || 60);
  const maxAiImages = Math.max(1, Number(config.maxAiImagesPerJob) || 50);
  const minTextChars = Math.max(20, Number(config.pdfTextPageMinChars) || 80);
  const maxTextChars = Math.max(1000, Number(config.pdfMaxTextCharsPerJob) || 120000);
  const recommendedPages = Math.max(1, Number(config.pdfRecommendedPagesPerJob) || 6);
  const pagesPerAnalysis = Math.max(1, Number(config.pdfPagesPerAnalysis) || recommendedPages);
  const maxAnalysisParts = Math.max(1, Number(config.pdfMaxAnalysisParts) || 10);
  const renderSide = Math.max(512, Number(config.pdfRenderMaxSide) || Number(config.imageMaxSide) || 1600);
  const renderQuality = Math.max(40, Math.min(100, Number(config.pdfJpegQuality) || Number(config.imageJpegQuality) || 88));
  const renderFigurePages = config.pdfRenderFigurePages !== false;
  const figureRenderSide = Math.max(512, Number(config.pdfFigureRenderMaxSide) || 1400);
  const pageOutputDir = path.resolve(config.uploadDir, jobId, '.pdf-pages');
  const imageInputs = [];
  const pdfTextSections = [];
  const warnings = [];
  const pdfFiles = [];
  const parts = [];
  let photoBuffer = [];
  let totalPdfPages = 0;
  let renderedPages = 0;
  let figurePages = 0;
  let textPages = 0;
  let textCharacters = 0;

  function pushPart(part) {
    if (!part.imageInputs.length && !part.pdfTextSections.length) return;
    part.index = parts.length;
    if (part.kind === 'pdf') {
      part.label = `${part.fileName} · pagine ${part.pageStart}–${part.pageEnd}`;
    } else {
      part.label = `Foto (${part.imageInputs.length})`;
    }
    parts.push(part);
    if (parts.length > maxAnalysisParts) {
      throw new Error(`Il PDF richiede ${parts.length} parti di analisi, oltre il limite di ${maxAnalysisParts}. Riduci il numero di pagine o dividi il PDF.`);
    }
  }

  function flushPhotos() {
    if (!photoBuffer.length) return;
    pushPart({ kind: 'images', imageInputs: photoBuffer, pdfTextSections: [] });
    photoBuffer = [];
  }

  for (let sourceFileIndex = 0; sourceFileIndex < files.length; sourceFileIndex += 1) {
    const file = files[sourceFileIndex];
    if (!isPdfFile(file)) {
      const inputIndex = imageInputs.length;
      const input = {
        ...file,
        inputIndex,
        sourceFileIndex,
        inputKind: 'image',
        displayName: file.originalName || path.basename(file.absolutePath),
        pdfPage: null
      };
      imageInputs.push(input);
      photoBuffer.push(input);
      continue;
    }

    flushPhotos();
    const absolutePath = file.absolutePath || file.path;
    const info = await inspectPdf(absolutePath);
    if (info.pages > maxPerFile) {
      throw new Error(`Il PDF "${file.originalName || path.basename(absolutePath)}" ha ${info.pages} pagine. Il limite per file è ${maxPerFile}.`);
    }
    totalPdfPages += info.pages;
    if (totalPdfPages > maxPerJob) {
      throw new Error(`I PDF contengono ${totalPdfPages} pagine in totale. Il limite per elaborazione è ${maxPerJob}.`);
    }

    let textPagesRaw = [];
    if (config.pdfTextExtractionEnabled !== false) {
      try {
        textPagesRaw = await extractPdfTextPages(absolutePath, info.pages);
      } catch (error) {
        warnings.push(`Testo PDF non estraibile per "${file.originalName || path.basename(absolutePath)}": ${error.message}. Le pagine verranno inviate come immagini.`);
      }
    }

    const fileName = file.originalName || path.basename(absolutePath);
    const embeddedImagePages = renderFigurePages ? await detectEmbeddedImagePages(absolutePath) : new Set();
    const fileStats = { name: fileName, pages: info.pages, textPages: 0, renderedPages: 0, figurePages: 0 };
    let currentPart = null;

    for (let page = 1; page <= info.pages; page += 1) {
      if (!currentPart || (page - 1) % pagesPerAnalysis === 0) {
        if (currentPart) pushPart(currentPart);
        currentPart = {
          kind: 'pdf',
          fileName,
          pageStart: page,
          pageEnd: page,
          imageInputs: [],
          pdfTextSections: []
        };
      }
      currentPart.pageEnd = page;

      const rawText = String(textPagesRaw[page - 1] || '').trim();
      if (meaningfulTextLength(rawText) >= minTextChars) {
        const pageText = rawText.slice(0, 30000);
        textCharacters += pageText.length;
        if (textCharacters > maxTextChars) {
          throw new Error(`Il testo estratto dai PDF supera il limite di ${maxTextChars} caratteri per elaborazione. Suddividi il PDF in più attività.`);
        }
        const section = {
          sourceFileIndex,
          fileName,
          pageNumber: page,
          pageCount: info.pages,
          text: pageText
        };
        pdfTextSections.push(section);
        currentPart.pdfTextSections.push(section);
        textPages += 1;
        fileStats.textPages += 1;

        // Pagine digitali con immagini incorporate o riferimenti a figure:
        // aggiungiamo una versione raster della pagina per permettere il ritaglio.
        if (renderFigurePages && (embeddedImagePages.has(page) || figurePageHeuristic(pageText))) {
          if (imageInputs.length >= maxAiImages) {
            throw new Error(`Troppe immagini da inviare all'AI (${maxAiImages}). Riduci il numero di pagine PDF o di foto per singola elaborazione.`);
          }
          const figureOutputPath = path.join(pageOutputDir, `pdf-${String(sourceFileIndex + 1).padStart(2, '0')}-figure-page-${String(page).padStart(3, '0')}.jpg`);
          if (!isPathInside(config.uploadDir, figureOutputPath)) throw new Error('Percorso temporaneo figura PDF non valido.');
          await renderPdfPage({ absolutePath, pageNumber: page, outputPath: figureOutputPath, maxSide: figureRenderSide, jpegQuality: renderQuality });
          const figureInputIndex = imageInputs.length;
          const figureInput = {
            absolutePath: figureOutputPath,
            relativePath: path.relative(config.uploadDir, figureOutputPath).split(path.sep).join('/'),
            originalName: `${fileName} — figura pagina ${page}`,
            mimeType: 'image/jpeg',
            size: statSync(figureOutputPath).size,
            inputIndex: figureInputIndex,
            sourceFileIndex,
            inputKind: 'pdf-figure-page',
            displayName: `${fileName} — figura pagina ${page}`,
            pdfPage: page
          };
          imageInputs.push(figureInput);
          currentPart.imageInputs.push(figureInput);
          figurePages += 1;
          fileStats.figurePages += 1;
        }
        continue;
      }

      if (imageInputs.length >= maxAiImages) {
        throw new Error(`Troppe immagini da inviare all'AI (${maxAiImages}). Riduci il numero di pagine PDF o di foto per singola elaborazione.`);
      }
      const outputPath = path.join(pageOutputDir, `pdf-${String(sourceFileIndex + 1).padStart(2, '0')}-page-${String(page).padStart(3, '0')}.jpg`);
      if (!isPathInside(config.uploadDir, outputPath)) throw new Error('Percorso temporaneo PDF non valido.');
      await renderPdfPage({ absolutePath, pageNumber: page, outputPath, maxSide: renderSide, jpegQuality: renderQuality });
      const inputIndex = imageInputs.length;
      const input = {
        absolutePath: outputPath,
        relativePath: path.relative(config.uploadDir, outputPath).split(path.sep).join('/'),
        originalName: `${fileName} — pagina ${page}`,
        mimeType: 'image/jpeg',
        size: statSync(outputPath).size,
        inputIndex,
        sourceFileIndex,
        inputKind: 'pdf-page',
        displayName: `${fileName} — pagina ${page}`,
        pdfPage: page
      };
      imageInputs.push(input);
      currentPart.imageInputs.push(input);
      renderedPages += 1;
      fileStats.renderedPages += 1;
    }
    if (currentPart) pushPart(currentPart);
    pdfFiles.push(fileStats);
  }

  flushPhotos();
  if (imageInputs.length > maxAiImages) {
    throw new Error(`Troppe immagini da inviare all'AI (${maxAiImages}). Riduci il numero di file o di pagine PDF.`);
  }
  if (totalPdfPages > recommendedPages) {
    warnings.push(`PDF: ${totalPdfPages} pagine divise automaticamente in ${parts.length} parti da massimo ${pagesPerAnalysis} pagine.`);
  }

  return {
    imageInputs,
    pdfTextSections,
    parts,
    warnings,
    stats: {
      pdfCount: pdfFiles.length,
      totalPages: totalPdfPages,
      renderedPages,
      figurePages,
      textPages,
      recommendedPages,
      pagesPerAnalysis,
      analysisParts: parts.length,
      parts: parts.map((part) => ({
        index: part.index,
        label: part.label,
        kind: part.kind,
        pageStart: part.pageStart ?? null,
        pageEnd: part.pageEnd ?? null,
        imageCount: part.imageInputs.length,
        textPageCount: part.pdfTextSections.length
      })),
      files: pdfFiles
    }
  };
}
