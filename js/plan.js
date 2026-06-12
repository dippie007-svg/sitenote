import { getPlan, savePlan, getJob, saveJob } from './db.js';
import { resizeImage, showToast } from './utils.js';

let job = null;
let rooms = [];
let roomIndex = 0;
let plan = null;            // { id, dataUrl, w, h }
let planImg = null;         // loaded Image element
let marker = null;          // { xPct, yPct } current room's marker (0..1)
let scale = 1, panX = 0, panY = 0;
let onSaved = null;         // callback after save

// Crop a square-ish excerpt around the marker (fraction of the plan's size)
const EXCERPT_FRAC = 0.32;  // 32% of the plan width/height around the marker

export function initPlan() {
  document.getElementById('plan-close').addEventListener('click', closePlan);
  document.getElementById('plan-import-btn').addEventListener('click', () => document.getElementById('plan-import-input').click());
  document.getElementById('plan-import-input').addEventListener('change', handleImport);
  document.getElementById('plan-save-btn').addEventListener('click', saveMarker);
  document.getElementById('plan-clear-btn').addEventListener('click', clearMarker);
  document.getElementById('plan-zoom-in').addEventListener('click', () => zoomBy(1.25));
  document.getElementById('plan-zoom-out').addEventListener('click', () => zoomBy(0.8));

  const stage = document.getElementById('plan-stage');
  // Tap to place marker (ignore drags)
  let down = null, moved = false;
  stage.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; moved = false; });
  stage.addEventListener('pointermove', e => {
    if (!down) return;
    if (Math.abs(e.clientX - down.x) > 5 || Math.abs(e.clientY - down.y) > 5) {
      moved = true;
      panX += e.clientX - down.x; panY += e.clientY - down.y;
      down = { x: e.clientX, y: e.clientY };
      applyTransform();
    }
  });
  stage.addEventListener('pointerup', e => {
    if (down && !moved) placeMarkerFromEvent(e);
    down = null;
  });
  stage.addEventListener('pointercancel', () => { down = null; });
}

export async function openPlan(theJob, currentRoomIndex, savedCb) {
  job = theJob;
  rooms = job.rooms || [];
  roomIndex = currentRoomIndex || 0;
  onSaved = savedCb;
  plan = await getPlan(job.id);
  scale = 1; panX = 0; panY = 0;
  marker = rooms[roomIndex]?.mark ? { ...rooms[roomIndex].mark } : null;

  document.getElementById('plan-room-label').textContent = rooms[roomIndex]?.name || 'Room';
  document.getElementById('plan-modal').classList.add('on');
  await renderPlan();
}

function closePlan() {
  document.getElementById('plan-modal').classList.remove('on');
  planImg = null;
}

async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type === 'application/pdf') {
    showToast('Please export the plan as an image (PNG/JPG) and import that.', 'info');
    e.target.value = ''; return;
  }
  // Resize large plans to a reasonable max so storage/render stays fast
  const { dataUrl, w, h } = await resizeImage(file, 2000, 0.85);
  plan = { id: job.id, dataUrl, w, h };
  await savePlan(plan);
  scale = 1; panX = 0; panY = 0;
  await renderPlan();
  showToast('Drawing imported', 'success');
  e.target.value = '';
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderPlan() {
  const empty = document.getElementById('plan-empty');
  const stage = document.getElementById('plan-stage');
  const zoomwrap = document.getElementById('plan-zoomwrap');

  if (!plan) {
    empty.style.display = 'block';
    stage.style.display = 'none';
    document.getElementById('plan-save-btn').disabled = true;
    return;
  }
  empty.style.display = 'none';
  stage.style.display = 'block';
  document.getElementById('plan-save-btn').disabled = false;

  planImg = await loadImg(plan.dataUrl);

  // Fit the image to the stage width initially
  const stageW = stage.clientWidth || 320;
  const baseScale = stageW / plan.w;
  zoomwrap.innerHTML = '';
  const imgEl = document.createElement('img');
  imgEl.src = plan.dataUrl;
  imgEl.style.width = plan.w + 'px';
  imgEl.style.height = plan.h + 'px';
  imgEl.style.display = 'block';
  zoomwrap.appendChild(imgEl);

  // Marker element
  const markEl = document.createElement('div');
  markEl.id = 'plan-marker';
  markEl.className = 'plan-marker';
  markEl.style.display = 'none';
  zoomwrap.appendChild(markEl);

  zoomwrap.dataset.base = baseScale;
  scale = baseScale;
  panX = 0; panY = 0;
  applyTransform();
  updateMarkerEl();
}

function applyTransform() {
  const zoomwrap = document.getElementById('plan-zoomwrap');
  zoomwrap.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
}

function zoomBy(f) {
  scale *= f;
  applyTransform();
}

function placeMarkerFromEvent(e) {
  const zoomwrap = document.getElementById('plan-zoomwrap');
  const rect = zoomwrap.getBoundingClientRect();
  // position within the (scaled) image
  const xPct = (e.clientX - rect.left) / rect.width;
  const yPct = (e.clientY - rect.top) / rect.height;
  if (xPct < 0 || xPct > 1 || yPct < 0 || yPct > 1) return;
  marker = { xPct, yPct };
  updateMarkerEl();
}

function updateMarkerEl() {
  const markEl = document.getElementById('plan-marker');
  if (!markEl) return;
  if (!marker) { markEl.style.display = 'none'; return; }
  markEl.style.display = 'flex';
  markEl.style.left = (marker.xPct * plan.w) + 'px';
  markEl.style.top = (marker.yPct * plan.h) + 'px';
  markEl.textContent = roomCodeFor(rooms[roomIndex]);
}

function roomCodeFor(room) {
  if (!room || !room.name) return '?';
  const c = room.name.toUpperCase().replace(/[^BCDFGHJKLMNPQRSTVWXYZ]/g, '');
  return c.slice(0, 2) || room.name.slice(0, 1).toUpperCase();
}

function clearMarker() {
  marker = null;
  updateMarkerEl();
}

async function saveMarker() {
  if (!plan) { showToast('Import a drawing first', 'error'); return; }
  const room = rooms[roomIndex];
  if (!room) return;

  if (!marker) {
    // Clearing the room's plan marker/excerpt
    delete room.mark; delete room.excerpt; delete room.excerptW; delete room.excerptH;
  } else {
    room.mark = { ...marker };
    // Crop an excerpt around the marker from the full-res plan
    const ex = cropExcerpt();
    if (ex) { room.excerpt = ex.dataUrl; room.excerptW = ex.w; room.excerptH = ex.h; }
  }
  job.rooms = rooms;
  job.updatedAt = Date.now();
  await saveJob(job);
  showToast('Plan marker saved', 'success');
  closePlan();
  if (onSaved) onSaved();
}

function cropExcerpt() {
  if (!planImg || !marker) return null;
  const cw = Math.round(plan.w * EXCERPT_FRAC);
  const ch = Math.round(plan.h * EXCERPT_FRAC);
  let cx = Math.round(marker.xPct * plan.w - cw / 2);
  let cy = Math.round(marker.yPct * plan.h - ch / 2);
  cx = Math.max(0, Math.min(cx, plan.w - cw));
  cy = Math.max(0, Math.min(cy, plan.h - ch));

  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(planImg, cx, cy, cw, ch, 0, 0, cw, ch);

  // Draw a marker dot at the centre of the excerpt
  ctx.fillStyle = 'rgba(240,165,0,0.9)';
  ctx.strokeStyle = '#1a1f2e';
  ctx.lineWidth = Math.max(2, cw / 80);
  const mx = marker.xPct * plan.w - cx;
  const my = marker.yPct * plan.h - cy;
  const r = Math.max(6, cw / 25);
  ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.8), w: cw, h: ch };
}
