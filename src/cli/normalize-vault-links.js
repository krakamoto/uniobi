import { ensureEnvFileLoaded, loadConfig } from '../config.js';
import { normalizeVaultWikilinks } from '../vault.js';

ensureEnvFileLoaded(process.cwd());
const apply = process.argv.includes('--write');
const rebuild = process.argv.includes('--rebuild-indexes');
const config = loadConfig(process.env, process.cwd());
if (rebuild) {
  const { rebuildAllVaultArtifacts } = await import('../vault-analysis.js');
  const rebuilt = rebuildAllVaultArtifacts(config.vaultPath, { subjectRoots: config.obsidianSubjectRoots });
  console.log(`Indici ricostruiti: ${rebuilt.results.length} materie`);
}
const result = normalizeVaultWikilinks({ vaultPath: config.vaultPath, dryRun: !apply });

console.log(`Vault: ${config.vaultPath}`);
console.log(`File con wikilink da normalizzare: ${result.changedFiles}`);
console.log(`Wikilink da aggiungere al titolo numerato: ${result.rewrittenLinks}`);
console.log(`Avvisi obsoleti rimossi: ${result.staleWarningsRemoved}`);
for (const change of result.changes.slice(0, 40)) {
  console.log(`- ${change.relativePath}: ${change.rewritten}`);
}
if (result.changes.length > 40) console.log(`... e altri ${result.changes.length - 40} file`);
if (!apply) {
  console.log('\nDry run: nessun file modificato. Usa --write per applicare.');
}
