import { getJob, getSettings, getItemsForJob, getAllPhotosForJob } from './db.js';
import { formatDate, getRoomCode } from './utils.js';

async function loadLogo() {
  // Returns { dataUrl, w, h } where w/h are natural pixel dimensions
  try {
    const res = await fetch('./logo-dvm.jpg');
    const blob = await res.blob();
    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    if (!dataUrl) return null;
    const dims = await new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = dataUrl;
    });
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

  const ROOM_HEAD_H = 22;
  const colW = (cw - 5) / 2;
  const maxImgH = 55; // 3 rows of 65mm = 195mm, fits on any page
  // Only require room for heading + item header + one description line (no photo)
  // Photos flow naturally to next page if needed
  const ITEM_MIN_H = 20;

  function imgDims(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = dataUrl;
    });
  }

  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri];

    if (ri > 0) {
      if (y + ROOM_HEAD_H + ITEM_MIN_H > ph - mt) {
        doc.addPage(); y = mt;
      } else {
        y += 8;
      }
    }

    roomPages[room.id] = doc.internal.getCurrentPageInfo().pageNumber;

    setFont('bold', 14, DARK);
    doc.text(room.name || 'Unnamed Room', ml, y);
    y += 2; greyRule(y); y += 8;

    const roomItems = allItems
      .filter(i => i.roomId === room.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const code = getRoomCode(room.name);

    for (let idx = 0; idx < roomItems.length; idx++) {
      const item = roomItems[idx];
      const itemNum = `${code}-${String(idx + 1).padStart(2, '0')}`;
      const sevLabel = (item.severity || 'medium').toUpperCase();
      const fullDesc = item.expandedDescription || item.description || '';

      setFont('normal', 10, DARK);
      const descLines = doc.splitTextToSize(fullDesc, cw);
      if (y + 6 + (descLines.length > 0 ? 5 : 0) > ph - mt) { doc.addPage(); y = mt; }

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

      // Photos — 2 per row, correct aspect ratio, max 6
      const itemPhotos = (photoMap[item.id] || []).filter(p => p.includeInReport !== false);
      const shown = itemPhotos.slice(0, 6);
      const extra = itemPhotos.length - shown.length;

      // Await all image dimensions so aspect ratio is correct
      const dims = await Promise.all(shown.map(p => imgDims(p.dataUrl)));

      const calcH = (i) => {
        const d = dims[i];
        if (!d || !d.w) return maxImgH;
        return Math.min(maxImgH, Math.round((d.h / d.w) * colW));
      };

      for (let pi = 0; pi < shown.length; pi += 2) {
        const rowH = Math.max(
          shown[pi]     ? calcH(pi)     : 0,
          shown[pi + 1] ? calcH(pi + 1) : 0
        );
        if (y + rowH + 10 > ph - mt) { doc.addPage(); y = mt; }

        [shown[pi], shown[pi + 1]].forEach((photo, ci) => {
          if (!photo) return;
          try {
            const h = calcH(pi + ci);
            const x = ml + ci * (colW + 5);
            doc.addImage(photo.dataUrl, 'JPEG', x, y, colW, h, '', 'FAST');
            setFont('normal', 7, GREY);
            doc.text(`${itemNum} — Photo ${pi + ci + 1}`, x, y + h + 4);
          } catch(e) {}
        });
        y += rowH + 10;
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
