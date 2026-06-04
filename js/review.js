import { getJob, saveJob, getItemsForJob, saveItem, deleteItem, getPhotosForItem, savePhoto, deletePhoto, getSettings } from './db.js';
import { navigate } from './router.js';
import { generateId, showToast, resizeImage, getRoomCode } from './utils.js';
import { isAIEnabled } from './settings.js';
import { generatePDF } from './pdf.js';

let job = null;
let items = [];
let settings = null;
let viewMode = 'room'; // 'room' | 'trade'

export function initReview() {
  document.getElementById('review-back-btn').addEventListener('click', () => navigate('home'));
  document.getElementById('review-generate-btn').addEventListener('click', handleGenerateReport);
  document.getElementById('review-tab-room').addEventListener('click', () => setView('room'));
  document.getElementById('review-tab-trade').addEventListener('click', () => setView('trade'));

  document.getElementById('review-menu-btn').addEventListener('click', toggleOverflowMenu);
  document.getElementById('review-edit-job-btn').addEventListener('click', () => {
    toggleOverflowMenu();
    navigate('setup', { jobId: job.id });
  });
  document.getElementById('review-export-csv-btn').addEventListener('click', () => { toggleOverflowMenu(); exportCSV(); });

  document.addEventListener('screen-shown', async e => {
    if (e.detail.screen !== 'review') return;
    settings = await getSettings();
    let jobId = window.appState.jobId;
    if (!jobId) {
      // Load most recent job
      const { getAllJobs } = await import('./db.js');
      const jobs = await getAllJobs();
      if (!jobs.length) { navigate('home'); return; }
      jobId = jobs[0].id;
    }
    job = await getJob(jobId);
    if (!job) { navigate('home'); return; }
    items = await getItemsForJob(jobId);
    renderReview();
  });

  document.addEventListener('click', e => {
    const menu = document.getElementById('review-overflow-menu');
    if (menu && !menu.contains(e.target) && e.target !== document.getElementById('review-menu-btn')) {
      menu.style.display = 'none';
    }
  });
}

function toggleOverflowMenu() {
  const menu = document.getElementById('review-overflow-menu');
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function setView(mode) {
  viewMode = mode;
  document.getElementById('review-tab-room').classList.toggle('active', mode === 'room');
  document.getElementById('review-tab-trade').classList.toggle('active', mode === 'trade');
  renderList();
}

function renderReview() {
  document.getElementById('review-job-info').textContent = `${job.reference} — ${job.clientName}`;
  renderSummaryBar();
  renderList();
}

function renderSummaryBar() {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  items.forEach(i => { if (counts[i.severity] !== undefined) counts[i.severity]++; });
  const roomsComplete = (job.rooms || []).filter(r => {
    const ri = items.filter(i => i.roomId === r.id);
    return ri.length > 0;
  }).length;

  document.getElementById('review-summary').innerHTML = `
    <span class="sev-chip sev-critical">Critical: ${counts.critical}</span>
    <span class="sev-chip sev-high">High: ${counts.high}</span>
    <span class="sev-chip sev-medium">Medium: ${counts.medium}</span>
    <span class="sev-chip sev-low">Low: ${counts.low}</span>
    <span class="sev-chip">Total: ${items.length}</span>
    <span class="sev-chip">Rooms: ${roomsComplete}/${(job.rooms||[]).length}</span>
  `;
}

function renderList() {
  const container = document.getElementById('review-list');
  container.innerHTML = '';

  if (viewMode === 'room') renderByRoom(container);
  else renderByTrade(container);
}

function renderByRoom(container) {
  (job.rooms || []).forEach(room => {
    const roomItems = items.filter(i => i.roomId === room.id).sort((a, b) => {
      if (b.flagged && !a.flagged) return 1;
      if (a.flagged && !b.flagged) return -1;
      return (a.order || 0) - (b.order || 0);
    });
    container.appendChild(createSection(room.name, roomItems, room));
  });
}

function renderByTrade(container) {
  const trades = [...new Set(items.map(i => i.trade || ''))];
  trades.sort((a, b) => a < b ? -1 : 1);
  trades.forEach(trade => {
    const tradeItems = items.filter(i => (i.trade || '') === trade).sort((a, b) => {
      if (b.flagged && !a.flagged) return 1;
      if (a.flagged && !b.flagged) return -1;
      return 0;
    });
    container.appendChild(createSection(trade || 'Untagged', tradeItems, null));
  });
}

function createSection(title, sectionItems, room) {
  const section = document.createElement('div');
  section.className = 'review-section';
  const header = document.createElement('div');
  header.className = 'review-section-header';
  header.innerHTML = `<span>${esc(title)}</span><span class="badge badge-neutral">${sectionItems.length}</span><span class="chevron">▾</span>`;
  header.addEventListener('click', () => section.classList.toggle('collapsed'));

  const body = document.createElement('div');
  body.className = 'review-section-body';
  sectionItems.forEach((item, idx) => {
    body.appendChild(createReviewCard(item, room, idx));
  });

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

function createReviewCard(item, room, idx) {
  const code = room ? getRoomCode(room.name) : '?';
  const roomItems = room ? items.filter(i => i.roomId === room.id) : [];
  const num = room ? roomItems.findIndex(i => i.id === item.id) + 1 : idx + 1;
  const itemNum = `${code}-${String(num).padStart(2,'0')}`;
  const sevClass = { critical:'sev-critical', high:'sev-high', medium:'sev-medium', low:'sev-low' }[item.severity] || 'sev-medium';

  const card = document.createElement('div');
  card.className = 'review-item-card';
  card.dataset.id = item.id;

  const aiBtn = isAIEnabled() ? `<button class="btn btn-sm ai-btn" data-ai="${item.id}">✦ Expand</button>` : '';

  card.innerHTML = `
    <div class="review-item-header">
      <span class="item-num mono">${item.flagged ? '⚑ ' : ''}${itemNum}</span>
      <span class="badge ${sevClass}">${item.severity || 'medium'}</span>
      ${item.trade ? `<span class="trade-pill">${esc(item.trade)}</span>` : ''}
    </div>
    <div class="review-item-desc">${esc(item.description || '')}</div>
    <div class="review-item-photos" data-item="${item.id}"></div>
    <div class="review-item-actions">
      <button class="btn btn-sm flag-btn${item.flagged ? ' active' : ''}" data-flag="${item.id}">⚑ ${item.flagged ? 'Flagged' : 'Flag'}</button>
      ${aiBtn}
      <button class="btn btn-sm" data-edit="${item.id}">Edit</button>
      <button class="btn btn-sm btn-danger" data-delete="${item.id}">Delete</button>
    </div>
  `;

  card.querySelector(`[data-flag]`).addEventListener('click', async () => {
    item.flagged = !item.flagged;
    await saveItem(item);
    renderList();
  });

  card.querySelector(`[data-delete]`).addEventListener('click', async () => {
    if (!confirm('Delete this item?')) return;
    await deleteItem(item.id);
    items = items.filter(i => i.id !== item.id);
    renderReview();
  });

  card.querySelector(`[data-edit]`).addEventListener('click', () => openEditPanel(item));

  const aiEl = card.querySelector(`[data-ai]`);
  if (aiEl) aiEl.addEventListener('click', () => expandWithAI(item));

  // Load photos async
  loadItemPhotos(item, card.querySelector('.review-item-photos'));

  return card;
}

async function loadItemPhotos(item, container) {
  const photos = await getPhotosForItem(item.id);
  container.innerHTML = '';
  photos.forEach(p => {
    const wrap = document.createElement('label');
    wrap.className = 'review-photo-wrap';
    wrap.innerHTML = `
      <img src="${p.dataUrl}" class="photo-thumb" alt="photo">
      <input type="checkbox" class="photo-include-cb" ${p.includeInReport !== false ? 'checked' : ''}>
      <span class="photo-include-label">Include</span>
    `;
    wrap.querySelector('input').addEventListener('change', async e => {
      p.includeInReport = e.target.checked;
      await savePhoto(p);
    });
    container.appendChild(wrap);
  });
}

// Edit panel (reuse capture-style)
let editPanelItem = null;
let editPanelPhotos = [];

function openEditPanel(item) {
  editPanelItem = { ...item };
  editPanelPhotos = [];
  getPhotosForItem(item.id).then(photos => {
    editPanelPhotos = photos;
    renderEditPanel();
  });
  document.getElementById('review-edit-panel').classList.add('open');
}

function renderEditPanel() {
  document.getElementById('review-edit-desc').value = editPanelItem.description || '';
  document.getElementById('review-edit-flagged').checked = !!editPanelItem.flagged;
  document.querySelectorAll('.review-sev-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sev === (editPanelItem.severity || 'medium'));
  });
  renderEditTrades();
  renderEditPhotos();
  const aiBtn = document.getElementById('review-edit-ai-btn');
  if (aiBtn) aiBtn.style.display = isAIEnabled() ? 'flex' : 'none';
}

function renderEditTrades() {
  const container = document.getElementById('review-edit-trades');
  container.innerHTML = '';
  const trades = (settings && settings.trades) || [];
  trades.forEach(trade => {
    const pill = document.createElement('button');
    pill.className = `trade-pill-btn${editPanelItem.trade === trade ? ' active' : ''}`;
    pill.textContent = trade;
    pill.addEventListener('click', () => {
      editPanelItem.trade = editPanelItem.trade === trade ? '' : trade;
      renderEditTrades();
    });
    container.appendChild(pill);
  });
}

function renderEditPhotos() {
  const container = document.getElementById('review-edit-photos');
  container.innerHTML = '';
  editPanelPhotos.forEach(p => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb-wrap';
    wrap.innerHTML = `<img src="${p.dataUrl}" class="photo-thumb"><button class="photo-remove-btn" data-id="${p.id}">✕</button>`;
    wrap.querySelector('button').addEventListener('click', async () => {
      if (!p.id.startsWith('new-')) {
        await deletePhoto(p.id);
        editPanelItem.photoIds = (editPanelItem.photoIds || []).filter(id => id !== p.id);
      }
      editPanelPhotos = editPanelPhotos.filter(ph => ph.id !== p.id);
      renderEditPhotos();
    });
    container.appendChild(wrap);
  });
}

export function initReviewPanel() {
  document.getElementById('review-edit-panel-cancel').addEventListener('click', () => {
    document.getElementById('review-edit-panel').classList.remove('open');
  });

  document.getElementById('review-edit-panel-save').addEventListener('click', async () => {
    editPanelItem.description = document.getElementById('review-edit-desc').value.trim();
    editPanelItem.flagged = document.getElementById('review-edit-flagged').checked;

    const newPhotos = editPanelPhotos.filter(p => p.id && p.id.startsWith('new-'));
    for (const p of newPhotos) {
      p.id = generateId();
      await savePhoto(p);
      if (!editPanelItem.photoIds) editPanelItem.photoIds = [];
      editPanelItem.photoIds.push(p.id);
    }

    await saveItem(editPanelItem);
    const idx = items.findIndex(i => i.id === editPanelItem.id);
    if (idx >= 0) items[idx] = editPanelItem;
    document.getElementById('review-edit-panel').classList.remove('open');
    renderReview();
    showToast('Item updated', 'success');
  });

  document.getElementById('review-edit-photo-btn').addEventListener('click', () => {
    document.getElementById('review-edit-photo-input').click();
  });
  document.getElementById('review-edit-camera-btn').addEventListener('click', () => {
    document.getElementById('review-edit-camera-input').click();
  });

  async function handleReviewPhotos(e) {
    const files = Array.from(e.target.files);
    const maxPx = { large: 900, medium: 600, small: 400 }[settings?.reportPrefs?.photoSize || 'medium'];
    for (const file of files) {
      const { dataUrl, w: imgW, h: imgH } = await resizeImage(file, maxPx, 0.7);
      editPanelPhotos.push({ id: `new-${generateId()}`, itemId: editPanelItem.id, jobId: job.id, dataUrl, imgW, imgH, includeInReport: true });
    }
    renderEditPhotos();
    e.target.value = '';
  }
  document.getElementById('review-edit-photo-input').addEventListener('change', handleReviewPhotos);
  document.getElementById('review-edit-camera-input').addEventListener('change', handleReviewPhotos);

  document.querySelectorAll('.review-sev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!editPanelItem) return;
      editPanelItem.severity = btn.dataset.sev;
      document.querySelectorAll('.review-sev-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  const aiBtn = document.getElementById('review-edit-ai-btn');
  if (aiBtn) aiBtn.addEventListener('click', () => expandWithAI(editPanelItem, true));
}

async function expandWithAI(item, inPanel = false) {
  const s = await getSettings();
  if (!s.apiKey) { showToast('API key not set', 'error'); return; }
  const desc = inPanel ? document.getElementById('review-edit-desc').value.trim() : item.description;
  if (!desc) { showToast('No description to expand', 'error'); return; }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: 'You are a professional building surveyor writing a formal inspection report. Expand the following short site note into a clear, professional 2–3 sentence description suitable for a client report. Do not add facts not present in the note. Respond with the expanded text only.',
        messages: [{ role: 'user', content: desc }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'API error');
    const expanded = data.content[0].text;
    if (inPanel) {
      document.getElementById('review-edit-desc').value = expanded;
    } else {
      item.description = expanded;
      await saveItem(item);
      renderList();
    }
    showToast('Description expanded', 'success');
  } catch (err) {
    showToast(`AI error: ${err.message}`, 'error');
  }
}

async function handleGenerateReport() {
  if (!items.length) { showToast('No items to include in report', 'error'); return; }
  const overlay = document.getElementById('report-loading-overlay');
  overlay.style.display = 'flex';
  try {
    const result = await generatePDF(job.id);
    window.appState.reportBlob = result.blob;
    window.appState.reportFilename = result.filename;
    navigate('report-preview');
  } catch (err) {
    showToast(`PDF error: ${err.message}`, 'error');
    console.error(err);
  } finally {
    overlay.style.display = 'none';
  }
}

function exportCSV() {
  const rows = [['Item', 'Room', 'Description', 'Trade', 'Severity', 'Flagged']];
  (job.rooms || []).forEach(room => {
    const code = getRoomCode(room.name);
    const roomItems = items.filter(i => i.roomId === room.id).sort((a,b)=>(a.order||0)-(b.order||0));
    roomItems.forEach((item, idx) => {
      const num = `${code}-${String(idx+1).padStart(2,'0')}`;
      rows.push([num, room.name, item.description || '', item.trade || '', item.severity || 'medium', item.flagged ? 'Yes' : 'No']);
    });
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${job.reference}-items.csv`; a.click();
  URL.revokeObjectURL(url);
}

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
