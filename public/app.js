const state = {
  jobs: [],
  selectedJob: null,
  detailTimer: null,
  markdownDirty: false,
  files: [],
  authenticated: false
};

const $ = (selector) => document.querySelector(selector);
const statusLabels = {
  uploaded: 'In attesa',
  processing: 'In elaborazione',
  completed: 'Completato',
  failed: 'Fallito'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderMarkdown(markdown) {
  let text = String(markdown || '');
  text = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const escaped = escapeHtml(text);
  const codeBlocks = [];
  let html = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
    const token = `@@CODEBLOCK${codeBlocks.length}@@`;
    codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return token;
  });

  html = html
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/^&gt;\s+\[!(info|warning|tip|note)\]\s*(.*)$/gmi, (_, type, title) => `<blockquote class="callout callout-${type}"><strong>${title || type}</strong><br>`)
    .replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => `<span class="wikilink">${label || target}</span>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');

  html = html.split(/\n{2,}/).map((block) => {
    if (/^\s*<(h\d|ul|blockquote|pre|hr)/.test(block.trim()) || block.startsWith('@@CODEBLOCK')) return block;
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  codeBlocks.forEach((code, index) => {
    html = html.replace(`@@CODEBLOCK${index}@@`, code);
  });
  return html || '<p class="muted">Nessuna anteprima disponibile.</p>';
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (response.status === 401) {
    showLogin();
    throw new Error('Autenticazione richiesta.');
  }
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || `Errore HTTP ${response.status}`);
  return payload;
}

function showToast(message, type = '') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 4500);
}

function badge(status) {
  return `<span class="badge badge-${status}">${statusLabels[status] || status}</span>`;
}

function formatDate(value) {
  if (!value) return 'Data non indicata';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function showLogin() {
  state.authenticated = false;
  $('#login-overlay').classList.remove('hidden');
  $('#logout-btn').classList.add('hidden');
  setTimeout(() => $('#login-password')?.focus(), 50);
}

function hideLogin() {
  state.authenticated = true;
  $('#login-overlay').classList.add('hidden');
  $('#logout-btn').classList.remove('hidden');
}

async function checkAuth() {
  const status = await api('/api/auth/status');
  if (status.passwordRequired && !status.authenticated) {
    showLogin();
    return false;
  }
  hideLogin();
  return true;
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    $('#provider-badge').textContent = health.aiProvider === 'mock' ? 'Demo · provider mock' : `AI · ${health.aiProvider}`;
    if (!health.vaultWritable) {
      $('#provider-badge').textContent += ' · vault non scrivibile';
      $('#provider-badge').title = 'Controlla OBSIDIAN_VAULT_PATH e i permessi della cartella.';
    }
  } catch {
    $('#provider-badge').textContent = 'server non disponibile';
  }
}

function renderFiles() {
  const list = $('#file-list');
  list.innerHTML = state.files.map((file, index) => {
    const url = URL.createObjectURL(file);
    return `<div class="file-chip"><img src="${url}" alt=""><span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span><button type="button" class="btn btn-ghost" data-remove-file="${index}" aria-label="Rimuovi">×</button></div>`;
  }).join('');
  list.querySelectorAll('[data-remove-file]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      state.files.splice(Number(button.dataset.removeFile), 1);
      renderFiles();
    });
  });
}

function addFiles(fileList) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
  for (const file of fileList) {
    if (!allowed.includes(file.type) && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)) continue;
    if (state.files.length >= 10) break;
    state.files.push(file);
  }
  renderFiles();
}

function jobCard(job) {
  const title = job.result_title || job.requested_title || job.result_json?.title || job.course || 'Elaborazione senza titolo';
  return `<article class="job-card" tabindex="0" data-job-id="${job.id}">
    <div>
      <h3>${escapeHtml(title)}</h3>
      <div class="job-meta">
        <span>${escapeHtml(job.course || 'Corso non indicato')}</span>
        <span>${formatDate(job.lesson_date || job.created_at)}</span>
        <span>${job.file_count} ${job.file_count === 1 ? 'immagine' : 'immagini'}</span>
      </div>
    </div>
    <div class="job-card-side">
      ${badge(job.status)}
      <span class="job-date">${formatDateTime(job.created_at)}</span>
    </div>
  </article>`;
}

async function loadJobs({ silent = false } = {}) {
  const params = new URLSearchParams();
  const query = $('#search-input').value.trim();
  const status = $('#status-filter').value;
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  try {
    const data = await api(`/api/jobs?${params}`);
    state.jobs = data.rows;
    const list = $('#jobs-list');
    list.innerHTML = state.jobs.length
      ? state.jobs.map(jobCard).join('')
      : '<div class="empty-state">Nessuna elaborazione trovata. Carica i tuoi appunti oppure modifica i filtri.</div>';
    list.querySelectorAll('[data-job-id]').forEach((card) => {
      const open = () => openJob(card.dataset.jobId);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') open(); });
    });
  } catch (error) {
    if (!silent) showToast(error.message, 'error');
  }
}

function renderDialog(job) {
  state.selectedJob = job;
  const result = job.result_json || {};
  const generatedNotes = Array.isArray(result.notes) ? result.notes : [];
  const multiNote = generatedNotes.length > 1;
  const isSaved = Boolean(job.vault_path) || (Array.isArray(job.vault_paths) && job.vault_paths.length > 0);
  const links = job.links_json || result.links || [];
  const warnings = job.warnings_json || result.warnings || [];
  const title = result.title || job.requested_title || job.course || 'Appunti';
  $('#dialog-title').textContent = title;
  $('#dialog-status').className = `badge badge-${job.status}`;
  $('#dialog-status').textContent = statusLabels[job.status] || job.status;

  const thumbs = (job.files || []).map((file) => `<a href="${file.url}" target="_blank" rel="noopener"><img src="${file.url}" alt="${escapeHtml(file.originalName)}" loading="lazy"></a>`).join('');
  const linksHtml = links.length
    ? `<ul class="link-list">${links.map((link) => `<li><span class="wiki-chip ${link.exists ? '' : 'missing'}" title="${escapeHtml(link.reason || '')}">[[${escapeHtml(link.target)}]]${link.exists ? '' : ' · da creare'}</span></li>`).join('')}</ul>`
    : '<p>Nessun wikilink verificato.</p>';
  const warningsHtml = warnings.length ? `<div class="warning-box">${warnings.map(escapeHtml).join('<br>')}</div>` : '';
  const errorHtml = job.error ? `<div class="error-box">${escapeHtml(job.error)}</div>` : '';

  let content = '';
  if (job.status === 'completed' && (job.markdown || generatedNotes.length > 0)) {
    content = `
      <div class="detail-grid">
        <div class="detail-card">
          <h3>Metadati</h3>
          <p><strong>Corso:</strong> ${escapeHtml(job.course || result.course || '—')}<br>
          <strong>Data:</strong> ${escapeHtml(formatDate(job.lesson_date || result.date))}<br>
          <strong>Tag:</strong> ${escapeHtml((job.user_tags || result.tags || []).join(', ') || '—')}<br>
          <strong>Confidenza AI:</strong> ${typeof job.confidence === 'number' ? Math.round(job.confidence * 100) + '%' : '—'}</p>
          ${warningsHtml}
        </div>
        <div class="detail-card">
          <h3>Wikilink</h3>
          ${linksHtml}
          ${warningsHtml ? '' : '<p>I wikilink sono verificati rispetto alle note esistenti nel vault.</p>'}
        </div>
      </div>
      <div class="detail-card" style="margin-top:18px"><h3>Immagini originali</h3><div class="thumb-grid">${thumbs}</div></div>
      ${multiNote ? `
        <div class="detail-card" style="margin-top:18px">
          <h3>${generatedNotes.length} note separate per argomento</h3>
          <p>UniAi ha diviso il gruppo di immagini in note atomiche. Tutte verranno salvate nel vault.</p>
          ${generatedNotes.map((note, index) => `
            <div class="detail-card" style="margin-top:12px">
              <h3>${index + 1}. ${escapeHtml(note.title || 'Nota')}</h3>
              ${note.summary ? `<p>${escapeHtml(note.summary)}</p>` : ''}
              <div class="markdown-preview">${renderMarkdown(note.markdown || '')}</div>
            </div>`).join('')}
        </div>
      ` : `
        <div class="editor-grid">
          <div>
            <h3 style="font-size:14px;margin:0 0 8px">Markdown modificabile</h3>
            <textarea id="markdown-editor" spellcheck="false">${escapeHtml(job.markdown)}</textarea>
          </div>
          <div>
            <h3 style="font-size:14px;margin:0 0 8px">Anteprima Obsidian</h3>
            <div id="markdown-preview" class="markdown-preview">${renderMarkdown(job.markdown)}</div>
          </div>
        </div>
      `}
      <div class="dialog-actions">
        ${multiNote ? '' : '<button id="copy-markdown" class="btn btn-secondary" type="button">Copia Markdown</button>'}
        ${multiNote ? '' : '<button id="save-edits" class="btn btn-secondary" type="button">Salva modifiche</button>'}
        <button id="save-vault" class="btn btn-primary" type="button" ${isSaved ? 'disabled' : ''}>Salva ${multiNote ? 'le note' : 'nel vault Obsidian'}</button>
        <button id="delete-job" class="btn btn-danger" type="button">Elimina attività</button>
        ${isSaved ? `<span class="saved-banner">${multiNote ? `${(job.vault_paths || []).length || generatedNotes.length} note salvate nel vault` : `Già salvata in: ${escapeHtml(job.vault_path)}`}</span>` : ''}
      </div>`;
  } else if (job.status === 'failed') {
    content = `
      <div class="detail-card">
        <h3>Immagini caricate</h3>
        <div class="thumb-grid">${thumbs}</div>
      </div>
      ${errorHtml}
      <div class="dialog-actions">
        <button id="retry-job" class="btn btn-primary" type="button">Riprova elaborazione</button>
        <button id="delete-job" class="btn btn-danger" type="button">Elimina attività</button>
      </div>`;
  } else {
    content = `
      <div class="detail-card">
        <h3>Elaborazione in corso</h3>
        <p>Le immagini sono state salvate sul server. L’AI sta analizzando gli appunti; questa pagina si aggiorna automaticamente.</p>
        <div class="thumb-grid" style="margin-top:14px">${thumbs}</div>
      </div>`;
  }
  $('#dialog-body').innerHTML = content;

  const editor = $('#markdown-editor');
  if (editor) {
    state.markdownDirty = false;
    editor.addEventListener('input', () => {
      state.markdownDirty = true;
      $('#markdown-preview').innerHTML = renderMarkdown(editor.value);
    });
  }
  $('#copy-markdown')?.addEventListener('click', async () => {
    if (!editor) return;
    await navigator.clipboard.writeText(editor.value);
    showToast('Markdown copiato negli appunti.', 'success');
  });
  $('#save-edits')?.addEventListener('click', () => saveMarkdown(job.id));
  $('#save-vault')?.addEventListener('click', () => saveToVault(job.id));
  $('#retry-job')?.addEventListener('click', () => retryJob(job.id));
  $('#delete-job')?.addEventListener('click', () => deleteJob(job.id));
}

async function openJob(id) {
  clearInterval(state.detailTimer);
  if (!$('#job-dialog').open) $('#job-dialog').showModal();
  $('#dialog-body').innerHTML = '<div class="empty-state">Caricamento dettaglio…</div>';
  await refreshJob(id);
  state.detailTimer = setInterval(() => {
    if (state.selectedJob && ['uploaded', 'processing'].includes(state.selectedJob.status)) refreshJob(id, true);
  }, 2500);
}

async function refreshJob(id, silent = false) {
  try {
    const data = await api(`/api/jobs/${id}`);
    renderDialog(data.job);
    if (['completed', 'failed'].includes(data.job.status)) {
      clearInterval(state.detailTimer);
      loadJobs({ silent: true });
    }
  } catch (error) {
    if (!silent) showToast(error.message, 'error');
  }
}

async function saveMarkdown(jobId) {
  const editor = $('#markdown-editor');
  if (!editor) return;
  try {
    await api(`/api/jobs/${jobId}/markdown`, {
      method: 'PUT',
      body: JSON.stringify({ markdown: editor.value })
    });
    state.markdownDirty = false;
    showToast('Modifiche al Markdown salvate.', 'success');
    return true;
  } catch (error) {
    showToast(error.message, 'error');
    return false;
  }
}

async function saveToVault(jobId) {
  const button = $('#save-vault');
  button.disabled = true;
  try {
    if (state.markdownDirty) {
      const ok = await saveMarkdown(jobId);
      if (!ok) return;
    }
    const data = await api(`/api/jobs/${jobId}/save-to-vault`, { method: 'POST', body: '{}' });
    const savedPaths = Array.isArray(data.vaultPaths) ? data.vaultPaths : [];
    showToast(savedPaths.length > 1 ? `${savedPaths.length} note salvate nel vault.` : `Nota salvata nel vault: ${data.vaultPath}`, 'success');
    await refreshJob(jobId, true);
    await loadJobs({ silent: true });
  } catch (error) {
    showToast(error.message, 'error');
    button.disabled = false;
  }
}

async function deleteJob(jobId) {
  if (!window.confirm('Rimuovere questa attività dalla cronologia?\n\nLe note e le figure già salvate nel vault Obsidian NON verranno cancellate. Le immagini originali caricate sul server verranno eliminate.')) return;
  try {
    const data = await api(`/api/jobs/${jobId}`, { method: 'DELETE' });
    showToast(data.message || 'Attività rimossa. Le note nel vault sono state conservate.', 'success');
    clearInterval(state.detailTimer);
    if ($('#job-dialog').open) $('#job-dialog').close();
    await loadJobs({ silent: true });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function retryJob(jobId) {
  try {
    await api(`/api/jobs/${jobId}/retry`, { method: 'POST', body: '{}' });
    showToast('Elaborazione riavviata.', 'success');
    await openJob(jobId);
    await loadJobs({ silent: true });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

$('#upload-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.files.length === 0) {
    showToast('Seleziona almeno una foto degli appunti.', 'error');
    return;
  }
  const form = new FormData(event.currentTarget);
  for (const file of state.files) form.append('files', file);
  const button = $('#submit-upload');
  button.disabled = true;
  button.querySelector('.spinner').classList.remove('hidden');
  try {
    const data = await api('/api/uploads', { method: 'POST', body: form });
    showToast('Caricamento completato. Analisi avviata.', 'success');
    state.files = [];
    renderFiles();
    event.currentTarget.reset();
    await loadJobs({ silent: true });
    await openJob(data.job.id);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.querySelector('.spinner').classList.add('hidden');
  }
});

const dropZone = $('#drop-zone');
$('#file-input').addEventListener('change', (event) => addFiles(event.target.files));
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  addFiles(event.dataTransfer.files);
});
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') $('#file-input').click();
});

$('#refresh-btn').addEventListener('click', () => loadJobs());
$('#status-filter').addEventListener('change', () => loadJobs());
let searchTimer;
$('#search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadJobs(), 300);
});
$('#close-dialog').addEventListener('click', () => {
  clearInterval(state.detailTimer);
  $('#job-dialog').close();
});
$('#job-dialog').addEventListener('click', (event) => {
  if (event.target === $('#job-dialog')) {
    clearInterval(state.detailTimer);
    $('#job-dialog').close();
  }
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('#login-error');
  error.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#login-password').value }) });
    hideLogin();
    await loadHealth();
    await loadJobs();
  } catch (err) {
    error.textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
  showLogin();
});

(async function init() {
  await loadHealth();
  if (!(await checkAuth())) return;
  await loadJobs();
  setInterval(() => {
    if (state.authenticated && !document.hidden) loadJobs({ silent: true });
  }, 6000);
})();
