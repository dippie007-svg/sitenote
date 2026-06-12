import { getAllJobs, deleteJob, getAllTemplates, saveTemplate, deleteTemplate, getItemsForJob, importJobBundle, duplicateJob } from './db.js';
import { navigate } from './router.js';
import { showToast, generateId, generateJobRef } from './utils.js';


export function initJobs() {
  document.getElementById('new-job-btn').addEventListener('click', () => navigate('setup', { jobId: null, mode: null, templateId: null }));
  document.getElementById('new-job-btn-2').addEventListener('click', () => navigate('setup', { jobId: null, mode: null, templateId: null }));
  document.getElementById('templates-btn').addEventListener('click', () => openTemplatesModal());

  document.getElementById('templates-modal-close').addEventListener('click', () => closeTemplatesModal());
  document.getElementById('templates-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTemplatesModal();
  });
  document.getElementById('new-template-btn').addEventListener('click', () => {
    closeTemplatesModal();
    navigate('setup', { mode: 'template' });
  });

  // Import a job bundle exported from another device
  document.getElementById('import-job-btn').addEventListener('click', () => {
    document.getElementById('import-job-input').click();
  });
  document.getElementById('import-job-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const jobId = await importJobBundle(bundle);
      showToast('Job imported successfully', 'success');
      loadJobs();
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    }
    e.target.value = '';
  });

  document.addEventListener('screen-shown', e => {
    if (e.detail.screen === 'home') loadJobs();
  });

  loadJobs();
}

async function loadJobs() {
  const jobs = await getAllJobs();
  const list = document.getElementById('jobs-list');
  const empty = document.getElementById('jobs-empty');

  if (!jobs.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = '';
  for (const job of jobs) {
    const items = await getItemsForJob(job.id);
    const card = createJobCard(job, items.length);
    list.appendChild(card);
  }
}

function createJobCard(job, itemCount) {
  const card = document.createElement('div');
  card.className = 'job-card';
  card.dataset.id = job.id;

  const statusClass = job.status === 'complete' ? 'badge-success' : 'badge-info';
  const statusLabel = job.status === 'complete' ? 'Complete' : 'In Progress';

  card.innerHTML = `
    <div class="job-card-main">
      <div class="job-card-header">
        <span class="job-ref mono">${job.reference || ''}</span>
        <span class="badge ${statusClass}">${statusLabel}</span>
        <button class="btn-icon base-job-btn" data-id="${job.id}" title="Use report as base" style="margin-left:auto">⎘</button>
        <button class="btn-icon delete-job-btn" data-id="${job.id}" title="Delete job" style="color:var(--danger)">🗑</button>
      </div>
      <div class="job-card-client">${esc(job.clientName)}</div>
      <div class="job-card-address">${esc(job.address || '')}</div>
      <div class="job-card-meta">
        <span>${job.date || ''}</span>
        <span class="badge badge-neutral">${esc(job.reportType || '')}</span>
        <span>${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
  `;

  // Tap card to navigate (ignore taps on the action buttons)
  card.querySelector('.job-card-main').addEventListener('click', e => {
    if (e.target.closest('.delete-job-btn') || e.target.closest('.base-job-btn')) return;
    navigate(job.status === 'complete' ? 'review' : 'capture', { jobId: job.id });
  });

  card.querySelector('.base-job-btn').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Use "${job.reference}" as a base?\nA new report will be created with the same details and today's date.`)) return;
    const jobs = await getAllJobs();
    const reference = generateJobRef(jobs);
    const date = new Date().toISOString().slice(0, 10);
    const newId = await duplicateJob(job.id, { reference, date, now: Date.now() });
    showToast('New report created from base', 'success');
    navigate('capture', { jobId: newId });
  });

  card.querySelector('.delete-job-btn').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Delete job ${job.reference}? This cannot be undone.`)) return;
    await deleteJob(job.id);
    showToast('Job deleted', 'info');
    loadJobs();
  });

  return card;
}


async function openTemplatesModal() {
  const templates = await getAllTemplates();
  const list = document.getElementById('templates-list');
  list.innerHTML = '';

  if (!templates.length) {
    list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem">No templates yet.</p>';
  } else {
    templates.forEach(t => {
      const item = document.createElement('div');
      item.className = 'template-item';
      item.innerHTML = `
        <div class="template-item-name">${esc(t.name)}</div>
        <div class="template-item-meta">${(t.rooms || []).length} rooms</div>
        <div class="template-item-actions">
          <button class="btn btn-sm" data-edit="${t.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-delete="${t.id}">Delete</button>
        </div>
      `;
      item.querySelector('[data-edit]').addEventListener('click', () => {
        closeTemplatesModal();
        navigate('setup', { mode: 'template', templateId: t.id });
      });
      item.querySelector('[data-delete]').addEventListener('click', async () => {
        if (!confirm(`Delete template "${t.name}"?`)) return;
        await deleteTemplate(t.id);
        openTemplatesModal();
        showToast('Template deleted', 'info');
      });
      list.appendChild(item);
    });
  }

  document.getElementById('templates-modal-overlay').style.display = 'flex';
}

function closeTemplatesModal() {
  document.getElementById('templates-modal-overlay').style.display = 'none';
}

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
