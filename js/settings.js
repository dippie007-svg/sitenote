import { getSettings, saveSettings, exportAllData, importAllData, clearAllData } from './db.js';
import { showToast, debounce, triggerDownload } from './utils.js';

let settings = null;

export function isAIEnabled() {
  return !!(settings && settings.aiEnabled && settings.apiKey);
}

async function load() {
  settings = await getSettings();
  render();
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function render() {
  const s = settings;
  setVal('setting-surveyor', s.surveyorName || '');
  setVal('setting-email', s.email || '');
  setVal('setting-phone', s.phone || '');

  const aiToggle = document.getElementById('setting-ai-enabled');
  aiToggle.checked = !!s.aiEnabled;
  document.getElementById('api-key-row').style.display = s.aiEnabled ? 'block' : 'none';
  setVal('setting-api-key', s.apiKey || '');

  document.getElementById('setting-summary-table').checked = s.reportPrefs?.summaryTable !== false;
  document.getElementById('setting-photo-size').value = s.reportPrefs?.photoSize || 'medium';
  document.getElementById('setting-page-size').value = s.reportPrefs?.pageSize || 'a4';

  const themeToggle = document.getElementById('setting-theme');
  themeToggle.checked = s.theme === 'light';
}

async function persist() {
  await saveSettings(settings);
  showToast('Saved ✓', 'success');
}
const debouncedSave = debounce(persist, 500);

export function initSettings() {
  // Branding inputs (company name + logo are hard-coded; trades moved to job data)
  ['surveyor','email','phone'].forEach(field => {
    const el = document.getElementById(`setting-${field}`);
    if (!el) return;
    el.addEventListener('input', e => {
      const key = field === 'surveyor' ? 'surveyorName' : field;
      settings[key] = e.target.value;
      debouncedSave();
    });
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
