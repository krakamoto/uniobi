import { ensureEnvFileLoaded, loadConfig } from './config.js';
import { createStore } from './db.js';
import { createWorker } from './worker.js';
import { createApp } from './app.js';
import { mkdirSync } from 'node:fs';
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

const server = app.listen(config.port, () => {
  console.log(`UniAi attivo su http://localhost:${config.port}`);
  console.log(`Provider AI: ${config.aiProvider}${config.aiProvider === 'mock' ? ' (modalità demo)' : ` / ${config.aiModel}`}`);
  console.log(`Vault Obsidian: ${config.vaultPath} / ${config.notesSubdir}`);
  if (!config.appPassword) console.log('Autenticazione disabilitata: imposta APP_PASSWORD prima di esporre l’app in rete.');
});

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
