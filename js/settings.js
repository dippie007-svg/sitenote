import { getSettings, saveSettings, exportAllData, importAllData, clearAllData } from './db.js';
import { showToast, debounce, triggerDownload } from './utils.js';

let settings = null;
let dragSrc = null;

export function isAIEnabled() {
  return !!(settings && settings.aiEnabled && settings.apiKey);
}

async function load() {
  settings = await getSettings();
  render();
}

function render() {
  const s = settings;
  document.getElementById('setting-company').value = s.companyName || '';
  document.getElementById('setting-surveyor').value = s.surveyorName || '';
  document.getElementById('setting-email').value = s.email || '';
  document.getElementById('setting-phone').value = s.phone || '';

  const logoPreview = document.getElementById('logo-preview');
  if (s.logoDataUrl) {
    logoPreview.src = s.logoDataUrl;
    logoPreview.style.display = 'block';
  } else {
    logoPreview.style.display = 'none';
  }

  const aiToggle = document.getElementById('setting-ai-enabled');
  aiToggle.checked = !!s.aiEnabled;
  document.getElementById('api-key-row').style.display = s.aiEnabled ? 'block' : 'none';
  document.getElementById('setting-api-key').value = s.apiKey || '';

  renderTrades();

  document.getElementById('setting-summary-table').checked = s.reportPrefs?.summaryTable !== false;
  document.getElementById('setting-photo-size').value = s.reportPrefs?.photoSize || 'medium';
  document.getElementById('setting-page-size').value = s.reportPrefs?.pageSize || 'a4';

  const themeToggle = document.getElementById('setting-theme');
  themeToggle.checked = s.theme === 'light';
}

function renderTrades() {
  const list = document.getElementById('trades-list');
  list.innerHTML = '';
  (settings.trades || []).forEach((trade, i) => {
    const li = document.createElement('li');
    li.className = 'trade-item';
    li.draggable = true;
    li.dataset.index = i;
    li.innerHTML = `
      <span class="drag-handle">⠿</span>
      <input class="trade-input" value="${escHtml(trade)}" data-index="${i}">
      <button class="btn-icon trade-delete" data-index="${i}" aria-label="Delete trade">✕</button>
    `;
    li.addEventListener('dragstart', onDragStart);
    li.addEventListener('dragover', onDragOver);
    li.addEventListener('drop', onDrop);
    li.addEventListener('dragend', onDragEnd);
    li.querySelector('.trade-input').addEventListener('change', e => {
      settings.trades[+e.target.dataset.index] = e.target.value;
      debouncedSave();
    });
    li.querySelector('.trade-delete').addEventListener('click', e => {
      settings.trades.splice(+e.currentTarget.dataset.index, 1);
      renderTrades();
      debouncedSave();
    });
    list.appendChild(li);
  });
}

function onDragStart(e) { dragSrc = this; this.classList.add('dragging'); }
function onDragEnd() { this.classList.remove('dragging'); dragSrc = null; }
function onDragOver(e) { e.preventDefault(); }
function onDrop(e) {
  e.preventDefault();
  if (!dragSrc || dragSrc === this) return;
  const from = +dragSrc.dataset.index;
  const to = +this.dataset.index;
  const [item] = settings.trades.splice(from, 1);
  settings.trades.splice(to, 0, item);
  renderTrades();
  debouncedSave();
}

async function persist() {
  await saveSettings(settings);
  showToast('Saved ✓', 'success');
}
const debouncedSave = debounce(persist, 500);

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function initSettings() {
  // Branding inputs (company name removed — hard-coded)
  ['surveyor','email','phone'].forEach(field => {
    const el = document.getElementById(`setting-${field}`);
    if (!el) return;
    el.addEventListener('input', e => {
      const key = field === 'surveyor' ? 'surveyorName' : field;
      settings[key] = e.target.value;
      debouncedSave();
    });
  });

  // Logo
  document.getElementById('logo-upload').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      settings.logoDataUrl = ev.target.result;
      const preview = document.getElementById('logo-preview');
      preview.src = ev.target.result;
      preview.style.display = 'block';
      debouncedSave();
    };
    reader.readAsDataURL(file);
  });

  // AI toggle
  document.getElementById('setting-ai-enabled').addEventListener('change', e => {
    settings.aiEnabled = e.target.checked;
    document.getElementById('api-key-row').style.display = settings.aiEnabled ? 'block' : 'none';
    debouncedSave();
  });

  document.getElementById('setting-api-key').addEventListener('input', e => {
    settings.apiKey = e.target.value;
    debouncedSave();
  });

  // Add trade
  document.getElementById('add-trade-btn').addEventListener('click', () => {
    settings.trades.push('New Trade');
    renderTrades();
    // focus the new input
    const inputs = document.querySelectorAll('.trade-input');
    if (inputs.length) { const last = inputs[inputs.length-1]; last.focus(); last.select(); }
    debouncedSave();
  });

  // Report prefs
  document.getElementById('setting-summary-table').addEventListener('change', e => {
    settings.reportPrefs.summaryTable = e.target.checked;
    debouncedSave();
  });
  document.getElementById('setting-photo-size').addEventListener('change', e => {
    settings.reportPrefs.photoSize = e.target.value;
    debouncedSave();
  });
  document.getElementById('setting-page-size').addEventListener('change', e => {
    settings.reportPrefs.pageSize = e.target.value;
    debouncedSave();
  });

  // Theme
  document.getElementById('setting-theme').addEventListener('change', e => {
    const theme = e.target.checked ? 'light' : 'dark';
    settings.theme = theme;
    document.body.dataset.theme = theme;
    debouncedSave();
  });

  // Export
  document.getElementById('export-data-btn').addEventListener('click', async () => {
    const data = await exportAllData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0,10);
    triggerDownload(url, `sitenote-backup-${date}.json`);
    URL.revokeObjectURL(url);
  });

  // Import
  document.getElementById('import-data-btn').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('This will replace ALL current data. Are you sure?')) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importAllData(data);
      settings = await getSettings();
      render();
      showToast('Data imported successfully', 'success');
    } catch {
      showToast('Import failed — invalid file', 'error');
    }
    e.target.value = '';
  });

  // Clear all
  document.getElementById('clear-data-btn').addEventListener('click', () => {
    const modal = document.getElementById('clear-confirm-modal');
    modal.style.display = 'flex';
  });
  document.getElementById('clear-cancel-btn').addEventListener('click', () => {
    document.getElementById('clear-confirm-modal').style.display = 'none';
    document.getElementById('clear-confirm-input').value = '';
  });
  document.getElementById('clear-confirm-btn').addEventListener('click', async () => {
    const val = document.getElementById('clear-confirm-input').value;
    if (val !== 'DELETE') { showToast('Type DELETE to confirm', 'error'); return; }
    await clearAllData();
    settings = await getSettings();
    render();
    document.getElementById('clear-confirm-modal').style.display = 'none';
    document.getElementById('clear-confirm-input').value = '';
    showToast('All data cleared', 'info');
  });

  document.addEventListener('screen-shown', e => {
    if (e.detail.screen === 'settings') load();
  });

  load();
}
