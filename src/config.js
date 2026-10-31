import path from 'node:path';
import { existsSync } from 'node:fs';

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveFrom(root, value, fallback) {
  return path.resolve(root, value || fallback);
}

export function loadConfig(env = process.env, root = process.cwd()) {
  const projectRoot = path.resolve(root);
  const vaultPath = resolveFrom(projectRoot, env.OBSIDIAN_VAULT_PATH, './obsidian-vault');
  const notesSubdir = String(env.OBSIDIAN_NOTES_SUBDIR || 'Università/Lezioni').trim();

  if (path.isAbsolute(notesSubdir) || notesSubdir.split(/[\\/]+/).includes('..')) {
    throw new Error('OBSIDIAN_NOTES_SUBDIR deve essere un percorso relativo e non può contenere "..".');
  }

  const webdavEnabled = bool(env.WEBDAV_ENABLED, false);
  const webdavPassword = env.WEBDAV_PASSWORD || '';
  const webdavUsername = env.WEBDAV_USERNAME || 'uniai';
  let webdavPath = String(env.WEBDAV_PATH || '/webdav').trim();
  if (!webdavPath.startsWith('/')) webdavPath = `/${webdavPath}`;
  webdavPath = webdavPath.replace(/\/+$/, '') || '/webdav';
  if (webdavEnabled && !webdavPassword) {
    throw new Error('WEBDAV_PASSWORD è obbligatoria quando WEBDAV_ENABLED=true.');
  }

  const aiFallbackEnabled = bool(env.AI_FALLBACK_ENABLED, false);
  const aiFallbackModel = String(env.AI_FALLBACK_MODEL || '').trim();
  if (aiFallbackEnabled && !aiFallbackModel) {
    throw new Error('AI_FALLBACK_MODEL è obbligatorio quando AI_FALLBACK_ENABLED=true.');
  }

  const rawDatabase = String(env.DATABASE_URL || '').trim();
  const databaseRelative = rawDatabase
    .replace(/^sqlite:\/\/\//, '')
    .replace(/^sqlite:\/\//, '')
    .replace(/^sqlite:/, '');

  return {
    projectRoot,
    appEnv: env.APP_ENV || 'development',
    port: number(env.PORT, 3000),
    appPassword: env.APP_PASSWORD || '',
    cookieSecure: bool(env.COOKIE_SECURE, false),
    databasePath: resolveFrom(projectRoot, databaseRelative, './data/database/uniai.db'),
    uploadDir: resolveFrom(projectRoot, env.UPLOAD_DIR, './data/uploads'),
    vaultPath,
    notesSubdir,
    obsidianSubjectRoots: String(env.OBSIDIAN_SUBJECT_ROOTS || '').split(',').map((value) => value.trim()).filter(Boolean),
    obsidianNewSubjectRoot: String(env.OBSIDIAN_NEW_SUBJECT_ROOT || '').trim(),
    maxUploadMb: number(env.MAX_UPLOAD_MB, 20),
    maxFilesPerUpload: number(env.MAX_FILES_PER_UPLOAD, 10),
    aiProvider: (env.AI_PROVIDER || 'mock').toLowerCase(),
    aiModel: env.AI_MODEL || 'gemini-3.8-flash',
    aiApiKey: env.AI_API_KEY || '',
    aiBaseUrl: env.AI_BASE_URL || '',
    aiJsonMode: bool(env.AI_JSON_MODE, true),
    aiFallbackEnabled,
    aiFallbackProvider: (env.AI_FALLBACK_PROVIDER || env.AI_PROVIDER || 'gemini').toLowerCase(),
    aiFallbackModel,
    aiFallbackApiKey: env.AI_FALLBACK_API_KEY || env.AI_API_KEY || '',
    aiFallbackBaseUrl: env.AI_FALLBACK_BASE_URL || env.AI_BASE_URL || '',
    aiFallbackMinConfidence: number(env.AI_FALLBACK_MIN_CONFIDENCE, 0.7),
    aiFallbackOnIllegible: bool(env.AI_FALLBACK_ON_ILLEGIBLE, true),
    aiFallbackMinCharsPerImage: number(env.AI_FALLBACK_MIN_CHARS_PER_IMAGE, 80),
    autoSaveToVault: bool(env.AUTO_SAVE_TO_VAULT, false),
    allowCreateMissingWikilinks: bool(env.ALLOW_CREATE_MISSING_WIKILINKS, false),
    workerPollMs: number(env.WORKER_POLL_MS, 1500),
    webdavEnabled,
    webdavUsername,
    webdavPassword,
    webdavPath,
    webdavMaxUploadMb: number(env.WEBDAV_MAX_UPLOAD_MB, 50),
    publicDir: path.join(projectRoot, 'public'),
    version: '1.0.0'
  };
}

export function ensureEnvFileLoaded(root = process.cwd()) {
  const envPath = path.join(root, '.env');
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
}
