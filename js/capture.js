import { getJob, saveJob, getItemsForJob, saveItem, deleteItem, getPhotosForItem, savePhoto, deletePhoto, getSettings } from './db.js';
import { navigate } from './router.js';
import { generateId, showToast, resizeImage, getRoomCode } from './utils.js';
import { isAIEnabled } from './settings.js';
import { openPlan } from './plan.js';

let job = null;
let rooms = [];
let currentRoomIndex = 0;
let items = [];
let editingItem = null;
let editingPhotos = [];
let recognition = null;
let settings = null;

const PHOTO_MAX = { large: 900, medium: 600, small: 400 };

export function initCapture() {
  document.getElementById('capture-prev-room').addEventListener('click', prevRoom);
  document.getElementById('capture-next-room').addEventListener('click', nextRoom);
  document.getElementById('capture-add-item-btn').addEventListener('click', () => openItemPanel(null));
  document.getElementById('capture-back-btn').addEventListener('click', handleBack);
  document.getElementById('capture-add-room-btn').addEventListener('click', addRoomInPlace);
  document.getElementById('capture-plan-btn').addEventListener('click', openPlanForRoom);
  document.getElementById('capture-room-name').addEventListener('click', renameCurrentRoom);
  document.getElementById('room-jump-btn').addEventListener('click', openRoomJump);
  document.getElementById('room-jump-close').addEventListener('click', closeRoomJump);
  document.getElementById('room-jump-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeRoomJump();
  });

  // Panel
  document.getElementById('item-panel-cancel').addEventListener('click', closeItemPanel);
  document.getElementById('item-panel-save').addEventListener('click', saveItemPanel);
  document.getElementById('item-photo-btn').addEventListener('click', () => document.getElementById('item-photo-input').click());
  document.getElementById('item-photo-input').addEventListener('change', handlePhotoSelect);
  document.getElementById('item-ai-btn').addEventListener('click', expandWithAI);

  // Mic
  setupMic();

  initSevButtons();

  document.addEventListener('screen-shown', async e => {
    if (e.detail.screen !== 'capture') return;
    settings = await getSettings();
    const jobId = window.appState.jobId;
    if (!jobId) { navigate('home'); return; }
    job = await getJob(jobId);
    if (!job) { navigate('home'); return; }
    rooms = job.rooms || [];
    currentRoomIndex = window.appState.roomIndex || 0;
    if (currentRoomIndex >= rooms.length) currentRoomIndex = 0;
    items = await getItemsForJob(jobId);
    renderCapture();
  });
}

function renderCapture() {
  if (!rooms.length) {
    document.getElementById('capture-room-name').textContent = 'No rooms';
    document.getElementById('capture-items-list').innerHTML = '';
    return;
  }
  const room = rooms[currentRoomIndex];
  document.getElementById('capture-job-info').textContent = `${job.reference} — ${job.clientName}`;
  document.getElementById('capture-room-name').textContent = room.name || 'Unnamed Room';
  document.getElementById('capture-progress-text').textContent = `${currentRoomIndex + 1} / ${rooms.length}`;

  renderProgressBar();
  renderItemsList();
  updateNavButtons();
}

function renderProgressBar() {
  const bar = document.getElementById('capture-progress-bar');
  bar.innerHTML = '';
  rooms.forEach((r, i) => {
    const roomItems = items.filter(it => it.roomId === r.id);
    const complete = roomItems.length > 0 && roomItems.every(it => it._complete);
    const div = document.createElement('div');
    div.className = `progress-segment${i === currentRoomIndex ? ' active' : ''}${complete ? ' complete' : ''}`;
    div.title = r.name;
    div.addEventListener('click', () => { currentRoomIndex = i; renderCapture(); });
    bar.appendChild(div);
  });
}

function renderItemsList() {
  const room = rooms[currentRoomIndex];
  const roomItems = items.filter(it => it.roomId === room.id).sort((a,b) => (a.order||0)-(b.order||0));
  const list = document.getElementById('capture-items-list');
  list.innerHTML = '';
  if (!roomItems.length) {
    list.innerHTML = '<div class="empty-state-small">No items yet. Tap + Add Item.</div>';
    return;
  }
  roomItems.forEach(item => {
    const card = createItemCard(item, room);
    list.appendChild(card);
  });
}

function createItemCard(item, room) {
  const code = getRoomCode(room.name);
  const roomItems = items.filter(it => it.roomId === room.id).sort((a,b)=>(a.order||0)-(b.order||0));
  const num = roomItems.findIndex(it => it.id === item.id) + 1;
  const itemNum = `${code}-${String(num).padStart(2, '0')}`;
  const sevClass = { critical:'sev-critical', high:'sev-high', medium:'sev-medium', low:'sev-low' }[item.severity] || 'sev-medium';

  const card = document.createElement('div');
  card.className = 'item-card' + (item.resolved ? ' resolved' : '');
  card.dataset.id = item.id;
  card.innerHTML = `
    <div class="item-card-body">
      <div class="item-card-header">
        <span class="item-num mono">${item.flagged ? '⚑ ' : ''}${itemNum}</span>
        <span class="badge ${sevClass}">${item.severity || 'medium'}</span>
        ${item.trade ? `<span class="trade-pill">${esc(item.trade)}</span>` : ''}
        ${item.resolved ? '<span class="badge badge-success">Resolved</span>' : ''}
        <span class="photo-count">${(item.photoIds||[]).length > 0 ? `📷 ${item.photoIds.length}` : ''}</span>
      </div>
      <div class="item-desc">${esc((item.description||'').slice(0,80))}</div>
    </div>
    <div class="item-card-actions">
      <button class="btn btn-sm" data-edit="${item.id}">Edit</button>
      <button class="btn btn-sm btn-danger" data-delete="${item.id}">Delete</button>
    </div>
  `;
  card.querySelector('[data-edit]').addEventListener('click', () => openItemPanel(item));
  card.querySelector('[data-delete]').addEventListener('click', async () => {
    if (!confirm('Delete this item?')) return;
    await deleteItem(item.id);
    items = items.filter(i => i.id !== item.id);
    renderItemsList();
    renderProgressBar();
  });
  return card;
}

function updateNavButtons() {
  document.getElementById('capture-prev-room').disabled = currentRoomIndex === 0;
  const nextBtn = document.getElementById('capture-next-room');
  if (currentRoomIndex === rooms.length - 1) {
    // Last room → highlighted "Finish & Review" button
    nextBtn.textContent = 'Finish & Review →';
    nextBtn.classList.add('btn-primary', 'btn-finish');
  } else {
    // More rooms to go → plain button, matching the "Prev" button
    nextBtn.textContent = 'Next Room →';
    nextBtn.classList.remove('btn-primary', 'btn-finish');
  }
}

function prevRoom() { if (currentRoomIndex > 0) { currentRoomIndex--; renderCapture(); } }

async function nextRoom() {
  if (currentRoomIndex === rooms.length - 1) {
    job.status = 'complete';
    job.updatedAt = Date.now();
    await saveJob(job);
    navigate('review', { jobId: job.id });
  } else {
    currentRoomIndex++;
    renderCapture();
  }
}

async function addRoomInPlace() {
  const name = prompt('Room name:');
  if (!name || !name.trim()) return;
  const newRoom = { id: generateId(), name: name.trim(), order: rooms.length };
  rooms.push(newRoom);
  job.rooms = rooms;
  job.updatedAt = Date.now();
  await saveJob(job);
  currentRoomIndex = rooms.length - 1;
  renderCapture();
  showToast(`Room "${name.trim()}" added`, 'success');
}

function openPlanForRoom() {
  if (!rooms.length) { showToast('Add a room first', 'error'); return; }
  openPlan(job, currentRoomIndex, () => { /* marker saved; nothing to refresh here */ });
}

async function renameCurrentRoom() {
  if (!rooms.length) return;
  const room = rooms[currentRoomIndex];
  const name = prompt('Rename room:', room.name || '');
  if (name === null) return;            // cancelled
  const trimmed = name.trim();
  if (!trimmed || trimmed === room.name) return;
  room.name = trimmed;
  job.rooms = rooms;
  job.updatedAt = Date.now();
  await saveJob(job);
  renderCapture();
  showToast('Room renamed', 'success');
}

function handleBack() {
  if (items.filter(i => rooms.map(r=>r.id).includes(i.roomId)).length > 0) {
    if (!confirm('Leave this job? Progress is saved.')) return;
  }
  navigate('home');
}

// Room Jump
function openRoomJump() {
  const list = document.getElementById('room-jump-list');
  list.innerHTML = '';
  rooms.forEach((r, i) => {
    const count = items.filter(it => it.roomId === r.id).length;
    const btn = document.createElement('button');
    btn.className = `room-jump-btn${i === currentRoomIndex ? ' active' : ''}`;
    btn.innerHTML = `<span>${esc(r.name)}</span><span class="mono">${count} items</span>`;
    btn.addEventListener('click', () => { currentRoomIndex = i; closeRoomJump(); renderCapture(); });
    list.appendChild(btn);
  });
  document.getElementById('room-jump-overlay').style.display = 'flex';
}
function closeRoomJump() { document.getElementById('room-jump-overlay').style.display = 'none'; }

// Item Panel
async function openItemPanel(item) {
  editingItem = item ? { ...item } : {
    id: generateId(),
    jobId: job.id,
    roomId: rooms[currentRoomIndex].id,
    description: '',
    expandedDescription: null,
    trade: '',
    severity: 'medium',
    flagged: false,
    order: items.filter(i => i.roomId === rooms[currentRoomIndex].id).length,
    photoIds: [],
    createdAt: Date.now()
  };

  editingPhotos = item ? await getPhotosForItem(item.id) : [];

  // Populate form
  document.getElementById('item-description').value = editingItem.description || '';
  document.getElementById('item-resolved').checked = !!editingItem.resolved;

  // Severity
  document.querySelectorAll('.sev-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sev === (editingItem.severity || 'medium'));
  });

  // Trade pills
  renderTradePills();
  renderPhotoThumbs();

  const aiBtn = document.getElementById('item-ai-btn');
  aiBtn.style.display = isAIEnabled() ? 'flex' : 'none';

  document.getElementById('item-panel').classList.add('open');
  document.getElementById('item-description').focus();
}

function closeItemPanel() {
  document.getElementById('item-panel').classList.remove('open');
  editingItem = null;
  editingPhotos = [];
}

function renderTradePills() {
  const container = document.getElementById('item-trades-container');
  container.innerHTML = '';
  const trades = (settings && settings.trades) ? settings.trades : [];
  if (!trades.length) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">Add trades in Settings</span>';
    return;
  }
  trades.forEach(trade => {
    const pill = document.createElement('button');
    pill.className = `trade-pill-btn${editingItem.trade === trade ? ' active' : ''}`;
    pill.textContent = trade;
    pill.addEventListener('click', () => {
      editingItem.trade = editingItem.trade === trade ? '' : trade;
      renderTradePills();
    });
    container.appendChild(pill);
  });
}

function renderPhotoThumbs() {
  const container = document.getElementById('item-photos-container');
  container.innerHTML = '';
  editingPhotos.forEach(p => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb-wrap';
    wrap.innerHTML = `
      <img src="${p.dataUrl}" class="photo-thumb" alt="photo">
      <button class="photo-remove-btn" title="Remove">✕</button>
    `;
    wrap.querySelector('.photo-remove-btn').addEventListener('click', async () => {
      if (p.id && p.id.startsWith('new-')) {
        editingPhotos = editingPhotos.filter(ph => ph.id !== p.id);
      } else {
        await deletePhoto(p.id);
        editingPhotos = editingPhotos.filter(ph => ph.id !== p.id);
        editingItem.photoIds = editingItem.photoIds.filter(id => id !== p.id);
      }
      renderPhotoThumbs();
    });
    container.appendChild(wrap);
  });
}

function initSevButtons() {
  document.querySelectorAll('#item-panel .sev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!editingItem) return;
      editingItem.severity = btn.dataset.sev;
      document.querySelectorAll('#item-panel .sev-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
}

async function handlePhotoSelect(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  // 1. Save full-resolution originals to the device immediately, BEFORE any
  //    async work — this keeps the user-gesture so mobile browsers allow it.
  files.forEach(file => saveFileToDevice(file));

  // 2. Store a small resized copy in the app DB for the report (NOT the original —
  //    storing full-res base64 bloats IndexedDB and breaks PDF generation).
  const maxPx = PHOTO_MAX[settings?.reportPrefs?.photoSize || 'medium'];
  for (const file of files) {
    const { dataUrl, w: imgW, h: imgH } = await resizeImage(file, maxPx, 0.7);
    const photo = {
      id: `new-${generateId()}`,
      itemId: editingItem.id,
      jobId: job.id,
      dataUrl,
      imgW,
      imgH,
      includeInReport: true,
      createdAt: Date.now()
    };
    editingPhotos.push(photo);
  }
  renderPhotoThumbs();
  e.target.value = '';
}

// Save the original file to the device's Downloads with a consistent SiteNote_
// prefix (Android Chrome cannot place downloads in a chosen subfolder, so the
// prefix at least groups all SiteNote photos together when sorted by name).
function saveFileToDevice(file) {
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    const ext = (file.name || '').split('.').pop() || 'jpg';
    a.href = url;
    a.download = `SiteNote_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  } catch(e) {
    console.warn('Gallery backup failed:', e);
  }
}

function saveOriginalToGallery(file) {
  // When using the camera, Android saves the photo to your gallery automatically.
  // For files picked from gallery, they are already there.
  // This function additionally saves a copy to Downloads as a backup.
  try {
    const url = URL.createObjectURL(file);
    const ext = (file.name || '').split('.').pop() || 'jpg';
    const filename = `SiteNote-${Date.now()}.${ext}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch(e) {
    console.warn('Could not save to downloads:', e);
  }
}

async function saveItemPanel() {
  editingItem.description = document.getElementById('item-description').value.trim();
  editingItem.resolved = document.getElementById('item-resolved').checked;

  // Save new photos to DB
  const newPhotos = editingPhotos.filter(p => p.id.startsWith('new-'));
  for (const p of newPhotos) {
    const realId = generateId();
    p.id = realId;
    await savePhoto(p);
    if (!editingItem.photoIds.includes(realId)) editingItem.photoIds.push(realId);
  }

  await saveItem(editingItem);

  const idx = items.findIndex(i => i.id === editingItem.id);
  if (idx >= 0) items[idx] = editingItem; else items.push(editingItem);

  closeItemPanel();
  renderItemsList();
  renderProgressBar();
  showToast('Item saved', 'success');
}

// Mic
function setupMic() {
  const micBtn = document.getElementById('item-mic-btn');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { micBtn.style.display = 'none'; return; }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = e => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ');
    const ta = document.getElementById('item-description');
    ta.value = (ta.value ? ta.value + ' ' : '') + transcript;
  };
  recognition.onend = () => { micBtn.classList.remove('listening'); };

  micBtn.addEventListener('click', () => {
    if (micBtn.classList.contains('listening')) {
      recognition.stop();
      micBtn.classList.remove('listening');
    } else {
      recognition.start();
      micBtn.classList.add('listening');
    }
  });
}

// AI expand
async function expandWithAI() {
  const s = await getSettings();
  if (!s.apiKey) { showToast('API key not set', 'error'); return; }
  const desc = document.getElementById('item-description').value.trim();
  if (!desc) { showToast('Enter a description first', 'error'); return; }

  const btn = document.getElementById('item-ai-btn');
  btn.classList.add('loading');
  btn.disabled = true;

  const original = desc;
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
    document.getElementById('item-description').value = expanded;

    // Undo button
    showUndoBtn(original);
  } catch (err) {
    showToast(`AI error: ${err.message}`, 'error');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function showUndoBtn(original) {
  let undo = document.getElementById('ai-undo-btn');
  if (!undo) {
    undo = document.createElement('button');
    undo.id = 'ai-undo-btn';
    undo.className = 'btn btn-sm';
    undo.textContent = 'Undo AI expansion';
    document.getElementById('item-ai-btn').after(undo);
  }
  undo.style.display = 'inline-flex';
  undo.onclick = () => {
    document.getElementById('item-description').value = original;
    undo.style.display = 'none';
  };
  setTimeout(() => { if (undo) undo.style.display = 'none'; }, 10000);
}

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
