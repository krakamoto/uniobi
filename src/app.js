import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { newId, nowIso, isPathInside, uniqueStrings, parseJsonSafe } from './utils.js';
import { saveNotesToVault, vaultIsWritable } from './vault.js';
import { createWebdavHandler } from './webdav.js';
import { analyzeVaultStructure, matchSubject, rebuildAllVaultArtifacts, suggestedSubjectPath } from './vault-analysis.js';
import { materializeFiguresForNotes } from './figures.js';
import { createRateLimiter, securityHeaders } from './security.js';
import { statfsSync } from 'node:fs';
import { validatePdfUploads } from './pdf.js';

const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf'
};
const EXTENSION_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf'
};

function resolvedUploadType(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  if (MIME_EXTENSIONS[mime]) return { mimeType: mime, extension: MIME_EXTENSIONS[mime] };
  const extension = path.extname(String(file?.originalname || '')).toLowerCase();
  return { mimeType: EXTENSION_MIME_TYPES[extension] || 'application/octet-stream', extension: EXTENSION_MIME_TYPES[extension] ? extension : '' };
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function jobSummary(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    course: job.course,
    lesson_date: job.lesson_date,
    requested_title: job.requested_title,
    result_title: job.result_json?.title || null,
    user_tags: job.user_tags,
    confidence: job.confidence,
    error: job.error,
    vault_path: job.vault_path,
    vault_paths: job.vault_paths_json || [],
    note_count: job.result_json?.noteCount || (job.result_json?.notes?.length || 1),
    created_at: job.created_at,
    updated_at: job.updated_at,
    processed_at: job.processed_at,
    original_names: job.original_names,
    file_count: (job.source_files || []).length
  };
}

function publicJob(job, baseUrl = '') {
  if (!job) return null;
  return {
    ...job,
    result_json: job.result_json,
    vault_paths: job.vault_paths_json || [],
    note_count: job.result_json?.noteCount || (job.result_json?.notes?.length || 1),
    files: (job.source_files || []).map((file, index) => ({
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      url: `${baseUrl}/api/jobs/${job.id}/files/${index}`
    }))
  };
}

export function createApp({ config, store, worker }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  // WebDAV deve essere montato prima del body parser JSON: PUT riceve file binari.
  app.use(config.webdavPath, createWebdavHandler({ config }));

  app.use(express.json({ limit: '3mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  const sessions = new Set();
  const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 20, message: 'Troppi tentativi di accesso. Attendi qualche minuto.' });
  const uploadLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 60, message: 'Troppi upload. Attendi qualche minuto.' });

  function isAuthenticated(req) {
    if (!config.appPassword) return true;
    const token = parseCookies(req.headers.cookie).uniai_session;
    return Boolean(token && sessions.has(token));
  }

  function requireAuth(req, res, next) {
    if (isAuthenticated(req)) return next();
    return res.status(401).json({ error: 'Autenticazione richiesta.' });
  }

  app.get('/api/health', (req, res) => {
    let disk = null;
    try {
      const stats = statfsSync(config.vaultPath);
      disk = {
        freeBytes: Number(stats.bavail) * Number(stats.bsize),
        totalBytes: Number(stats.blocks) * Number(stats.bsize)
      };
    } catch {
      disk = null;
    }
    res.json({
      ok: true,
      version: config.version,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      aiProvider: config.aiProvider,
      aiModel: config.aiModel,
      aiFallbackEnabled: config.aiFallbackEnabled,
      aiFallbackProvider: config.aiFallbackProvider,
      aiFallbackModel: config.aiFallbackModel,
      aiEmergencyEnabled: config.aiEmergencyEnabled,
      aiEmergencyProvider: config.aiEmergencyProvider,
      aiEmergencyModel: config.aiEmergencyModel,
      vaultConfigured: Boolean(config.vaultPath),
      vaultWritable: vaultIsWritable(config.vaultPath, config.notesSubdir),
      autoSaveToVault: config.autoSaveToVault,
      maxFilesPerUpload: config.maxFilesPerUpload,
      maxUploadMb: config.maxUploadMb,
      maxAiImagesPerJob: config.maxAiImagesPerJob,
      pdfMaxPagesPerFile: config.pdfMaxPagesPerFile,
      pdfMaxPagesPerJob: config.pdfMaxPagesPerJob,
      pdfRecommendedPagesPerJob: config.pdfRecommendedPagesPerJob,
      pdfPagesPerAnalysis: config.pdfPagesPerAnalysis,
      pdfMaxAnalysisParts: config.pdfMaxAnalysisParts,
      pdfTextExtractionEnabled: config.pdfTextExtractionEnabled,
      webdavEnabled: config.webdavEnabled,
      webdavPath: config.webdavPath,
      cookieSecure: config.cookieSecure,
      jobs: store.stats(),
      memory: process.memoryUsage(),
      disk
    });
  });

  app.get('/api/auth/status', (req, res) => {
    res.json({ passwordRequired: Boolean(config.appPassword), authenticated: isAuthenticated(req) });
  });

  app.post('/api/login', loginLimiter, (req, res) => {
    if (!config.appPassword) return res.json({ ok: true });
    if (String(req.body?.password || '') !== config.appPassword) {
      return res.status(401).json({ error: 'Password non corretta.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.add(token);
    res.setHeader('Set-Cookie', `uniai_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${config.cookieSecure ? '; Secure' : ''}`);
    return res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie).uniai_session;
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', 'uniai_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination(req, file, callback) {
        try {
          if (!req.jobId) {
            req.jobId = newId();
            req.uploadDir = path.join(config.uploadDir, req.jobId);
            mkdirSync(req.uploadDir, { recursive: true });
          }
          callback(null, req.uploadDir);
        } catch (error) {
          callback(error);
        }
      },
      filename(req, file, callback) {
        req.fileCounter = (req.fileCounter || 0) + 1;
        const uploadType = resolvedUploadType(file);
        callback(null, `file-${req.fileCounter}${uploadType.extension || '.bin'}`);
      }
    }),
    limits: {
      fileSize: config.maxUploadMb * 1024 * 1024,
      files: config.maxFilesPerUpload
    },
    fileFilter(req, file, callback) {
      const uploadType = resolvedUploadType(file);
      if (!uploadType.extension) {
        return callback(new Error(`Tipo file non supportato: ${file.mimetype || file.originalname}. Carica JPG, PNG, WebP, GIF, HEIC, HEIF o PDF.`));
      }
      callback(null, true);
    }
  });

  app.post('/api/uploads', requireAuth, uploadLimiter, upload.array('files', config.maxFilesPerUpload), async (req, res) => {
    if (!req.files || req.files.length === 0) {
      if (req.uploadDir) rmSync(req.uploadDir, { recursive: true, force: true });
      return res.status(400).json({ error: 'Nessun file ricevuto. Seleziona almeno una foto o un PDF degli appunti.' });
    }

    const tags = uniqueStrings(String(req.body.tags || '').split(','));
    const sourceFiles = req.files.map((file) => {
      const uploadType = resolvedUploadType(file);
      return {
        relativePath: path.relative(config.uploadDir, file.path).split(path.sep).join('/'),
        originalName: file.originalname,
        mimeType: uploadType.mimeType,
        size: file.size
      };
    });

    try {
      await validatePdfUploads(req.files.map((file, index) => ({
        ...sourceFiles[index],
        absolutePath: file.path
      })), config);
    } catch (error) {
      if (req.uploadDir) rmSync(req.uploadDir, { recursive: true, force: true });
      return res.status(400).json({ error: error.message });
    }

    const job = store.insertJob({
      id: req.jobId,
      status: 'uploaded',
      original_names: req.files.map((file) => file.originalname),
      source_files: sourceFiles,
      course: String(req.body.course || '').trim() || null,
      lesson_date: String(req.body.lesson_date || '').trim() || null,
      requested_title: String(req.body.title || '').trim() || null,
      user_notes: String(req.body.user_notes || '').trim() || null,
      user_tags: tags
    });

    worker.enqueue(job.id);
    return res.status(202).json({ job: jobSummary(job) });
  });

  app.get('/api/jobs', requireAuth, (req, res) => {
    const result = store.listJobs({
      status: String(req.query.status || ''),
      course: String(req.query.course || ''),
      q: String(req.query.q || ''),
      page: req.query.page,
      limit: req.query.limit
    });
    res.json({ ...result, rows: result.rows.map(jobSummary) });
  });

  app.get('/api/jobs/:id', requireAuth, (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job non trovato.' });
    res.json({ job: publicJob(job) });
  });

  app.get('/api/jobs/:id/files/:index', requireAuth, (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job non trovato.' });
    const index = Number(req.params.index);
    const file = job.source_files?.[index];
    if (!file) return res.status(404).json({ error: 'File non trovato.' });
    const absolute = path.resolve(config.uploadDir, file.relativePath);
    if (!isPathInside(config.uploadDir, absolute)) return res.status(400).json({ error: 'Percorso file non valido.' });
    res.type(file.mimeType || 'application/octet-stream');
    res.sendFile(absolute, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: 'File non disponibile.' });
    });
  });

  app.get('/api/jobs/:id/markdown', requireAuth, (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job non trovato.' });
    if (!job.markdown) return res.status(409).json({ error: 'Markdown non ancora disponibile.' });
    res.type('text/markdown; charset=utf-8').send(job.markdown);
  });

  app.put('/api/jobs/:id/markdown', requireAuth, (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job non trovato.' });
    if (Array.isArray(req.body?.notes)) {
      const result = job.result_json && typeof job.result_json === 'object' ? { ...job.result_json } : null;
      if (!result || !Array.isArray(result.notes)) {
        return res.status(400).json({ error: 'Questo job non contiene più note modificabili.' });
      }
      const incoming = req.body.notes;
      if (incoming.length !== result.notes.length) {
        return res.status(400).json({ error: 'Numero di note non valido.' });
      }
      result.notes = result.notes.map((note, index) => {
        const markdown = String(incoming[index]?.markdown || '');
        if (!markdown.trim()) throw new Error(`Il Markdown della nota ${index + 1} è vuoto.`);
        if (markdown.length > 2_000_000) throw new Error(`Il Markdown della nota ${index + 1} è troppo grande.`);
        return { ...note, markdown };
      });
      const updated = store.updateJob(job.id, {
        markdown: result.notes[0]?.markdown || '',
        result_json: result
      });
      return res.json({ job: publicJob(updated) });
    }
    const markdown = String(req.body?.markdown || '');
    if (!markdown.trim()) return res.status(400).json({ error: 'Il Markdown non può essere vuoto.' });
    if (markdown.length > 2_000_000) return res.status(413).json({ error: 'Markdown troppo grande.' });
    const updates = { markdown };
    if (job.result_json?.notes?.length === 1) {
      updates.result_json = {
        ...job.result_json,
        notes: [{ ...job.result_json.notes[0], markdown }]
      };
    }
    const updated = store.updateJob(job.id, updates);
    res.json({ job: publicJob(updated) });
  });

  app.post('/api/jobs/:id/cancel', requireAuth, (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job non trovato.' });
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return res.status(409).json({ error: 'Il job non è più cancellabile.' });
    }
    const updated = store.updateJob(job.id, { status: 'cancelled', error: 'Job annullato dall’utente.', processed_at: new Date().toISOString() });
    res.json({ job: jobSummary(updated) });
  });

  app.delete('/api/jobs/:id', requireAuth, (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job non trovato.' });
    if (job.status === 'processing') {
      return res.status(409).json({ error: 'Elaborazione in corso: annulla il job e attendi prima di rimuoverlo dalla cronologia.' });
    }
    if (job.status === 'uploaded') worker.remove(job.id);

    try {
      const uploadDirectory = path.resolve(config.uploadDir, job.id);
      if (isPathInside(config.uploadDir, uploadDirectory)) {
        rmSync(uploadDirectory, { recursive: true, force: true });
      }
      store.deleteJobCascade(job.id);
      res.json({
        ok: true,
        vaultFilesPreserved: true,
        message: 'Attività rimossa dalla cronologia. Le note e le figure già salvate nel vault Obsidian sono state conservate.'
      });
    } catch (error) {
      res.status(500).json({ error: `Impossibile rimuovere l'attività: ${error.message}` });
    }
  });

  app.post('/api/jobs/:id/retry', requireAuth, (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job non trovato.' });
    if (job.status === 'processing') return res.status(409).json({ error: 'Elaborazione già in corso.' });
    const updated = store.updateJob(job.id, {
      status: 'uploaded',
      error: null,
      vault_path: null,
      vault_paths_json: [],
      extracted_text: null,
      markdown: null,
      result_json: null,
      links_json: [],
      warnings_json: [],
      confidence: null,
      processed_at: null
    });
    worker.enqueue(job.id);
    res.status(202).json({ job: jobSummary(updated) });
  });

  app.post('/api/jobs/:id/save-to-vault', requireAuth, async (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job non trovato.' });
    if (job.status !== 'completed') {
      return res.status(409).json({ error: 'La nota non è ancora pronta per il salvataggio.' });
    }
    if (job.vault_path || (job.vault_paths_json || []).length > 0) {
      return res.status(409).json({ error: 'Queste note sono già state salvate nel vault.', vaultPath: job.vault_path, vaultPaths: job.vault_paths_json || [] });
    }

    const resultNotes = Array.isArray(job.result_json?.notes) && job.result_json.notes.length
      ? job.result_json.notes
      : [{ title: job.result_json?.title || job.requested_title || 'Appunti senza titolo', markdown: job.markdown }];
    try {
      const analysis = analyzeVaultStructure(config.vaultPath, { subjectRoots: config.obsidianSubjectRoots });
      const subject = matchSubject(job.course, analysis.subjects)
        || analysis.subjects.find((item) => item.name === job.result_json?.subject)
        || null;
      const destinationSubjectPath = subject?.relativePath
        || job.result_json?.subjectPath
        || suggestedSubjectPath({
          subjectName: job.result_json?.subject || job.course,
          course: job.course,
          config
        });
      const notesForSave = resultNotes.length === 1 && job.markdown
        ? [{ ...resultNotes[0], markdown: job.markdown }]
        : resultNotes;
      const materializedNotes = await materializeFiguresForNotes({
        notes: notesForSave,
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
          date: job.lesson_date,
          markdown: note.markdown
        })),
        jobId: job.id,
        store,
        idGenerator: newId,
        subjectRoots: config.obsidianSubjectRoots
      });
      const updatedResult = job.result_json
        ? { ...job.result_json, notes: materializedNotes, figures: materializedNotes.flatMap((note) => note.figures || []) }
        : job.result_json;
      store.updateJob(job.id, {
        markdown: materializedNotes[0]?.markdown || job.markdown,
        result_json: updatedResult,
        vault_path: saved[0]?.relativePath || null,
        vault_paths_json: saved.map((item) => item.relativePath),
        warnings_json: uniqueStrings([...(job.warnings_json || []), ...(req.body?.warnings || []), ...materializedNotes.flatMap((note) => note.warnings || [])])
      });

      // Le note sono ora nel vault: l'attività può essere rimossa dalla cronologia
      // e le immagini originali/risultato temporaneo possono essere eliminati dal server.
      let autoRemoved = false;
      let cleanupWarning = null;
      try {
        const uploadDirectory = path.resolve(config.uploadDir, job.id);
        if (isPathInside(config.uploadDir, uploadDirectory)) {
          rmSync(uploadDirectory, { recursive: true, force: true });
        }
        store.deleteJobCascade(job.id);
        autoRemoved = true;
      } catch (cleanupError) {
        cleanupWarning = `Nota salvata, ma pulizia attività incompleta: ${cleanupError.message}`;
      }

      res.status(201).json({
        ok: true,
        vaultPath: saved[0]?.relativePath || null,
        vaultPaths: saved.map((item) => item.relativePath),
        autoRemoved,
        cleanupWarning,
        message: autoRemoved
          ? 'Note salvate nel vault. Attività rimossa dalla cronologia e dati temporanei eliminati dal server.'
          : 'Note salvate nel vault. Pulizia della cronologia non completata.'
      });
    } catch (error) {
      res.status(500).json({ error: `Salvataggio nel vault fallito: ${error.message}` });
    }
  });

  app.get('/api/courses', requireAuth, (req, res) => {
    res.json({ courses: store.listCourses() });
  });

  app.post('/api/vault/rebuild-artifacts', requireAuth, (req, res) => {
    try {
      const result = rebuildAllVaultArtifacts(config.vaultPath, { subjectRoots: config.obsidianSubjectRoots });
      res.json({
        ok: true,
        subjects: result.analysis.subjects.length,
        files: result.results.reduce((total, item) => total + item.files.length, 0),
        details: result.results
      });
    } catch (error) {
      res.status(500).json({ error: `Rigenerazione indici fallita: ${error.message}` });
    }
  });

  app.use(express.static(config.publicDir, { index: false, maxAge: config.appEnv === 'production' ? '1h' : 0 }));
  app.get('/', (req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint non trovato.' });
    return res.status(404).send('Not found');
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const isMulter = error instanceof multer.MulterError;
    if (isMulter) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? `File troppo grande. Limite: ${config.maxUploadMb} MB.`
        : error.code === 'LIMIT_FILE_COUNT'
          ? `Troppi file. Limite: ${config.maxFilesPerUpload}.`
          : `Errore upload: ${error.message}`;
      if (req.uploadDir) rmSync(req.uploadDir, { recursive: true, force: true });
      return res.status(400).json({ error: message });
    }
    if (req.uploadDir && !req.files?.length) rmSync(req.uploadDir, { recursive: true, force: true });
    const status = error.status || 400;
    return res.status(status).json({ error: error.message || 'Errore interno.' });
  });

  return app;
}
