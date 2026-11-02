import { ensureEnvFileLoaded, loadConfig } from './config.js';
import { createStore } from './db.js';
import { createWorker } from './worker.js';
import { createApp } from './app.js';
import { mkdirSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { nowIso } from './utils.js';

ensureEnvFileLoaded(process.cwd());
const config = loadConfig(process.env, process.cwd());
mkdirSync(config.uploadDir, { recursive: true });
mkdirSync(config.vaultPath, { recursive: true });

const store = createStore(config.databasePath);
for (const job of store.listInterrupted()) {
  store.updateJob(job.id, {
    status: 'failed',
    error: 'Elaborazione interrotta da un riavvio del server. Usa "Riprova".',
    processed_at: nowIso()
  });
}

const worker = createWorker({ config, store });
const app = createApp({ config, store, worker });

const tlsEnabled = Boolean(config.tlsCertPath && config.tlsKeyPath);
const server = tlsEnabled
  ? https.createServer({
      cert: readFileSync(config.tlsCertPath),
      key: readFileSync(config.tlsKeyPath)
    }, app).listen(config.port, () => {
      console.log(`UniAi attivo su https://localhost:${config.port}`);
      console.log(`TLS attivo con certificato: ${config.tlsCertPath}`);
      printStartupInfo();
    })
  : app.listen(config.port, () => {
      console.log(`UniAi attivo su http://localhost:${config.port}`);
      printStartupInfo();
    });

function printStartupInfo() {
  console.log(`Provider AI: ${config.aiProvider}${config.aiProvider === 'mock' ? ' (modalità demo)' : ` / ${config.aiModel}`}`);
  console.log(`Vault Obsidian: ${config.vaultPath} / ${config.notesSubdir}`);
  if (!config.appPassword) console.log('Autenticazione disabilitata: imposta APP_PASSWORD prima di esporre l’app in rete.');
  if (!tlsEnabled) console.log('TLS disattivato: usa Caddy/Nginx o imposta TLS_CERT_PATH e TLS_KEY_PATH.');
}

function shutdown(signal) {
  console.log(`\nRicevuto ${signal}, arresto in corso...`);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
