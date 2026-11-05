import path from 'node:path';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { analyzeImages } from './ai/index.js';
import { buildFinalMarkdown } from './markdown.js';
import { selectWikilinks, saveNotesToVault } from './vault.js';
import { analyzeVaultStructure, matchSubject, suggestedSubjectPath } from './vault-analysis.js';
import { materializeFiguresForNotes } from './figures.js';
import { preparePdfInputs } from './pdf.js';
import { newId, nowIso, uniqueStrings } from './utils.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sumUsageList(usages) {
  const valid = usages.filter(Boolean);
  if (!valid.length) return null;
  const total = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    batchRequests: 0,
    batchApi: false
  };
  for (const usage of valid) {
    total.inputTokens += Number(usage.inputTokens) || 0;
    total.outputTokens += Number(usage.outputTokens) || 0;
    total.totalTokens += Number(usage.totalTokens) || (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
    total.cachedInputTokens += Number(usage.cachedInputTokens) || 0;
    total.batchRequests += Number(usage.batchRequests) || 0;
    total.batchApi = total.batchApi || Boolean(usage.batchApi);
  }
  return total;
}

function mergeNotesByTitle(notes) {
  const result = [];
  const byTitle = new Map();
  for (const note of notes) {
    const key = String(note.title || '').trim().toLocaleLowerCase('it') || `nota-${result.length + 1}`;
    const existing = byTitle.get(key);
    if (!existing) {
      const copy = {
        ...note,
        tags: [...(note.tags || [])],
        aliases: [...(note.aliases || [])],
        keyConcepts: [...(note.keyConcepts || [])],
        conceptRelations: [...(note.conceptRelations || [])],
        figures: [...(note.figures || [])],
        links: [...(note.links || [])],
        warnings: [...(note.warnings || [])]
      };
      byTitle.set(key, copy);
      result.push(copy);
      continue;
    }
    existing.markdown = [existing.markdown, note.markdown].filter(Boolean).join('\n\n');
    existing.extractedText = [existing.extractedText, note.extractedText].filter(Boolean).join('\n\n');
    existing.summary = existing.summary || note.summary || '';
    existing.tags = uniqueStrings([...(existing.tags || []), ...(note.tags || [])]);
    existing.aliases = uniqueStrings([...(existing.aliases || []), ...(note.aliases || [])]);
    existing.keyConcepts = uniqueStrings([...(existing.keyConcepts || []), ...(note.keyConcepts || [])]);
    existing.conceptRelations = [...(existing.conceptRelations || []), ...(note.conceptRelations || [])];
    existing.figures = [...(existing.figures || []), ...(note.figures || [])];
    existing.links = [...(existing.links || []), ...(note.links || [])];
    existing.warnings = uniqueStrings([...(existing.warnings || []), ...(note.warnings || [])]);
    const values = [existing.confidence, note.confidence].map(Number).filter(Number.isFinite);
    existing.confidence = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : existing.confidence;
  }
  return result;
}

function remapPartResult(result, part) {
  const notes = (result.notes || []).map((note) => ({
    ...note,
    figures: (note.figures || []).map((figure) => {
      const local = Number(figure.sourceImageIndex);
      const mapped = Number.isInteger(local) && part.imageInputs[local]
        ? part.imageInputs[local].inputIndex
        : (part.imageInputs.length === 1 ? part.imageInputs[0].inputIndex : 0);
      return { ...figure, sourceImageIndex: mapped };
    })
  }));
  const analyzed = [...new Set((result.analyzedImageIndexes || [])
    .map((local) => part.imageInputs[Number(local)]?.inputIndex)
    .filter(Number.isInteger))];
  return {
    ...result,
    notes,
    noteCount: notes.length,
    figures: notes.flatMap((note) => note.figures || []),
    analyzedImageIndexes: analyzed
  };
}

function mergePartResults(results) {
  const notes = mergeNotesByTitle(results.flatMap((result) => result.notes || []));
  const first = results[0] || {};
  const confidenceValues = notes.map((note) => Number(note.confidence)).filter(Number.isFinite);
  const models = uniqueStrings(results.map((result) => result.modelUsed).filter(Boolean));
  return {
    notes,
    noteCount: notes.length,
    title: notes[0]?.title || first.title || '',
    course: first.course || '',
    subject: first.subject || '',
    subjectPath: first.subjectPath || '',
    date: first.date || '',
    tags: uniqueStrings(notes.flatMap((note) => note.tags || [])),
    aliases: uniqueStrings(notes.flatMap((note) => note.aliases || [])),
    summary: results.map((result) => result.summary).filter(Boolean).join(' '),
    extractedText: notes.map((note) => note.extractedText).filter(Boolean).join('\n\n'),
    keyConcepts: uniqueStrings(notes.flatMap((note) => note.keyConcepts || [])),
    conceptRelations: notes.flatMap((note) => note.conceptRelations || []),
    figures: notes.flatMap((note) => note.figures || []),
    markdown: notes[0]?.markdown || '',
    links: notes.flatMap((note) => note.links || []),
    confidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0.5,
    warnings: uniqueStrings(results.flatMap((result) => result.warnings || [])),
    analyzedImageIndexes: [...new Set(results.flatMap((result) => result.analyzedImageIndexes || []))],
    imageProcessing: results.flatMap((result) => result.imageProcessing || []),
    usage: sumUsageList(results.map((result) => result.usage)),
    modelUsed: models.length === 1 ? models[0] : models.join(' + '),
    primaryModel: first.primaryModel || first.modelUsed || '',
    fallbackUsed: results.some((result) => result.fallbackUsed),
    fallbackAttempted: results.some((result) => result.fallbackAttempted),
    fallbackReason: uniqueStrings(results.map((result) => result.fallbackReason).filter(Boolean)).join('; '),
    emergencyUsed: results.some((result) => result.emergencyUsed),
    perImageFallbackUsed: results.some((result) => result.perImageFallbackUsed),
    retryAttempts: Math.max(...results.map((result) => Number(result.retryAttempts) || 1))
  };
}

export function createWorker({ config, store }) {
  const queue = [];
  const enqueued = new Set();
  let running = false;
  let activePromise = null;

  async function resolveFiles(job) {
    return (job.source_files || []).map((file) => {
      const absolutePath = path.resolve(config.uploadDir, file.relativePath);
      if (!existsSync(absolutePath)) throw new Error(`File caricato non trovato: ${file.relativePath}`);
      return { ...file, absolutePath };
    });
  }

  async function processJob(jobId) {
    const job = store.getJob(jobId);
    if (!job) throw new Error('Job non trovato.');
    if (job.status === 'cancelled') return job;
    if (job.status === 'processing') return job;

    store.updateJob(jobId, {
      status: 'processing',
      error: null,
      extracted_text: null,
      markdown: null,
      result_json: null,
      links_json: [],
      warnings_json: [],
      confidence: null,
      processed_at: null,
      updated_at: nowIso()
    });
    try {
      const files = await resolveFiles(job);
      if (files.length === 0) throw new Error('Nessun file associato al job.');
      const preparedInputs = await preparePdfInputs({ files, config, jobId });
      const vaultAnalysis = analyzeVaultStructure(config.vaultPath, {
        subjectRoots: config.obsidianSubjectRoots
      });
      const vaultNotes = vaultAnalysis.notes.map((note) => ({
        title: note.basename,
        aliases: uniqueStrings([note.title, ...note.aliases]),
        tags: note.tags,
        relativePath: note.relativePath
      }));
      const matchedSubject = matchSubject(job.course, vaultAnalysis.subjects);
      const analysisParts = Array.isArray(preparedInputs.parts) && preparedInputs.parts.length
        ? preparedInputs.parts
        : [{ imageInputs: preparedInputs.imageInputs, pdfTextSections: preparedInputs.pdfTextSections }];
      const aiBudget = { calls: 0, max: Math.max(1, Number(config.aiMaxProviderCallsPerJob) || 12) };
      const partResults = [];
      for (const part of analysisParts) {
        const partResult = await analyzeImages({
          config,
          files,
          metadata: {
            course: job.course,
            date: job.lesson_date,
            title: job.requested_title,
            tags: job.user_tags || [],
            userNotes: job.user_notes,
            files
          },
          vaultNotes,
          vaultAnalysis,
          matchedSubject,
          aiFiles: part.imageInputs,
          pdfTextSections: part.pdfTextSections,
          budget: aiBudget
        });
        partResults.push(remapPartResult(partResult, part));
      }
      const aiResult = partResults.length === 1 ? partResults[0] : mergePartResults(partResults);
      aiResult.chunking = {
        partCount: analysisParts.length,
        parts: preparedInputs.stats?.parts || []
      };
      aiResult.warnings = uniqueStrings([...(aiResult.warnings || []), ...preparedInputs.warnings]);

      const resolvedSubject = matchedSubject || matchSubject(aiResult.subject, vaultAnalysis.subjects);
      const newSubjectPath = suggestedSubjectPath({
        subjectName: aiResult.subject || job.course,
        course: job.course,
        config
      });
      const destinationSubjectPath = resolvedSubject?.relativePath || newSubjectPath;
      const baseCourse = job.course || aiResult.course || '';
      const baseDate = job.lesson_date || aiResult.date || '';
      const baseSubject = resolvedSubject?.name || aiResult.subject || baseCourse;
      const aiNotes = Array.isArray(aiResult.notes) && aiResult.notes.length ? aiResult.notes : [aiResult];

      // Le note dello stesso gruppo possono collegarsi tra loro prima di essere salvate.
      const batchTargets = aiNotes.map((note, index) => ({
        title: note.title || `Nota ${index + 1}`,
        aliases: uniqueStrings([note.title, ...(note.aliases || [])]),
        tags: note.tags || [],
        relativePath: `__nuove_note__/${index}`
      }));
      const allLinkTargets = [...vaultNotes, ...batchTargets];

      const createdAt = nowIso();
      const preparedNotes = aiNotes.map((note, index) => {
        const title = note.title || (aiNotes.length === 1
          ? (job.requested_title || `Appunti ${baseCourse} ${baseDate}`.trim() || 'Appunti senza titolo')
          : `Nota ${index + 1}`);
        const links = selectWikilinks({
          aiLinks: note.links || [],
          markdown: note.markdown || '',
          course: baseCourse,
          title,
          notes: allLinkTargets,
          allowCreate: config.allowCreateMissingWikilinks
        });
        const noteTags = uniqueStrings([...(job.user_tags || []), ...(note.tags || [])]);
        const markdown = buildFinalMarkdown({
          aiResult: {
            ...note,
            title,
            aliases: uniqueStrings([title, ...(note.aliases || [])])
          },
          metadata: {
            title,
            course: baseCourse,
            subject: baseSubject,
            date: baseDate,
            tags: noteTags,
            fallbackContent: note.extractedText
          },
          links,
          warnings: [],
          createdAt,
          notes: allLinkTargets,
          allowCreate: config.allowCreateMissingWikilinks
        });
        return {
          title,
          summary: note.summary || '',
          tags: noteTags,
          aliases: uniqueStrings([title, ...(note.aliases || [])]),
          keyConcepts: note.keyConcepts || [],
          conceptRelations: note.conceptRelations || [],
          figures: note.figures || [],
          confidence: note.confidence,
          warnings: note.warnings || [],
          links,
          extractedText: note.extractedText || '',
          markdown
        };
      });

      const uniqueLinks = [];
      const seenLinks = new Set();
      for (const note of preparedNotes) {
        for (const link of note.links) {
          const key = String(link.target || '').toLocaleLowerCase('it');
          if (!key || seenLinks.has(key)) continue;
          seenLinks.add(key);
          uniqueLinks.push(link);
        }
      }
      const combinedWarnings = uniqueStrings([...(aiResult.warnings || []), ...preparedNotes.flatMap((note) => note.warnings)]);
      const resultJson = {
        title: preparedNotes.length === 1
          ? preparedNotes[0].title
          : `${preparedNotes.length} note — ${baseCourse || baseSubject || 'appunti'}`,
        noteCount: preparedNotes.length,
        notes: preparedNotes,
        course: baseCourse,
        subject: baseSubject,
        subjectPath: destinationSubjectPath,
        subjectIsNew: !resolvedSubject,
        date: baseDate,
        tags: uniqueStrings(preparedNotes.flatMap((note) => note.tags)),
        aliases: uniqueStrings(preparedNotes.flatMap((note) => note.aliases)),
        summary: aiResult.summary,
        keyConcepts: uniqueStrings(preparedNotes.flatMap((note) => note.keyConcepts)),
        conceptRelations: preparedNotes.flatMap((note) => note.conceptRelations),
        confidence: aiResult.confidence,
        warnings: combinedWarnings,
        links: uniqueLinks,
        ai: {
          primaryModel: aiResult.primaryModel || aiResult.modelUsed || config.aiModel,
          modelUsed: aiResult.modelUsed || config.aiModel,
          fallbackUsed: Boolean(aiResult.fallbackUsed),
          fallbackAttempted: Boolean(aiResult.fallbackAttempted),
          fallbackReason: aiResult.fallbackReason || '',
          retryAttempts: Number(aiResult.retryAttempts) || 1,
          perImageFallbackUsed: Boolean(aiResult.perImageFallbackUsed),
          emergencyUsed: Boolean(aiResult.emergencyUsed),
          usage: aiResult.usage || null,
          imageProcessing: aiResult.imageProcessing || [],
          analyzedImageIndexes: aiResult.analyzedImageIndexes || [],
          pdf: preparedInputs.stats,
          chunking: aiResult.chunking || null,
          inputImages: preparedInputs.imageInputs.map((input) => ({
            relativePath: input.relativePath,
            originalName: input.originalName,
            mimeType: input.mimeType,
            sourceFileIndex: input.sourceFileIndex,
            inputKind: input.inputKind,
            pdfPage: input.pdfPage
          }))
        }
      };

      try {
        const usageLogPath = path.join(config.projectRoot, 'data', 'ai-usage.jsonl');
        mkdirSync(path.dirname(usageLogPath), { recursive: true });
        appendFileSync(usageLogPath, JSON.stringify({
          jobId,
          createdAt,
          course: baseCourse,
          subject: baseSubject,
          fileCount: files.length,
          aiImageCount: preparedInputs.imageInputs.length,
          pdfPages: preparedInputs.stats.totalPages,
          noteCount: preparedNotes.length,
          ai: resultJson.ai
        }) + '\n');
      } catch (logError) {
        console.warn(`[usage] impossibile salvare il log token: ${logError.message}`);
      }

      store.updateJob(jobId, {
        status: 'completed',
        extracted_text: preparedNotes.map((note) => note.extractedText).filter(Boolean).join('\n\n'),
        markdown: preparedNotes[0]?.markdown || '',
        result_json: resultJson,
        links_json: uniqueLinks,
        warnings_json: combinedWarnings,
        confidence: aiResult.confidence,
        error: null,
        processed_at: nowIso()
      });

      if (config.autoSaveToVault) {
        const materializedNotes = await materializeFiguresForNotes({
          notes: preparedNotes,
          job,
          config,
          subjectPath: destinationSubjectPath
        });
        const saved = saveNotesToVault({
          vaultPath: config.vaultPath,
          notesSubdir: config.notesSubdir,
          relativeDir: destinationSubjectPath,
          notes: materializedNotes.map((note) => ({
            title: note.title,
            date: baseDate,
            markdown: note.markdown
          })),
          jobId,
          store,
          idGenerator: newId,
          subjectRoots: config.obsidianSubjectRoots
        });
        resultJson.notes = materializedNotes;
        resultJson.markdown = materializedNotes[0]?.markdown || '';
        store.updateJob(jobId, {
          markdown: resultJson.markdown,
          result_json: resultJson,
          vault_path: saved[0]?.relativePath || null,
          vault_paths_json: saved.map((item) => item.relativePath)
        });
      }
      return store.getJob(jobId);
    } catch (error) {
      store.updateJob(jobId, {
        status: 'failed',
        error: String(error?.message || error),
        processed_at: nowIso()
      });
      return store.getJob(jobId);
    }
  }

  async function drain() {
    while (queue.length > 0) {
      const id = queue.shift();
      enqueued.delete(id);
      try {
        await processJob(id);
      } catch (error) {
        store.updateJob(id, { status: 'failed', error: String(error?.message || error), updated_at: nowIso() });
      }
      if (config.workerPollMs > 0) await delay(10);
    }
  }

  function kick() {
    if (running || queue.length === 0) return;
    running = true;
    activePromise = drain().finally(() => {
      running = false;
      activePromise = null;
      kick();
    });
  }

  function enqueue(jobId) {
    if (!jobId || enqueued.has(jobId)) return;
    enqueued.add(jobId);
    queue.push(jobId);
    kick();
  }

  function remove(jobId) {
    enqueued.delete(jobId);
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i] === jobId) queue.splice(i, 1);
    }
  }

  async function waitForIdle() {
    while (running || queue.length > 0) {
      if (activePromise) await activePromise;
      else await delay(20);
    }
  }

  return { enqueue, remove, processJob, waitForIdle };
}
