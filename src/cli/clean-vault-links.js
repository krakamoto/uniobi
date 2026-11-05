import path from 'node:path';
import { ensureEnvFileLoaded, loadConfig } from '../config.js';
import { cleanBrokenWikilinks, scanBrokenWikilinks } from '../link-cleaner.js';
import { rebuildAllVaultArtifacts } from '../vault-analysis.js';

ensureEnvFileLoaded(process.cwd());
const apply = process.argv.includes('--write');
const rebuild = process.argv.includes('--rebuild-indexes');
const config = loadConfig(process.env, process.cwd());
const before = scanBrokenWikilinks({ vaultPath: config.vaultPath });
const result = cleanBrokenWikilinks({ vaultPath: config.vaultPath, dryRun: !apply });

console.log(`Vault: ${config.vaultPath}`);
console.log(`Link rotti rilevati: ${before.broken.length}`);
console.log(`File da modificare: ${result.changedFiles}`);
console.log(`Wikilink da convertire in testo: ${result.removedLinks}`);
for (const change of result.changes.slice(0, 40)) {
  console.log(`- ${change.relativePath}: ${change.removed}`);
}
if (result.changes.length > 40) console.log(`... e altri ${result.changes.length - 40} file`);

if (!apply) {
  console.log('\nDry run: nessun file modificato. Usa --write per applicare.');
  process.exit(0);
}

if (rebuild) {
  const rebuilt = rebuildAllVaultArtifacts(config.vaultPath, { subjectRoots: config.obsidianSubjectRoots });
  console.log(`Indici ricostruiti: ${rebuilt.results.length} materie`);
}
const after = scanBrokenWikilinks({ vaultPath: config.vaultPath });
console.log(`Link rotti rimasti: ${after.broken.length}`);
