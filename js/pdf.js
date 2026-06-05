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

  const ROOM_HEAD_H = 16;
  const colW = (cw - 5) / 2;          // max width of a photo column
  const maxImgH = 45;                 // max photo height — keeps 3 room-blocks per page
  const ROW_GAP = 8;                  // caption + spacing below each photo row
  const ITEM_MIN_H = 20;

  function getPhotoDims(photo) {
    // Use stored dimensions (set at capture time) — no async Image loading needed
    if (photo.imgW && photo.imgH) return { w: photo.imgW, h: photo.imgH };
    // Fallback for old photos without stored dimensions
    return { w: 4, h: 3 }; // assume landscape 4:3
  }

  // Compute draw size for a photo, fitting inside colW × maxImgH while
  // KEEPING its aspect ratio. Returns { w, h } in mm.
  function fitBox(photo) {
    const d = getPhotoDims(photo);
    const ratio = d.w / d.h;            // width / height
    let drawW = colW;
    let drawH = drawW / ratio;
    if (drawH > maxImgH) {              // too tall → constrain by height
      drawH = maxImgH;
      drawW = drawH * ratio;
    }
    return { w: drawW, h: drawH };
  }

  // Minimum height to keep an item's header + description + first photo row together
  function itemKeepHeight(item) {
    let h = 6; // item header row
    const desc = item.expandedDescription || item.description || '';
    setFont('normal', 10, DARK);
    const lines = doc.splitTextToSize(desc, cw);
    h += Math.min(lines.length, 4) * 5 + 2; // cap at 4 lines for the keep-together block
    const photos = (photoMap[item.id] || []).filter(p => p.includeInReport !== false).slice(0, 6);
    if (photos.length) {
      const r0 = Math.max(fitBox(photos[0]).h, photos[1] ? fitBox(photos[1]).h : 0);
      h += r0 + ROW_GAP;
    }
    return h;
  }

  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri];

    const roomItems = allItems
      .filter(i => i.roomId === room.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const code = getRoomCode(room.name);

    if (ri > 0) {
      // Keep room heading together with its first item's header + first photo
      const firstNeed = roomItems.length ? itemKeepHeight(roomItems[0]) : ITEM_MIN_H;
      if (y + ROOM_HEAD_H + firstNeed > ph - mt) {
        doc.addPage(); y = mt;
      } else {
        y += 6;
      }
    }

    roomPages[room.id] = doc.internal.getCurrentPageInfo().pageNumber;

    setFont('bold', 14, DARK);
    doc.text(room.name || 'Unnamed Room', ml, y);
    y += 2; greyRule(y); y += 8;

    for (let idx = 0; idx < roomItems.length; idx++) {
      const item = roomItems[idx];
      const itemNum = `${code}-${String(idx + 1).padStart(2, '0')}`;
      const sevLabel = (item.severity || 'medium').toUpperCase();
      const fullDesc = item.expandedDescription || item.description || '';

      setFont('normal', 10, DARK);
      const descLines = doc.splitTextToSize(fullDesc, cw);
      // Keep item header + description + first photo row together (except first item,
      // which already moved with the room heading above)
      if (idx > 0 && y + itemKeepHeight(item) > ph - mt) { doc.addPage(); y = mt; }

      setFont('bold', 10, DARK);
      doc.text(`${item.flagged ? '⚑ ' : ''}${itemNum}`, ml, y);
      setFont('normal', 9, GREY);
      doc.text([item.trade, `[${sevLabel}]`].filter(Boolean).join(' '), pw - mr, y, { align: 'right' });
      y += 6;

      setFont('normal', 10, DARK);
      descLines.forEach(line => {
        if (y > ph - mt) { doc.addPage(); y = mt; }
        doc.text(line, ml, y); y += 5;
      });
      y += 2;

      // Photos — 2 per row, aspect ratio preserved, max 6
      const itemPhotos = (photoMap[item.id] || []).filter(p => p.includeInReport !== false);
      const shown = itemPhotos.slice(0, 6);
      const extra = itemPhotos.length - shown.length;

      for (let pi = 0; pi < shown.length; pi += 2) {
        const boxL = shown[pi]     ? fitBox(shown[pi])     : null;
        const boxR = shown[pi + 1] ? fitBox(shown[pi + 1]) : null;
        const rowH = Math.max(boxL ? boxL.h : 0, boxR ? boxR.h : 0);

        // Break to new page if this row won't fit
        if (y + rowH + ROW_GAP > ph - mt) { doc.addPage(); y = mt; }

        [[shown[pi], boxL], [shown[pi + 1], boxR]].forEach(([photo, box], ci) => {
          if (!photo || !box) return;
          try {
            // Centre the image horizontally within its column slot
            const slotX = ml + ci * (colW + 5);
            const x = slotX + (colW - box.w) / 2;
            doc.addImage(photo.dataUrl, 'JPEG', x, y, box.w, box.h, '', 'FAST');
            setFont('normal', 7, GREY);
            doc.text(`${itemNum} — Photo ${pi + ci + 1}`, slotX, y + rowH + 4);
          } catch(e) {}
        });
        y += rowH + ROW_GAP;
      }

      if (extra > 0) {
        setFont('italic', 8, GREY);
        doc.text(`(+ ${extra} additional photo${extra > 1 ? 's' : ''})`, ml, y);
        y += 6;
      }

      y += 2;
      if (idx < roomItems.length - 1) { thinRule(y); y += 6; }
    }
  }

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
  const filename = `SiteNote-${reference}-${date}.pdf`;

  return { blob: doc.output('blob'), filename };
}
