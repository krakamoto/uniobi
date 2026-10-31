import path from 'node:path';
import { existsSync } from 'node:fs';
import { analyzeImages } from './ai/index.js';
import { buildFinalMarkdown } from './markdown.js';
import { selectWikilinks, saveNoteToVault } from './vault.js';
import { analyzeVaultStructure, matchSubject } from './vault-analysis.js';
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

      const finalTitle = aiResult.title || job.requested_title || `Appunti ${job.course || ''} ${job.lesson_date || ''}`.trim() || 'Appunti senza titolo';
      const resolvedSubject = matchedSubject || matchSubject(aiResult.subject, vaultAnalysis.subjects);
      const links = selectWikilinks({
        aiLinks: aiResult.links,
        markdown: aiResult.markdown,
        course: job.course || aiResult.course,
        title: finalTitle,
        notes: vaultNotes,
        allowCreate: config.allowCreateMissingWikilinks
      });

      const createdAt = nowIso();
      const markdown = buildFinalMarkdown({
        aiResult,
        metadata: {
          title: finalTitle,
          course: job.course || aiResult.course,
          subject: resolvedSubject?.name || aiResult.subject,
          date: job.lesson_date || aiResult.date,
          tags: uniqueStrings([...(job.user_tags || []), ...aiResult.tags]),
          fallbackContent: aiResult.extractedText
        },
        links,
        warnings: [],
        createdAt,
        notes: vaultNotes,
        allowCreate: config.allowCreateMissingWikilinks
      });

      const resultJson = {
        title: finalTitle,
        course: job.course || aiResult.course || '',
        subject: resolvedSubject?.name || aiResult.subject || '',
        subjectPath: resolvedSubject?.relativePath || '',
        date: job.lesson_date || aiResult.date || '',
        tags: uniqueStrings([...(job.user_tags || []), ...aiResult.tags]),
        aliases: aiResult.aliases,
        summary: aiResult.summary,
        keyConcepts: aiResult.keyConcepts,
        conceptRelations: aiResult.conceptRelations,
        confidence: aiResult.confidence,
        warnings: aiResult.warnings,
        links,
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
        extracted_text: aiResult.extractedText || aiResult.markdown,
        markdown,
        result_json: resultJson,
        links_json: links,
        warnings_json: aiResult.warnings,
        confidence: aiResult.confidence,
        error: null,
        processed_at: nowIso()
      });

      if (config.autoSaveToVault) {
        const saved = saveNoteToVault({
          vaultPath: config.vaultPath,
          notesSubdir: config.notesSubdir,
          relativeDir: resolvedSubject?.relativePath,
          title: finalTitle,
          date: job.lesson_date,
          markdown,
          jobId,
          store,
          idGenerator: newId,
          subjectRoots: config.obsidianSubjectRoots
        });
        store.updateJob(jobId, { vault_path: saved.relativePath });
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
