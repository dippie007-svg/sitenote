export function generateId() {
  return crypto.randomUUID();
}

export function generateJobRef(existingJobs) {
  const year = new Date().getFullYear();
  const prefix = `SN-${year}-`;
  const nums = existingJobs
    .map(j => j.reference)
    .filter(r => r && r.startsWith(prefix))
    .map(r => parseInt(r.slice(prefix.length), 10))
    .filter(n => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

let toastContainer;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(message, type = 'info') {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3000);
}

export function resizeImage(file, maxPx, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      // Scale down so the longest dimension fits within maxPx
      if (w > maxPx || h > maxPx) {
        if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else        { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      // Return dataUrl AND pixel dimensions so PDF can use correct aspect ratio
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), w, h });
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function triggerDownload(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export function formatDate(dateString) {
  if (!dateString) return '';
  const months = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  const d = new Date(dateString + 'T00:00:00');
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function getRoomCode(roomName) {
  if (!roomName) return 'X';
  const consonants = roomName.toUpperCase().replace(/[^BCDFGHJKLMNPQRSTVWXYZ]/g, '');
  return consonants.slice(0, 2) || roomName.slice(0, 1).toUpperCase();
}

export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
