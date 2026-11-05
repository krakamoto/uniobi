import { uniqueStrings } from './utils.js';
import { findVaultNote } from './vault.js';

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

export function stripFrontmatter(markdown) {
  const text = String(markdown || '').replace(/^\uFEFF/, '');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return text;
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? text.slice(match[0].length) : text;
}

export function buildFrontmatter({ title, course, subject, date, tags, createdAt, aliases = [] }) {
  const cleanTags = uniqueStrings(tags).map((tag) => tag.replace(/^#/, '').replace(/\s+/g, '-'));
  const lines = [
    '---',
    `title: ${yamlString(title)}`,
    `course: ${course ? yamlString(course) : '""'}`,
    `subject: ${subject ? yamlString(subject) : '""'}`,
    `date: ${date ? yamlString(date) : '""'}`,
    'tags:'
  ];
  if (cleanTags.length === 0) {
    lines.push('  - "appunti"');
  } else {
    for (const tag of cleanTags) lines.push(`  - ${yamlString(tag)}`);
  }
  lines.push('aliases:');
  for (const alias of uniqueStrings(aliases)) lines.push(`  - ${yamlString(alias)}`);
  if (uniqueStrings(aliases).length === 0) lines[lines.length - 1] = 'aliases: []';
  lines.push(
    'source: "UniAi"',
    `created: ${yamlString(createdAt)}`,
    'status: "bozza"',
    '---'
  );
  return lines.join('\n');
}

export function ensureHeading(markdown, title) {
  const body = stripFrontmatter(markdown).trim();
  if (/^#\s+.+/m.test(body)) return body;
  return `# ${title}\n\n${body}`;
}

function sanitizeWikilinks(markdown, links, allowCreate, notes = []) {
  const warnings = [];
  const validTargets = new Set();
  for (const link of links) {
    if (!link.target) continue;
    validTargets.add(String(link.target).toLocaleLowerCase('it'));
  }

  const sanitized = String(markdown || '').replace(/\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (full, target, section, label) => {
    const cleanTarget = String(target).trim();
    const key = cleanTarget.toLocaleLowerCase('it');
    const resolved = findVaultNote(cleanTarget, notes);
    if (resolved) {
      const numbered = resolved.title;
      if (numbered !== cleanTarget) return `[[${numbered}${section || ''}${label || ''}]]`;
      return full;
    }
    const exists = validTargets.has(key);
    if (exists || allowCreate) return full;
    warnings.push(`Il wikilink [[${cleanTarget}]] non esiste nel vault ed è stato convertito in testo.`);
    return label || cleanTarget;
  });
  return { markdown: sanitized, warnings };
}

export function appendVerifiedLinks(markdown, links) {
  const existingLinks = links.filter((link) => link.exists);
  if (existingLinks.length === 0) return markdown;
  const section = `## Collegamenti\n\n${existingLinks.map((link) => `- [[${link.target}]]${link.reason ? ` — ${link.reason}` : ''}`).join('\n')}`;
  const body = markdown.replace(/\s+$/, '');
  if (/^##\s+Collegamenti\s*$/mi.test(body)) {
    return body.replace(/^##\s+Collegamenti\s*$[\s\S]*?(?=^##\s+|\s*$)/mi, `${section}\n\n`);
  }
  return `${body}\n\n${section}\n`;
}

export function appendWarnings(markdown, warnings) {
  const clean = uniqueStrings(warnings);
  if (clean.length === 0) return markdown;
  return `${markdown.replace(/\s+$/, '')}\n\n> [!warning] Da verificare\n${clean.map((warning) => `> - ${warning}`).join('\n')}\n`;
}

export function validateLatexDelimiters(markdown) {
  let body = stripFrontmatter(markdown);
  body = body.replace(/```[\s\S]*?```/g, ' ');
  body = body.replace(/`[^`\n]*`/g, ' ');
  body = body.replace(/\$\$[\s\S]*?\$\$/g, ' ');
  body = body.replace(/\$[^$\n]+\$/g, ' ');

  const commandPattern = /\\(?:frac|sqrt|sum|prod|int|iint|iiint|oint|partial|nabla|cdot|times|div|left|right|vec|hat|bar|overline|underline|alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|varphi|omega|infty|text|mathrm|mathbf|mathbb|mathcal|begin|end)\b[^$\n]*/g;
  const matches = [...body.matchAll(commandPattern)]
    .map((match) => match[0].trim().slice(0, 100))
    .filter(Boolean);
  const snippets = uniqueStrings(matches).slice(0, 8);
  return {
    valid: snippets.length === 0,
    snippets,
    warnings: snippets.map((snippet) => `LaTeX non racchiuso tra $...$ o $$...$$: \`${snippet}\``)
  };
}
export function appendKeyConcepts(markdown, keyConcepts, conceptRelations) {
  let body = markdown.replace(/\s+$/, '');
  const concepts = uniqueStrings(keyConcepts);
  if (concepts.length > 0 && !/^##\s+Concetti chiave\s*$/mi.test(body)) {
    body += `\n\n## Concetti chiave\n\n${concepts.map((concept) => `- ${concept}`).join('\n')}`;
  }
  if (conceptRelations.length > 0 && !/^##\s+Relazioni concettuali\s*$/mi.test(body)) {
    const rows = conceptRelations.map((relation) => {
      const label = relation.label ? ` — ${relation.label}` : '';
      return `- **${relation.from}** → **${relation.to}**${label}`;
    });
    body += `\n\n## Relazioni concettuali\n\n${rows.join('\n')}`;
  }
  return body;
}

export function buildFinalMarkdown({ aiResult, metadata, links, warnings, createdAt, notes, allowCreate }) {
  const title = metadata.title || aiResult.title || 'Appunti senza titolo';
  const tags = uniqueStrings([...(metadata.tags || []), ...(aiResult.tags || [])]);
  let body = ensureHeading(aiResult.markdown || aiResult.content || metadata.fallbackContent || '', title);

  const sanitized = sanitizeWikilinks(body, links, allowCreate, notes);
  body = sanitized.markdown;
  body = appendKeyConcepts(body, aiResult.keyConcepts || [], aiResult.conceptRelations || []);
  body = appendVerifiedLinks(body, links);
  const latexCheck = validateLatexDelimiters(body);
  body = appendWarnings(body, [...(warnings || []), ...(aiResult.warnings || []), ...sanitized.warnings, ...latexCheck.warnings]);

  const frontmatter = buildFrontmatter({
    title,
    course: metadata.course || aiResult.course || '',
    subject: metadata.subject || aiResult.subject || '',
    date: metadata.date || aiResult.date || '',
    tags: [...tags, 'appunti', 'uniai'],
    createdAt,
    aliases: aiResult.aliases || []
  });

  return `${frontmatter}\n\n${body.trim()}\n`;
}
