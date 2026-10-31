import path from 'node:path';
import { existsSync } from 'node:fs';
import { analyzeImages } from './ai/index.js';
import { buildFinalMarkdown } from './markdown.js';
import { selectWikilinks, saveNotesToVault } from './vault.js';
import { analyzeVaultStructure, matchSubject, suggestedSubjectPath } from './vault-analysis.js';
import { materializeFiguresForNotes } from './figures.js';
import { newId, nowIso, uniqueStrings } from './utils.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      const aiResult = await analyzeImages({
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
        matchedSubject
      });

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
          fallbackReason: aiResult.fallbackReason || ''
        }
      };

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

  async function waitForIdle() {
    while (running || queue.length > 0) {
      if (activePromise) await activePromise;
      else await delay(20);
    }
  }

  return { enqueue, processJob, waitForIdle };
}
