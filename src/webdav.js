import path from 'node:path';
import crypto from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync,
  statSync, writeFileSync, createReadStream, cpSync
} from 'node:fs';
import { isPathInside } from './utils.js';

const DAV_METHODS = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE';

const MIME_TYPES = {
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.canvas': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8'
};

function xmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function basicCredentials(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function requireBasicAuth(req, res, config) {
  const credentials = basicCredentials(req);
  if (
    credentials &&
    safeEqual(credentials.username, config.webdavUsername) &&
    safeEqual(credentials.password, config.webdavPassword)
  ) {
    return true;
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="UniAi Obsidian Vault", charset="UTF-8"');
  res.status(401).send('Autenticazione WebDAV richiesta.');
  return false;
}

function requestRelativePath(req) {
  const raw = String(req.url || '/').split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    const error = new Error('Percorso WebDAV non valido.');
    error.status = 400;
    throw error;
  }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..' || segment === '.' || segment.includes('\\') || segment.includes('\u0000'))) {
    const error = new Error('Percorso WebDAV non consentito.');
    error.status = 400;
    throw error;
  }
  return segments.join('/');
}

function resolveVaultPath(config, relativePath) {
  const root = path.resolve(config.vaultPath);
  const target = path.resolve(root, relativePath || '');
  if (target !== root && !isPathInside(root, target)) {
    const error = new Error('Percorso WebDAV fuori dal vault.');
    error.status = 403;
    throw error;
  }
  return target;
}

function destinationRelativePath(req, config) {
  const destination = req.headers.destination;
  if (!destination) {
    const error = new Error('Header Destination mancante.');
    error.status = 400;
    throw error;
  }
  let pathname;
  try {
    pathname = new URL(destination, `http://${req.headers.host || 'localhost'}`).pathname;
    pathname = decodeURIComponent(pathname);
  } catch {
    const error = new Error('Header Destination non valido.');
    error.status = 400;
    throw error;
  }

  const base = config.webdavPath === '/' ? '' : config.webdavPath.replace(/\/+$/, '');
  let relative;
  if (pathname === base || pathname === `${base}/`) relative = '';
  else if (pathname.startsWith(`${base}/`)) relative = pathname.slice(base.length + 1);
  else {
    const error = new Error('La destinazione non appartiene al percorso WebDAV configurato.');
    error.status = 400;
    throw error;
  }

  const segments = relative.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..' || segment === '.' || segment.includes('\\') || segment.includes('\u0000'))) {
    const error = new Error('Destinazione WebDAV non consentita.');
    error.status = 400;
    throw error;
  }
  return segments.join('/');
}

function hrefFor(config, relativePath, isDirectory) {
  const base = config.webdavPath === '/' ? '' : config.webdavPath.replace(/\/+$/, '');
  const encoded = String(relativePath || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  let href = `${base}/${encoded}`;
  if (isDirectory && !href.endsWith('/')) href += '/';
  return href || '/';
}

function etagFor(stat) {
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

function contentTypeFor(filePath, isDirectory) {
  if (isDirectory) return 'httpd/unix-directory';
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function propResponse(config, absolutePath, relativePath) {
  const stat = statSync(absolutePath);
  const isDirectory = stat.isDirectory();
  const href = hrefFor(config, relativePath, isDirectory);
  const displayName = relativePath ? path.posix.basename(relativePath) : path.basename(config.vaultPath);
  const resourceType = isDirectory ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>';
  const contentLength = isDirectory ? '' : `<D:getcontentlength>${stat.size}</D:getcontentlength>`;
  const getContentType = isDirectory ? '' : `<D:getcontenttype>${xmlEscape(contentTypeFor(absolutePath, false))}</D:getcontenttype>`;

  return `<D:response>
<D:href>${xmlEscape(href)}</D:href>
<D:propstat>
<D:prop>
<D:displayname>${xmlEscape(displayName)}</D:displayname>
${resourceType}
${contentLength}
${getContentType}
<D:getlastmodified>${stat.mtime.toUTCString()}</D:getlastmodified>
<D:creationdate>${stat.birthtime.toISOString()}</D:creationdate>
<D:getetag>${xmlEscape(etagFor(stat))}</D:getetag>
<D:supportedlock/>
</D:prop>
<D:status>HTTP/1.1 200 OK</D:status>
</D:propstat>
</D:response>`;
}

async function readRequestBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`File troppo grande. Limite WebDAV: ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function ensureParentDirectory(target) {
  mkdirSync(path.dirname(target), { recursive: true });
}

function atomicWrite(target, buffer) {
  ensureParentDirectory(target);
  const temp = `${target}.uniai-webdav-${process.pid}-${Date.now()}.tmp`;
  writeFileSync(temp, buffer);
  renameSync(temp, target);
}

export function createWebdavHandler({ config }) {
  const maxBytes = config.webdavMaxUploadMb * 1024 * 1024;

  return async function webdavHandler(req, res) {
    try {
      if (!config.webdavEnabled) {
        return res.status(503).send('WebDAV non abilitato. Imposta WEBDAV_ENABLED=true e WEBDAV_PASSWORD nel server.');
      }
      if (!requireBasicAuth(req, res, config)) return undefined;

      res.setHeader('DAV', '1, 2');
      res.setHeader('MS-Author-Via', 'DAV');
      res.setHeader('Allow', DAV_METHODS);
      res.setHeader('Accept-Ranges', 'bytes');

      const method = String(req.method || '').toUpperCase();
      if (method === 'OPTIONS') {
        res.status(200).end();
        return undefined;
      }

      const relativePath = requestRelativePath(req);
      const target = resolveVaultPath(config, relativePath);

      if (method === 'PROPFIND') {
        if (!existsSync(target)) return res.status(404).send('Risorsa non trovata.');
        const stat = statSync(target);
        const depth = String(req.headers.depth || '1');
        const parts = [propResponse(config, target, relativePath)];
        if (stat.isDirectory() && depth !== '0') {
          for (const entry of readdirSync(target, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) continue;
            const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            const childAbsolute = path.join(target, entry.name);
            try {
              parts.push(propResponse(config, childAbsolute, childRelative));
            } catch {
              // File rimosso durante la scansione: ignora la voce.
            }
          }
        }
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${parts.join('\n')}
</D:multistatus>`;
        res.status(207).type('application/xml; charset=utf-8').send(xml);
        return undefined;
      }

      if (method === 'PROPPATCH') {
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
<D:response><D:href>${xmlEscape(hrefFor(config, relativePath, false))}</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
</D:multistatus>`;
        res.status(207).type('application/xml; charset=utf-8').send(xml);
        return undefined;
      }

      if (method === 'GET' || method === 'HEAD') {
        if (!existsSync(target)) return res.status(404).send('Risorsa non trovata.');
        const stat = statSync(target);
        if (stat.isDirectory()) return res.status(405).send('Le cartelle non possono essere scaricate come file.');
        res.setHeader('Content-Type', contentTypeFor(target, false));
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Last-Modified', stat.mtime.toUTCString());
        res.setHeader('ETag', etagFor(stat));
        if (method === 'HEAD') return res.status(200).end();
        createReadStream(target).pipe(res);
        return undefined;
      }

      if (method === 'PUT') {
        if (existsSync(target) && statSync(target).isDirectory()) {
          return res.status(405).send('Non è possibile sovrascrivere una cartella con un file.');
        }
        const existed = existsSync(target);
        const body = await readRequestBody(req, maxBytes);
        atomicWrite(target, body);
        res.status(existed ? 204 : 201).end();
        return undefined;
      }

      if (method === 'MKCOL') {
        if (existsSync(target)) return res.status(405).send('La risorsa esiste già.');
        if (!existsSync(path.dirname(target))) return res.status(409).send('La cartella padre non esiste.');
        mkdirSync(target);
        res.status(201).end();
        return undefined;
      }

      if (method === 'DELETE') {
        if (!existsSync(target)) return res.status(404).send('Risorsa non trovata.');
        if (target === path.resolve(config.vaultPath)) return res.status(403).send('Non è possibile eliminare la radice del vault.');
        rmSync(target, { recursive: true, force: true });
        res.status(204).end();
        return undefined;
      }

      if (method === 'COPY' || method === 'MOVE') {
        if (!existsSync(target)) return res.status(404).send('Risorsa sorgente non trovata.');
        const destinationRelative = destinationRelativePath(req, config);
        const destination = resolveVaultPath(config, destinationRelative);
        if (destination === path.resolve(config.vaultPath)) return res.status(403).send('Destinazione non valida.');
        const overwrite = String(req.headers.overwrite || 'T').toUpperCase() !== 'F';
        if (existsSync(destination)) {
          if (!overwrite) return res.status(412).send('La destinazione esiste già.');
          rmSync(destination, { recursive: true, force: true });
        }
        ensureParentDirectory(destination);
        if (method === 'MOVE') renameSync(target, destination);
        else cpSync(target, destination, { recursive: true });
        res.status(201).end();
        return undefined;
      }

      return res.status(405).send('Metodo WebDAV non supportato.');
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(`WebDAV error: ${error.message}`);
      return res.status(status).send(error.message || 'Errore WebDAV.');
    }
  };
}
