import path from 'node:path';
import { ensureEnvFileLoaded, loadConfig } from '../config.js';
import { applyVaultRenumber, planVaultRenumber, vaultRenumberSummary } from '../vault-renumber.js';
import { rebuildAllVaultArtifacts } from '../vault-analysis.js';
import { scanBrokenWikilinks } from '../link-cleaner.js';

ensureEnvFileLoaded(process.cwd());
const apply = process.argv.includes('--write');
const includeAll = process.argv.includes('--all');
const config = loadConfig(process.env, process.cwd());
const plan = planVaultRenumber({ vaultPath: config.vaultPath, onlyGenerated: !includeAll });
const summary = vaultRenumberSummary(plan);

console.log(`Vault: ${config.vaultPath}`);
console.log(`Ambito: ${includeAll ? 'tutte le note numerate' : 'solo note generate da UniAi'}`);
console.log(`Cartelle con note numerate: ${summary.directories}`);
console.log(`File da rinumerare: ${summary.renames}`);
for (const detail of summary.details) {
  console.log(`- ${path.relative(config.vaultPath, detail.directory).split(path.sep).join('/') || '.'}: ${detail.changes.length}`);
}

if (!apply) {
  console.log('\nDry run: nessun file modificato. Usa --write per applicare.');
  process.exit(0);
}

const result = applyVaultRenumber({ vaultPath: config.vaultPath, plan });
rebuildAllVaultArtifacts(config.vaultPath, { subjectRoots: config.obsidianSubjectRoots });
const broken = scanBrokenWikilinks({ vaultPath: config.vaultPath });
console.log(`File rinominati: ${result.renamed.length}`);
console.log(`Note con wikilink aggiornati: ${result.updatedNotes.length}`);
console.log(`Wikilink orfani rimasti: ${broken.broken.length}`);
