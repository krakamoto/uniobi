import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const logPath = path.resolve(process.argv[2] || './data/ai-usage.jsonl');
if (!existsSync(logPath)) {
  console.log(`Nessun log trovato: ${logPath}`);
  process.exit(0);
}

const byModel = new Map();
const byDay = new Map();
let totalInput = 0;
let totalOutput = 0;
let totalCached = 0;
let jobs = 0;

for (const line of readFileSync(logPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let entry;
  try { entry = JSON.parse(line); } catch { continue; }
  const usage = entry.ai?.usage || {};
  const model = entry.ai?.modelUsed || 'unknown';
  const day = String(entry.createdAt || '').slice(0, 10) || 'unknown';
  const input = Number(usage.inputTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  const cached = Number(usage.cachedInputTokens) || 0;
  jobs += 1;
  totalInput += input;
  totalOutput += output;
  totalCached += cached;
  const modelRow = byModel.get(model) || { jobs: 0, input: 0, output: 0, cached: 0 };
  modelRow.jobs += 1; modelRow.input += input; modelRow.output += output; modelRow.cached += cached;
  byModel.set(model, modelRow);
  const dayRow = byDay.get(day) || { jobs: 0, input: 0, output: 0, cached: 0 };
  dayRow.jobs += 1; dayRow.input += input; dayRow.output += output; dayRow.cached += cached;
  byDay.set(day, dayRow);
}

console.log(`Log: ${logPath}`);
console.log(`Job registrati: ${jobs}`);
console.log(`Token totali: input ${totalInput} · output ${totalOutput} · cache ${totalCached}`);
console.log('\nPer modello:');
for (const [model, row] of [...byModel.entries()].sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))) {
  console.log(`- ${model}: ${row.jobs} job · input ${row.input} · output ${row.output} · cache ${row.cached}`);
}
console.log('\nPer giorno:');
for (const [day, row] of [...byDay.entries()].sort()) {
  console.log(`- ${day}: ${row.jobs} job · input ${row.input} · output ${row.output} · cache ${row.cached}`);
}
