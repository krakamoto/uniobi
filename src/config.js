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
  const imageMaxSide = Math.max(512, number(env.IMAGE_MAX_SIDE, 1600));
  const imageJpegQuality = Math.max(40, Math.min(100, number(env.IMAGE_JPEG_QUALITY, 88)));
  const pdfMaxPagesPerFile = Math.max(1, Math.floor(number(env.PDF_MAX_PAGES_PER_FILE, 60)));
  const pdfMaxPagesPerJob = Math.max(1, Math.floor(number(env.PDF_MAX_PAGES_PER_JOB, 60)));
  const pdfRecommendedPagesPerJob = Math.max(1, Math.floor(number(env.PDF_RECOMMENDED_PAGES_PER_JOB, 6)));
  const pdfPagesPerAnalysis = Math.max(1, Math.floor(number(env.PDF_PAGES_PER_ANALYSIS, pdfRecommendedPagesPerJob)));
  const pdfMaxAnalysisParts = Math.max(1, Math.floor(number(env.PDF_MAX_ANALYSIS_PARTS, 10)));
  const pdfTextPageMinChars = Math.max(20, Math.floor(number(env.PDF_TEXT_PAGE_MIN_CHARS, 80)));
  const pdfMaxTextCharsPerJob = Math.max(1000, Math.floor(number(env.PDF_MAX_TEXT_CHARS_PER_JOB, 120000)));
  const pdfRenderMaxSide = Math.max(512, Math.min(4096, number(env.PDF_RENDER_MAX_SIDE, imageMaxSide)));
  const maxAiImagesPerJob = Math.max(1, Math.floor(number(env.AI_MAX_IMAGES_PER_JOB, 50)));
  const imageCropEnabled = bool(env.IMAGE_CROP_ENABLED, true);
  const imageCropAnalysisSide = Math.max(256, Math.min(1200, number(env.IMAGE_CROP_ANALYSIS_SIDE, 640)));
  const imageCropThreshold = Math.max(8, Math.min(80, number(env.IMAGE_CROP_THRESHOLD, 24)));
  const imageCropPaddingRatio = Math.max(0, Math.min(0.1, number(env.IMAGE_CROP_PADDING_RATIO, 0.02)));
  const imageCropMaxInkLossRatio = Math.max(0, Math.min(0.1, number(env.IMAGE_CROP_MAX_INK_LOSS_RATIO, 0.02)));
  const imageCropMinContentRatio = Math.max(0.01, Math.min(0.8, number(env.IMAGE_CROP_MIN_CONTENT_RATIO, 0.08)));
  const aiMaxOutputTokens = Math.max(0, number(env.AI_MAX_OUTPUT_TOKENS, 0));
  const aiRetryMaxAttempts = Math.max(1, number(env.AI_RETRY_MAX_ATTEMPTS, 8));
  const aiPerImageFallbackMaxImages = Math.max(1, Math.floor(number(env.AI_PER_IMAGE_FALLBACK_MAX_IMAGES, 6)));
  const aiMaxProviderCallsPerJob = Math.max(1, Math.floor(number(env.AI_MAX_PROVIDER_CALLS_PER_JOB, 10)));
  const aiRetryBaseDelayMs = Math.max(0, number(env.AI_RETRY_BASE_DELAY_MS, 2000));
  const aiRetryMaxDelayMs = Math.max(0, number(env.AI_RETRY_MAX_DELAY_MS, 30000));
  const aiClaudeUseBatch = bool(env.AI_CLAUDE_USE_BATCH, true);
  const aiClaudeBatchPollMs = Math.max(0, number(env.AI_CLAUDE_BATCH_POLL_MS, 10000));
  const aiClaudeBatchTimeoutMs = Math.max(1000, number(env.AI_CLAUDE_BATCH_TIMEOUT_MS, 21600000));
  const aiEmergencyEnabled = bool(env.AI_EMERGENCY_ENABLED, false);
  const aiEmergencyModel = String(env.AI_EMERGENCY_MODEL || '').trim();
  if (aiEmergencyEnabled && !aiEmergencyModel) {
    throw new Error('AI_EMERGENCY_MODEL è obbligatorio quando AI_EMERGENCY_ENABLED=true.');
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
    tlsCertPath: env.TLS_CERT_PATH ? path.resolve(projectRoot, env.TLS_CERT_PATH) : '',
    tlsKeyPath: env.TLS_KEY_PATH ? path.resolve(projectRoot, env.TLS_KEY_PATH) : '',
    databasePath: resolveFrom(projectRoot, databaseRelative, './data/database/uniai.db'),
    uploadDir: resolveFrom(projectRoot, env.UPLOAD_DIR, './data/uploads'),
    vaultPath,
    notesSubdir,
    obsidianSubjectRoots: String(env.OBSIDIAN_SUBJECT_ROOTS || '').split(',').map((value) => value.trim()).filter(Boolean),
    obsidianNewSubjectRoot: String(env.OBSIDIAN_NEW_SUBJECT_ROOT || '').trim(),
    obsidianSubjectAttachmentsSubdir: String(env.OBSIDIAN_SUBJECT_ATTACHMENTS_SUBDIR || 'Allegati').replace(/^\/+|\/+$/g, ''),
    maxUploadMb: number(env.MAX_UPLOAD_MB, 20),
    maxFilesPerUpload: Math.max(1, Math.floor(number(env.MAX_FILES_PER_UPLOAD, 50))),
    imageMaxSide,
    imageJpegQuality,
    pdfMaxPagesPerFile,
    pdfMaxPagesPerJob,
    pdfRecommendedPagesPerJob,
    pdfPagesPerAnalysis,
    pdfMaxAnalysisParts,
    pdfTextExtractionEnabled: bool(env.PDF_TEXT_EXTRACTION_ENABLED, true),
    pdfTextPageMinChars,
    pdfMaxTextCharsPerJob,
    pdfRenderMaxSide,
    maxAiImagesPerJob,
    imageCropEnabled,
    imageCropAnalysisSide,
    imageCropThreshold,
    imageCropPaddingRatio,
    imageCropMaxInkLossRatio,
    imageCropMinContentRatio,
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
    aiFallbackOnIllegible: bool(env.AI_FALLBACK_ON_ILLEGIBLE, false),
    aiFallbackMinCharsPerImage: number(env.AI_FALLBACK_MIN_CHARS_PER_IMAGE, 80),
    aiEmergencyEnabled,
    aiEmergencyProvider: (env.AI_EMERGENCY_PROVIDER || 'deepseek').toLowerCase(),
    aiEmergencyModel,
    aiEmergencyApiKey: env.AI_EMERGENCY_API_KEY || '',
    aiEmergencyBaseUrl: env.AI_EMERGENCY_BASE_URL || '',
    aiClaudeUseBatch,
    aiClaudeBatchPollMs,
    aiClaudeBatchTimeoutMs,
    aiMaxOutputTokens,
    aiRetryMaxAttempts,
    aiPerImageFallbackMaxImages,
    aiMaxProviderCallsPerJob,
    aiRetryBaseDelayMs,
    aiRetryMaxDelayMs,
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
