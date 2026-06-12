// Native IndexedDB wrapper — no npm dependency required
const DB_NAME = 'sitenote-db';
const DB_VERSION = 2;

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('jobs')) {
        const jobs = db.createObjectStore('jobs', { keyPath: 'id' });
        jobs.createIndex('status', 'status', { unique: false });
        jobs.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('items')) {
        const items = db.createObjectStore('items', { keyPath: 'id' });
        items.createIndex('jobId', 'jobId', { unique: false });
        items.createIndex('roomId', 'roomId', { unique: false });
      }
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('itemId', 'itemId', { unique: false });
        photos.createIndex('jobId', 'jobId', { unique: false });
      }
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('plans')) {
        db.createObjectStore('plans', { keyPath: 'id' }); // id = jobId
      }
    };
    req.onsuccess = e => { dbInstance = e.target.result; resolve(dbInstance); };
    req.onerror = e => reject(e.target.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = Array.isArray(store) ? null : t.objectStore(store);
    const req = fn(s, t);
    if (req && req.onsuccess !== undefined) {
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    } else {
      t.oncomplete = () => resolve();
      t.onerror = e => reject(e.target.error);
    }
  }));
}

function getAll(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const req = t.objectStore(store).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  }));
}

function getAllByIndex(store, index, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const req = t.objectStore(store).index(index).getAll(value);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  }));
}

function getOne(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const req = t.objectStore(store).get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  }));
}

function put(store, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const req = t.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  }));
}

function del(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const req = t.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  }));
}

function clearStore(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const req = t.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  }));
}

// ── Public API ──

const DEFAULT_SETTINGS = {
  key: 'main',
  companyName: '',
  surveyorName: '',
  email: '',
  phone: '',
  logoDataUrl: null,
  aiEnabled: false,
  apiKey: '',
  trades: [],
  reportPrefs: { summaryTable: true, photoSize: 'medium', pageSize: 'a4' },
  theme: 'dark'
};

export function initDB() { return openDB(); }

// One-time migration: strip the huge full-res `originalUrl` field that older
// versions stored on every photo. Leaving it in bloats memory and breaks PDF
// generation on mobile. Runs quickly and is a no-op once clean.
export async function migratePhotos() {
  try {
    const photos = await getAll('photos');
    let cleaned = 0;
    for (const p of photos) {
      if ('originalUrl' in p) {
        delete p.originalUrl;
        await put('photos', p);
        cleaned++;
      }
    }
    if (cleaned) console.log(`Migrated ${cleaned} photo(s) — removed originalUrl`);
  } catch(e) {
    console.warn('Photo migration skipped:', e);
  }
}

export async function getSettings() {
  const s = await getOne('settings', 'main');
  if (!s) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...s, reportPrefs: { ...DEFAULT_SETTINGS.reportPrefs, ...(s.reportPrefs || {}) } };
}

export async function saveSettings(obj) {
  await put('settings', { ...obj, key: 'main' });
}

export async function getAllJobs() {
  const all = await getAll('jobs');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// Duplicate a job (rooms, items, photos, plan) into a brand-new job.
// overrides: { reference, date, now }. Items keep their content but are reset to
// unresolved so the new report starts with everything outstanding.
export async function duplicateJob(sourceId, overrides = {}) {
  const src = await getOne('jobs', sourceId);
  if (!src) throw new Error('Source job not found');
  const srcItems = await getAllByIndex('items', 'jobId', sourceId);
  const srcPhotos = await getAllByIndex('photos', 'jobId', sourceId);
  const srcPlan = await getOne('plans', sourceId);

  const newJobId = crypto.randomUUID();
  const now = overrides.now || Date.now();

  // Map old → new ids
  const itemIdMap = {};
  srcItems.forEach(it => { itemIdMap[it.id] = crypto.randomUUID(); });
  const photoIdMap = {};
  srcPhotos.forEach(p => { photoIdMap[p.id] = crypto.randomUUID(); });

  const newJob = {
    ...src,
    id: newJobId,
    reference: overrides.reference || src.reference,
    date: overrides.date || src.date,
    status: 'in-progress',
    rooms: (src.rooms || []).map(r => ({ ...r })),  // keep room ids + plan excerpts
    createdAt: now,
    updatedAt: now
  };
  await put('jobs', newJob);

  for (const it of srcItems) {
    const newItem = {
      ...it,
      id: itemIdMap[it.id],
      jobId: newJobId,
      resolved: false,
      photoIds: (it.photoIds || []).map(pid => photoIdMap[pid]).filter(Boolean)
    };
    await put('items', newItem);
  }
  for (const p of srcPhotos) {
    await put('photos', { ...p, id: photoIdMap[p.id], jobId: newJobId, itemId: itemIdMap[p.itemId] });
  }
  if (srcPlan) await put('plans', { ...srcPlan, id: newJobId });

  return newJobId;
}

export async function saveJob(job) { await put('jobs', job); }
export async function getJob(id) { return getOne('jobs', id); }

export async function deleteJob(id) {
  const items = await getItemsForJob(id);
  for (const item of items) {
    const photos = await getPhotosForItem(item.id);
    for (const p of photos) await del('photos', p.id);
    await del('items', item.id);
  }
  try { await del('plans', id); } catch(e) {}
  await del('jobs', id);
}

export async function getItemsForJob(jobId) {
  const all = await getAllByIndex('items', 'jobId', jobId);
  return all.sort((a, b) => {
    if (a.roomId < b.roomId) return -1;
    if (a.roomId > b.roomId) return 1;
    return (a.order || 0) - (b.order || 0);
  });
}

export async function saveItem(item) { await put('items', item); }
export async function deleteItem(id) {
  const photos = await getPhotosForItem(id);
  for (const p of photos) await del('photos', p.id);
  await del('items', id);
}

export async function getPhotosForItem(itemId) { return getAllByIndex('photos', 'itemId', itemId); }
export async function getAllPhotosForJob(jobId) { return getAllByIndex('photos', 'jobId', jobId); }
export async function savePhoto(photo) { await put('photos', photo); }
export async function deletePhoto(id) { await del('photos', id); }

// ── Plan (imported drawing) per job ──
export async function getPlan(jobId) { return getOne('plans', jobId); }
export async function savePlan(plan) { await put('plans', plan); }
export async function deletePlan(jobId) { await del('plans', jobId); }

export async function getAllTemplates() { return getAll('templates'); }
export async function saveTemplate(template) { await put('templates', template); }
export async function deleteTemplate(id) { await del('templates', id); }

// Export a single job bundle (job + its items + photos + plan) for transfer
export async function exportJobBundle(jobId) {
  const job = await getOne('jobs', jobId);
  const items = await getAllByIndex('items', 'jobId', jobId);
  const photos = await getAllByIndex('photos', 'jobId', jobId);
  const plan = await getOne('plans', jobId);
  return { type: 'sitenote-job', version: 1, job, items, photos, plan: plan || null };
}

// Import a single job bundle (merge — overwrites by id, does NOT clear other data)
export async function importJobBundle(bundle) {
  if (!bundle || !bundle.job) throw new Error('Not a valid SiteNote job file');
  await put('jobs', bundle.job);
  for (const it of (bundle.items || [])) await put('items', it);
  for (const ph of (bundle.photos || [])) await put('photos', ph);
  if (bundle.plan) await put('plans', bundle.plan);
  return bundle.job.id;
}

export async function exportAllData() {
  const [jobs, items, photos, templates, settings, plans] = await Promise.all([
    getAll('jobs'), getAll('items'), getAll('photos'), getAll('templates'), getAll('settings'), getAll('plans')
  ]);
  return { jobs, items, photos, templates, settings, plans };
}

export async function importAllData(data) {
  for (const store of ['jobs', 'items', 'photos', 'templates', 'settings', 'plans']) {
    await clearStore(store);
    if (data[store]) {
      for (const item of data[store]) await put(store, item);
    }
  }
}

export async function clearAllData() {
  for (const store of ['jobs', 'items', 'photos', 'templates', 'settings', 'plans']) {
    await clearStore(store);
  }
}
