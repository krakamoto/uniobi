import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { newId, nowIso, isPathInside, uniqueStrings, parseJsonSafe } from './utils.js';
import { saveNoteToVault, vaultIsWritable } from './vault.js';
import { createWebdavHandler } from './webdav.js';
import { analyzeVaultStructure, matchSubject, rebuildAllVaultArtifacts, suggestedSubjectPath } from './vault-analysis.js';

const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif'
};

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

  // WebDAV deve essere montato prima del body parser JSON: PUT riceve file binari.
  app.use(config.webdavPath, createWebdavHandler({ config }));

  app.use(express.json({ limit: '3mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  const sessions = new Set();

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
    res.json({
      ok: true,
      version: config.version,
      aiProvider: config.aiProvider,
      vaultConfigured: Boolean(config.vaultPath),
      vaultWritable: vaultIsWritable(config.vaultPath, config.notesSubdir),
      autoSaveToVault: config.autoSaveToVault,
      webdavEnabled: config.webdavEnabled,
      webdavPath: config.webdavPath
    });
  });

  app.get('/api/auth/status', (req, res) => {
    res.json({ passwordRequired: Boolean(config.appPassword), authenticated: isAuthenticated(req) });
  });

  app.post('/api/login', (req, res) => {
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
        const extension = MIME_EXTENSIONS[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.img';
        callback(null, `image-${req.fileCounter}${extension}`);
      }
    }),
    limits: {
      fileSize: config.maxUploadMb * 1024 * 1024,
      files: config.maxFilesPerUpload
    },
    fileFilter(req, file, callback) {
      if (!MIME_EXTENSIONS[file.mimetype]) {
        return callback(new Error(`Tipo file non supportato: ${file.mimetype || file.originalname}. Carica JPG, PNG, WebP, GIF, HEIC o HEIF.`));
      }
      callback(null, true);
    }
  });

  app.post('/api/uploads', requireAuth, upload.array('files', config.maxFilesPerUpload), (req, res) => {
    if (!req.files || req.files.length === 0) {
      if (req.uploadDir) rmSync(req.uploadDir, { recursive: true, force: true });
      return res.status(400).json({ error: 'Nessun file ricevuto. Seleziona almeno una foto degli appunti.' });
    }

    const tags = uniqueStrings(String(req.body.tags || '').split(','));
    const sourceFiles = req.files.map((file) => ({
      relativePath: path.relative(config.uploadDir, file.path).split(path.sep).join('/'),
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size
    }));

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
    const markdown = String(req.body?.markdown || '');
    if (!markdown.trim()) return res.status(400).json({ error: 'Il Markdown non può essere vuoto.' });
    if (markdown.length > 2_000_000) return res.status(413).json({ error: 'Markdown troppo grande.' });
    const updated = store.updateJob(job.id, { markdown });
    res.json({ job: publicJob(updated) });
  });

  app.post('/api/jobs/:id/retry', requireAuth, (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job non trovato.' });
    if (job.status === 'processing') return res.status(409).json({ error: 'Elaborazione già in corso.' });
    const updated = store.updateJob(job.id, {
      status: 'uploaded',
      error: null,
      vault_path: null,
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

  app.post('/api/jobs/:id/save-to-vault', requireAuth, (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job non trovato.' });
    if (job.status !== 'completed' || !job.markdown) {
      return res.status(409).json({ error: 'La nota non è ancora pronta per il salvataggio.' });
    }
    if (job.vault_path) {
      return res.status(409).json({ error: 'Questa nota è già stata salvata nel vault.', vaultPath: job.vault_path });
    }

    const title = job.result_json?.title || job.requested_title || 'Appunti senza titolo';
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
      const saved = saveNoteToVault({
        vaultPath: config.vaultPath,
        notesSubdir: config.notesSubdir,
        relativeDir: destinationSubjectPath,
        title,
        date: job.lesson_date,
        markdown: job.markdown,
        jobId: job.id,
        store,
        idGenerator: newId,
        subjectRoots: config.obsidianSubjectRoots
      });
      const updated = store.updateJob(job.id, {
        vault_path: saved.relativePath,
        warnings_json: uniqueStrings([...(job.warnings_json || []), ...(req.body?.warnings || [])])
      });
      res.status(201).json({ ok: true, vaultPath: saved.relativePath, job: publicJob(updated) });
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
