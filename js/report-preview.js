import { navigate } from './router.js';
import { saveJob, getJob } from './db.js';
import { showToast } from './utils.js';

export function initReportPreview() {
  document.getElementById('preview-back-btn').addEventListener('click', () => navigate('review'));
  document.getElementById('preview-back-btn-2').addEventListener('click', () => navigate('review'));

  document.getElementById('preview-download-btn').addEventListener('click', downloadReport);
  document.getElementById('preview-share-btn').addEventListener('click', shareReport);
  document.getElementById('preview-complete-btn').addEventListener('click', markComplete);

  document.addEventListener('screen-shown', e => {
    if (e.detail.screen !== 'report-preview') return;
    loadPreview();
  });
}

function loadPreview() {
  const blob = window.appState.reportBlob;
  const filename = window.appState.reportFilename;
  if (!blob) { navigate('review'); return; }

  document.getElementById('preview-filename').textContent = filename || 'report.pdf';

  const url = URL.createObjectURL(blob);
  const iframe = document.getElementById('preview-iframe');
  iframe.src = url;
  iframe.onerror = () => showFallback();

  // Detect blank iframe on mobile
  iframe.onload = () => {
    try {
      if (!iframe.contentDocument || iframe.contentDocument.body.innerHTML === '') showFallback();
    } catch { showFallback(); }
  };

  // Store url for download/share
  window.appState.reportObjectUrl = url;
}

function showFallback() {
  document.getElementById('preview-iframe').style.display = 'none';
  document.getElementById('preview-fallback').style.display = 'block';
}

function downloadReport() {
  const blob = window.appState.reportBlob;
  const filename = window.appState.reportFilename || 'report.pdf';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function shareReport() {
  const blob = window.appState.reportBlob;
  const filename = window.appState.reportFilename || 'report.pdf';
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'SiteNote Report' }); return; }
      catch (e) { if (e.name !== 'AbortError') showToast('Share failed, downloading instead', 'info'); }
    }
  }
  downloadReport();
}

async function markComplete() {
  const jobId = window.appState.jobId;
  if (jobId) {
    const job = await getJob(jobId);
    if (job) { job.status = 'complete'; job.updatedAt = Date.now(); await saveJob(job); }
  }
  showToast('Job marked complete', 'success');
  navigate('home');
}
