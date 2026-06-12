import { saveJob, getJob, getAllJobs, getAllTemplates, saveTemplate } from './db.js';
import { navigate, goBack } from './router.js';
import { generateId, generateJobRef, showToast } from './utils.js';

let rooms = [];
let currentJobId = null;
let isTemplateMode = false;
let editingTemplateId = null;
let dragSrc = null;

export function initSetup() {
  document.getElementById('setup-cancel-btn').addEventListener('click', () => navigate('home'));
  document.getElementById('setup-start-btn').addEventListener('click', startInspection);
  document.getElementById('add-room-btn').addEventListener('click', () => addRoom(''));
  document.getElementById('save-template-btn').addEventListener('click', saveAsTemplate);

  document.getElementById('setup-template-select').addEventListener('change', async e => {
    const val = e.target.value;
    if (val === '') { rooms = []; renderRooms(); return; }
    const templates = await getAllTemplates();
    const t = templates.find(t => t.id === val);
    if (t) { rooms = (t.rooms || []).map(r => ({ ...r, id: generateId() })); renderRooms(); }
  });

  document.addEventListener('screen-shown', async e => {
    if (e.detail.screen !== 'setup') return;
    const { mode, templateId, jobId } = window.appState || {};
    isTemplateMode = mode === 'template';
    editingTemplateId = templateId || null;
    currentJobId = jobId || null;

    if (isTemplateMode) {
      document.getElementById('setup-title').textContent = editingTemplateId ? 'Edit Template' : 'New Template';
      document.getElementById('setup-start-btn').textContent = 'Save Template';
      document.getElementById('setup-job-fields').style.display = 'none';
      document.getElementById('setup-template-row').style.display = 'none';
      if (editingTemplateId) {
        const templates = await getAllTemplates();
        const t = templates.find(t => t.id === editingTemplateId);
        if (t) {
          document.getElementById('setup-template-name').value = t.name;
          rooms = (t.rooms || []).map(r => ({ ...r }));
        }
      } else {
        document.getElementById('setup-template-name').value = '';
        rooms = [];
      }
      document.getElementById('setup-template-name-row').style.display = 'block';
    } else {
      // Editing an existing job vs. creating a new one
      document.getElementById('setup-title').textContent = currentJobId ? 'Edit Job' : 'New Job';
      document.getElementById('setup-start-btn').textContent = currentJobId ? 'Save' : 'Start Inspection';
      document.getElementById('setup-job-fields').style.display = 'block';
      document.getElementById('setup-template-row').style.display = 'flex';
      document.getElementById('setup-template-name-row').style.display = 'none';

      if (currentJobId) {
        const job = await getJob(currentJobId);
        if (job) populateJobForm(job);
      } else {
        resetJobForm();
      }
      await populateTemplateSelect();
    }
    renderRooms();
  });
}

async function populateTemplateSelect() {
  const select = document.getElementById('setup-template-select');
  const templates = await getAllTemplates();
  select.innerHTML = '<option value="">Start blank</option>' +
    templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
}

async function resetJobForm() {
  const jobs = await getAllJobs();
  document.getElementById('setup-ref').value = generateJobRef(jobs);
  document.getElementById('setup-client').value = '';
  document.getElementById('setup-address').value = '';
  document.getElementById('setup-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('setup-type').value = 'Defect Inspection';
  document.getElementById('setup-template-select').value = '';
  rooms = [];
}

function populateJobForm(job) {
  document.getElementById('setup-ref').value = job.reference || '';
  document.getElementById('setup-client').value = job.clientName || '';
  document.getElementById('setup-address').value = job.address || '';
  document.getElementById('setup-date').value = job.date || '';
  document.getElementById('setup-type').value = job.reportType || 'Defect Inspection';
  rooms = (job.rooms || []).map(r => ({ ...r }));
}

function addRoom(name) {
  rooms.push({ id: generateId(), name: name || '', order: rooms.length });
  renderRooms();
  const inputs = document.querySelectorAll('.room-name-input');
  if (inputs.length) { const last = inputs[inputs.length - 1]; last.focus(); last.select(); }
}

function renderRooms() {
  const list = document.getElementById('rooms-list');
  list.innerHTML = '';
  rooms.forEach((room, i) => {
    const li = document.createElement('li');
    li.className = 'room-item';
    li.draggable = true;
    li.dataset.index = i;
    li.innerHTML = `
      <span class="drag-handle">⠿</span>
      <input class="room-name-input" value="${esc(room.name)}" placeholder="Room name" data-index="${i}">
      <button class="btn-icon room-delete-btn" data-index="${i}" aria-label="Remove room">✕</button>
    `;
    li.querySelector('.room-name-input').addEventListener('input', e => {
      rooms[+e.target.dataset.index].name = e.target.value;
    });
    li.querySelector('.room-delete-btn').addEventListener('click', e => {
      rooms.splice(+e.currentTarget.dataset.index, 1);
      renderRooms();
    });
    li.addEventListener('dragstart', e => { dragSrc = li; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => { li.classList.remove('dragging'); dragSrc = null; });
    li.addEventListener('dragover', e => { e.preventDefault(); });
    li.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === li) return;
      const from = +dragSrc.dataset.index;
      const to = +li.dataset.index;
      const [item] = rooms.splice(from, 1);
      rooms.splice(to, 0, item);
      renderRooms();
    });
    list.appendChild(li);
  });
}

function syncRoomNamesFromDOM() {
  document.querySelectorAll('.room-name-input').forEach(input => {
    const i = +input.dataset.index;
    if (rooms[i] !== undefined) rooms[i].name = input.value;
  });
}

async function startInspection() {
  syncRoomNamesFromDOM();
  if (isTemplateMode) {
    const name = document.getElementById('setup-template-name').value.trim();
    if (!name) { showToast('Template name required', 'error'); return; }
    const template = {
      id: editingTemplateId || generateId(),
      name,
      rooms: rooms.map((r, i) => ({ ...r, order: i }))
    };
    const { saveTemplate } = await import('./db.js');
    await saveTemplate(template);
    showToast('Template saved', 'success');
    navigate('home');
    return;
  }

  const client = document.getElementById('setup-client').value.trim();
  if (!client) { showToast('Project name is required', 'error'); return; }

  // When editing, preserve the existing job's status, createdAt and any extra fields
  const existing = currentJobId ? await getJob(currentJobId) : null;

  const job = {
    ...(existing || {}),
    id: currentJobId || generateId(),
    reference: document.getElementById('setup-ref').value.trim(),
    clientName: client,
    address: document.getElementById('setup-address').value.trim(),
    date: document.getElementById('setup-date').value,
    reportType: document.getElementById('setup-type').value,
    status: existing ? existing.status : 'in-progress',
    rooms: rooms.map((r, i) => ({ ...r, order: i })),
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now()
  };

  await saveJob(job);
  if (existing) {
    showToast('Job saved', 'success');
    navigate('review', { jobId: job.id });
  } else {
    navigate('capture', { jobId: job.id });
  }
}

async function saveAsTemplate() {
  const name = prompt('Template name:');
  if (!name) return;
  const { saveTemplate } = await import('./db.js');
  await saveTemplate({ id: generateId(), name, rooms: rooms.map((r, i) => ({ ...r, order: i })) });
  showToast('Saved as template', 'success');
}

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
