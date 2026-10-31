import { ensureEnvFileLoaded, loadConfig } from '../config.js';
import { rebuildAllVaultArtifacts } from '../vault-analysis.js';

ensureEnvFileLoaded(process.cwd());
const config = loadConfig(process.env, process.cwd());
const result = rebuildAllVaultArtifacts(config.vaultPath, { subjectRoots: config.obsidianSubjectRoots });

console.log(`Vault: ${config.vaultPath}`);
console.log(`Materie: ${result.analysis.subjects.length}`);
for (const item of result.results) {
  console.log(`- ${item.subject}: ${item.directory} (${item.files.length} file aggiornati)`);
}
console.log(`File aggiornati: ${result.results.reduce((total, item) => total + item.files.length, 0)}`);
