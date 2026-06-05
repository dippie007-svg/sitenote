import { getJob, getSettings, getItemsForJob, getAllPhotosForJob } from './db.js';
import { formatDate, getRoomCode } from './utils.js';

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms))
  ]);
}

async function loadLogo() {
  // Returns { dataUrl, w, h }. Hardened with timeouts so it can never hang on mobile.
  try {
    const res = await withTimeout(fetch('./logo-dvm.jpg'), 4000, null);
    if (!res) return null;
    const blob = await res.blob();
    const dataUrl = await withTimeout(new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    }), 4000, null);
    if (!dataUrl) return null;
    const dims = await withTimeout(new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = dataUrl;
    }), 4000, { w: 1, h: 1 });
    return { dataUrl, ...dims };
  } catch(e) { return null; }
}

export async function generatePDF(jobId) {
  const { jsPDF } = window.jspdf;

  const [job, settings, allItems, allPhotos] = await Promise.all([
    getJob(jobId),
    getSettings(),
    getItemsForJob(jobId),
    getAllPhotosForJob(jobId)
  ]);

  const photoMap = {};
  allPhotos.forEach(p => {
    if (!photoMap[p.itemId]) photoMap[p.itemId] = [];
    photoMap[p.itemId].push(p);
  });

  const pageSize = settings.reportPrefs?.pageSize === 'letter' ? 'letter' : 'a4';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: pageSize });

  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const ml = 20, mr = 20, mt = 20;
  const cw = pw - ml - mr;

  const AMBER = [240, 165, 0];
  const DARK = [26, 31, 46];
  const GREY = [100, 100, 100];

  function setFont(style, size, color) {
    doc.setFont('helvetica', style || 'normal');
    doc.setFontSize(size || 10);
    doc.setTextColor(...(color || [30, 30, 30]));
  }

  function amberRule(y) {
    doc.setDrawColor(...AMBER);
    doc.setLineWidth(0.8);
    doc.line(ml, y, pw - mr, y);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
  }

  function thinRule(y) {
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(ml, y, pw - mr, y);
  }

  function greyRule(y) {
    doc.setDrawColor(160, 160, 160);
    doc.setLineWidth(0.8);
    doc.line(ml, y, pw - mr, y);
    doc.setLineWidth(0.2);
  }

  // ─── Cover page ───
  let y = mt;

  // Hard-coded header: logo left, contact details right
  const HEADER_H = 52; // tall enough for portrait logo + clearance above rule

  // Company logo (left) — natural aspect ratio, max 38mm wide
  const logo = await loadLogo();
  if (logo) {
    try {
      const maxW = 38;
      const maxH = HEADER_H - 2; // don't exceed header block height
      const ratio = logo.w / logo.h;
      let lw = maxW;
      let lh = lw / ratio;
      if (lh > maxH) { lh = maxH; lw = lh * ratio; }
      doc.addImage(logo.dataUrl, 'JPEG', ml, y, lw, lh, '', 'FAST');
    } catch(e) {}
  }

  // Contact details (right column)
  const contactLines = [
    { text: '1 De Villiers Drive, P O Box 472, DURBANVILLE, 7550', bold: false },
    { text: 'Tel: (021) 976 3087', bold: false },
    { text: 'Reg No. 1999/006693/07', bold: false },
    { text: 'Branch Offices: Stellenbosch & George', bold: false },
    { text: 'Email: admin@devmoore.co.za | Web: devmoore.co.za', bold: false },
    { text: 'Certified BEE Level 2 Contributor', bold: true },
  ];
  let cy = y + 4;
  contactLines.forEach(({ text, bold }) => {
    setFont(bold ? 'bold' : 'normal', 7.5, [60, 60, 60]);
    doc.text(text, pw - mr, cy, { align: 'right' });
    cy += 5.2;
  });

  y += HEADER_H;
  greyRule(y); y += 10;

  setFont('bold', 20, DARK);
  doc.text((job.reportType || 'INSPECTION REPORT').toUpperCase(), pw / 2, y, { align: 'center' });
  y += 14;

  const fields = [
    ['Property:', job.address || ''],
    ['Project:', job.clientName || ''],
    ['Date:', formatDate(job.date)],
    ['Project No:', job.reference || ''],
    ['Compiled By:', settings.surveyorName || ''],
    ['Contact:', [settings.email, settings.phone].filter(Boolean).join(' | ')]
  ];
  fields.forEach(([label, val]) => {
    if (!val) return;
    setFont('bold', 10, DARK); doc.text(label, ml, y);
    setFont('normal', 10, GREY); doc.text(val, ml + 28, y);
    y += 7;
  });

  y += 6;
  greyRule(y); y += 10;


  // ─── Room sections (continuous flow — rooms share pages if space allows) ───
  const roomPages = {};
  const rooms = job.rooms || [];

  // Start rooms on a new page after the cover
  doc.addPage();
  y = mt;

  const colW = (cw - 5) / 2;          // max width of a photo column
  const MAX_IMG_H = 64;               // upper cap on photo height
  const MIN_IMG_H = 28;               // never shrink photos below this
  const ROW_GAP = 10;                 // caption + spacing below each photo row
  const HEAD_BLOCK = 13;              // room heading text + rule + spacing
  const ITEM_HEADER = 6;              // item number / trade-severity line
  const ITEM_TRAILER = 8;             // spacing + thin rule after an item
  const PRE_ROOM = 6;                 // spacing before a room heading (mid-page)
  const PAGE_BOTTOM = ph - mt;
  const PAGE_TOP = mt;
  const USABLE = PAGE_BOTTOM - PAGE_TOP;
  const SAFETY = 6;                   // guard so estimation never overflows

  function getPhotoDims(photo) {
    if (photo.imgW && photo.imgH) return { w: photo.imgW, h: photo.imgH };
    return { w: 4, h: 3 }; // fallback: landscape 4:3
  }
  // Fit a photo inside colW × capH preserving aspect ratio
  function fitBox(photo, capH) {
    const d = getPhotoDims(photo);
    const ratio = d.w / d.h;
    let drawW = colW, drawH = colW / ratio;
    if (drawH > capH) { drawH = capH; drawW = capH * ratio; }
    return { w: drawW, h: drawH };
  }

  // ─── Build ordered "units" (one per item, room heading glued to first item) ───
  const units = [];
  for (const room of rooms) {
    const roomItems = allItems
      .filter(i => i.roomId === room.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const code = getRoomCode(room.name);
    roomItems.forEach((item, idx) => {
      setFont('normal', 10, DARK);
      const descLines = doc.splitTextToSize(item.expandedDescription || item.description || '', cw);
      const photos = (photoMap[item.id] || []).filter(p => p.includeInReport !== false).slice(0, 6);
      units.push({
        roomId: room.id,
        roomName: room.name || 'Unnamed Room',
        isFirstInRoom: idx === 0,
        itemNum: `${code}-${String(idx + 1).padStart(2, '0')}`,
        rightText: [item.trade, `[${(item.severity || 'medium').toUpperCase()}]`].filter(Boolean).join(' '),
        flagged: !!item.flagged,
        descLines,
        textH: ITEM_HEADER + descLines.length * 5 + 2,
        photos,
        photoRows: Math.ceil(photos.length / 2)
      });
    });
  }

  // ─── Pass 1: pack units into pages, max 3 photo rows per page ───
  const pages = [];
  let cur = { units: [], rows: 0 };
  for (const u of units) {
    if (cur.units.length > 0 && cur.rows + u.photoRows > 3) {
      pages.push(cur); cur = { units: [], rows: 0 };
    }
    cur.units.push(u);
    cur.rows += u.photoRows;
  }
  if (cur.units.length) pages.push(cur);

  // ─── Pass 2: render each page, sizing photos to fill it exactly ───
  pages.forEach((page, pIndex) => {
    if (pIndex > 0) doc.addPage();
    y = PAGE_TOP;

    // Fixed (non-photo) height consumed on this page
    let fixedH = 0;
    page.units.forEach((u, i) => {
      if (u.isFirstInRoom) fixedH += (i === 0 ? HEAD_BLOCK : PRE_ROOM + HEAD_BLOCK);
      fixedH += u.textH + ITEM_TRAILER + u.photoRows * ROW_GAP;
    });

    // Photo height that makes the content fill the page (capped & floored)
    let photoH = MAX_IMG_H;
    if (page.rows > 0) {
      const avail = USABLE - fixedH - SAFETY;
      photoH = Math.max(MIN_IMG_H, Math.min(MAX_IMG_H, avail / page.rows));
    }

    page.units.forEach((u, i) => {
      // Room heading
      if (u.isFirstInRoom) {
        if (i > 0) y += PRE_ROOM;
        roomPages[u.roomId] = doc.internal.getCurrentPageInfo().pageNumber;
        setFont('bold', 14, DARK);
        doc.text(u.roomName, ml, y);
        y += 2; greyRule(y); y += 8;
      }

      // Item header
      setFont('bold', 10, DARK);
      doc.text(`${u.flagged ? '⚑ ' : ''}${u.itemNum}`, ml, y);
      setFont('normal', 9, GREY);
      doc.text(u.rightText, pw - mr, y, { align: 'right' });
      y += 6;

      // Description
      setFont('normal', 10, DARK);
      u.descLines.forEach(line => { doc.text(line, ml, y); y += 5; });
      y += 2;

      // Photos — 2 per row, aspect preserved, sized to photoH
      for (let pi = 0; pi < u.photos.length; pi += 2) {
        const boxL = u.photos[pi]     ? fitBox(u.photos[pi], photoH)     : null;
        const boxR = u.photos[pi + 1] ? fitBox(u.photos[pi + 1], photoH) : null;
        const rowH = Math.max(boxL ? boxL.h : 0, boxR ? boxR.h : 0);
        [[u.photos[pi], boxL], [u.photos[pi + 1], boxR]].forEach(([photo, box], ci) => {
          if (!photo || !box) return;
          try {
            const slotX = ml + ci * (colW + 5);
            const x = slotX + (colW - box.w) / 2;
            doc.addImage(photo.dataUrl, 'JPEG', x, y, box.w, box.h, '', 'FAST');
            setFont('normal', 7, GREY);
            doc.text(`${u.itemNum} — Photo ${pi + ci + 1}`, slotX, y + rowH + 4);
          } catch(e) {}
        });
        y += rowH + ROW_GAP;
      }

      // Thin rule between items in the same room
      const next = page.units[i + 1];
      if (next && !next.isFirstInRoom) { y += 2; thinRule(y); y += 6; }
      else { y += 2; }
    });
  });

  // ─── Summary table ───
  if (settings.reportPrefs?.summaryTable !== false) {
    const criticalHigh = allItems.filter(i => i.severity === 'critical' || i.severity === 'high');
    if (criticalHigh.length) {
      doc.addPage();
      y = mt;
      setFont('bold', 13, DARK);
      doc.text('Summary — Critical & High Priority Items', ml, y);
      y += 4; greyRule(y); y += 8;

      const tableRows = criticalHigh.map(item => {
        const room = rooms.find(r => r.id === item.roomId);
        const code = room ? getRoomCode(room.name) : '?';
        const roomItems = allItems.filter(i => i.roomId === item.roomId).sort((a,b)=>(a.order||0)-(b.order||0));
        const num = roomItems.findIndex(i => i.id === item.id) + 1;
        return [
          `${code}-${String(num).padStart(2,'0')}`,
          room ? room.name : '',
          (item.expandedDescription || item.description || '').slice(0, 120),
          (item.severity || '').toUpperCase()
        ];
      });

      doc.autoTable({
        startY: y,
        head: [['Item', 'Room', 'Description', 'Severity']],
        body: tableRows,
        margin: { left: ml, right: mr },
        headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 245, 240] },
        columnStyles: { 2: { cellWidth: cw * 0.5 } },
        styles: { fontSize: 9, cellPadding: 3 }
      });
    }
  }

  // ─── TOC (insert as page 2) ───
  doc.insertPage(2);
  doc.setPage(2);
  y = mt;
  setFont('bold', 13, DARK);
  doc.text('Table of Contents', ml, y);
  y += 4; greyRule(y); y += 8;

  rooms.forEach(room => {
    const pg = roomPages[room.id];
    if (!pg) return;
    setFont('normal', 10, DARK);
    const roomName = room.name || 'Unnamed Room';
    const pgStr = String(pg + 1); // +1 because we inserted page 2
    const nameW = doc.getTextWidth(roomName);
    const pgW = doc.getTextWidth(pgStr);
    const dotW = cw - nameW - pgW - 2;
    doc.text(roomName, ml, y);
    if (dotW > 0) {
      const dots = '.'.repeat(Math.floor(dotW / doc.getTextWidth('.')));
      doc.text(dots, ml + nameW + 1, y);
    }
    doc.text(pgStr, pw - mr, y, { align: 'right' });
    y += 7;
  });

  if (settings.reportPrefs?.summaryTable !== false) {
    y += 4;
    setFont('italic', 9, GREY);
    doc.text('Summary Table — see end of report', ml, y);
  }

  // ─── Footers (skip cover page 1) ───
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    const fy = ph - 10;
    setFont('normal', 8, GREY);
    const left = 'de villiers & moore';
    const centre = `Ref: ${job.reference || ''}  |  ${formatDate(job.date)}`;
    const right = `Page ${p} of ${totalPages}`;
    doc.text(left, ml, fy);
    doc.text(centre, pw / 2, fy, { align: 'center' });
    doc.text(right, pw - mr, fy, { align: 'right' });
    thinRule(fy - 3);
  }

  const reference = (job.reference || 'report').replace(/[^a-zA-Z0-9-]/g, '-');
  const date = job.date || new Date().toISOString().slice(0, 10);
  // Add a time stamp (HHMMSS) so every generated report has a UNIQUE filename —
  // otherwise the phone keeps the old file and re-opens the stale version.
  const now = new Date();
  const stamp = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const filename = `SiteNote-${reference}-${date}-${stamp}.pdf`;

  return { blob: doc.output('blob'), filename };
}
