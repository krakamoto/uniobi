import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { nowIso, parseJsonSafe } from './utils.js';

const JSON_FIELDS = ['original_names', 'source_files', 'user_tags', 'result_json', 'links_json', 'warnings_json', 'vault_paths_json'];

function parseRow(row) {
  if (!row) return null;
  const result = { ...row };
  for (const field of JSON_FIELDS) {
    if (field in result) result[field] = parseJsonSafe(result[field], field === 'source_files' || field === 'user_tags' || field === 'links_json' || field === 'warnings_json' ? [] : null);
  }
  return result;
}

export function createStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      original_names TEXT NOT NULL DEFAULT '[]',
      source_files TEXT NOT NULL DEFAULT '[]',
      course TEXT,
      lesson_date TEXT,
      requested_title TEXT,
      user_notes TEXT,
      user_tags TEXT NOT NULL DEFAULT '[]',
      extracted_text TEXT,
      markdown TEXT,
      result_json TEXT,
      links_json TEXT NOT NULL DEFAULT '[]',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL,
      error TEXT,
      vault_path TEXT,
      vault_paths_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_course ON jobs(course);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);

    CREATE TABLE IF NOT EXISTS vault_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );
  `);

  try {
    db.exec("ALTER TABLE jobs ADD COLUMN vault_paths_json TEXT NOT NULL DEFAULT '[]'");
  } catch {
    // Colonna già presente.
  }

  const statements = {
    insertJob: db.prepare(`
      INSERT INTO jobs (id, status, original_names, source_files, course, lesson_date,
        requested_title, user_notes, user_tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getJob: db.prepare('SELECT * FROM jobs WHERE id = ?'),
    listJobs: db.prepare(`
      SELECT * FROM jobs
      WHERE (? = '' OR status = ?)
        AND (? = '' OR lower(coalesce(course, '')) LIKE '%' || lower(?) || '%')
        AND (? = '' OR lower(coalesce(requested_title, '')) LIKE '%' || lower(?) || '%'
             OR lower(coalesce(course, '')) LIKE '%' || lower(?) || '%'
             OR lower(coalesce(extracted_text, '')) LIKE '%' || lower(?) || '%')
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `),
    countJobs: db.prepare(`
      SELECT COUNT(*) AS total FROM jobs
      WHERE (? = '' OR status = ?)
        AND (? = '' OR lower(coalesce(course, '')) LIKE '%' || lower(?) || '%')
        AND (? = '' OR lower(coalesce(requested_title, '')) LIKE '%' || lower(?) || '%'
             OR lower(coalesce(course, '')) LIKE '%' || lower(?) || '%'
             OR lower(coalesce(extracted_text, '')) LIKE '%' || lower(?) || '%')
    `),
    updateJob: db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?'),
    courses: db.prepare(`
      SELECT course, COUNT(*) AS count FROM jobs
      WHERE coalesce(trim(course), '') <> ''
      GROUP BY course ORDER BY course COLLATE NOCASE
    `),
    insertVaultFile: db.prepare(`
      INSERT INTO vault_files (id, job_id, relative_path, absolute_path, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    vaultFilesByJob: db.prepare('SELECT * FROM vault_files WHERE job_id = ?'),
    interrupted: db.prepare("SELECT id FROM jobs WHERE status = 'processing'")
  };

  const allowedColumns = new Set([
    'status', 'original_names', 'source_files', 'course', 'lesson_date', 'requested_title',
    'user_notes', 'user_tags', 'extracted_text', 'markdown', 'result_json', 'links_json',
    'warnings_json', 'confidence', 'error', 'vault_path', 'vault_paths_json', 'processed_at'
  ]);

  function insertJob(job) {
    const timestamp = nowIso();
    statements.insertJob.run(
      job.id,
      job.status || 'uploaded',
      JSON.stringify(job.original_names || []),
      JSON.stringify(job.source_files || []),
      job.course || null,
      job.lesson_date || null,
      job.requested_title || null,
      job.user_notes || null,
      JSON.stringify(job.user_tags || []),
      timestamp,
      timestamp
    );
    return getJob(job.id);
  }

  function getJob(id) {
    return parseRow(statements.getJob.get(id));
  }

  function updateJob(id, updates) {
    const entries = Object.entries(updates).filter(([key]) => allowedColumns.has(key));
    if (entries.length === 0) return getJob(id);
    const sets = entries.map(([key]) => `${key} = ?`);
    const values = entries.map(([key, value]) => {
      if (['source_files', 'user_tags', 'result_json', 'links_json', 'warnings_json', 'vault_paths_json'].includes(key)) {
        return typeof value === 'string' ? value : JSON.stringify(value);
      }
      return value;
    });
    db.prepare(`UPDATE jobs SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...values, nowIso(), id);
    return getJob(id);
  }

  function listJobs({ status = '', course = '', q = '', page = 1, limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;
    const rows = statements.listJobs.all(status, status, course, course, q, q, q, q, safeLimit, offset)
      .map(parseRow);
    const total = Number(statements.countJobs.get(status, status, course, course, q, q, q, q).total || 0);
    return { rows, total, page: safePage, limit: safeLimit };
  }

  function listCourses() {
    return statements.courses.all();
  }

  function insertVaultFile(file) {
    const timestamp = nowIso();
    statements.insertVaultFile.run(file.id, file.jobId, file.relativePath, file.absolutePath, file.contentHash, timestamp);
    return { ...file, createdAt: timestamp };
  }

  function getVaultFiles(jobId) {
    return statements.vaultFilesByJob.all(jobId);
  }

  function listInterrupted() {
    return statements.interrupted.all();
  }

  function close() {
    db.close();
  }

  return {
    db,
    insertJob,
    getJob,
    updateJob,
    listJobs,
    listCourses,
    insertVaultFile,
    getVaultFiles,
    listInterrupted,
    close
  };
}
