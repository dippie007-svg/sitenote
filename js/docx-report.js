import { getJob, getSettings, getItemsForJob, getAllPhotosForJob } from './db.js';
import { formatDate, getRoomCode } from './utils.js';

function dataUrlToUint8(dataUrl) {
  const b64 = (dataUrl || '').split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function fetchLogoUint8() {
  try {
    const res = await fetch('./logo-dvm.jpg');
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) { return null; }
}

export async function generateDOCX(jobId) {
  const D = window.docx;
  if (!D) throw new Error('Word library not loaded');

  const {
    Document, Packer, Paragraph, TextRun, ImageRun,
    Table, TableRow, TableCell, WidthType, AlignmentType,
    BorderStyle, HeadingLevel
  } = D;

  const [job, settings, allItems, allPhotos] = await Promise.all([
    getJob(jobId), getSettings(), getItemsForJob(jobId), getAllPhotosForJob(jobId)
  ]);

  const photoMap = {};
  allPhotos.forEach(p => {
    if (!photoMap[p.itemId]) photoMap[p.itemId] = [];
    photoMap[p.itemId].push(p);
  });

  const RULE = 'A0A0A0';   // grey separator (matches PDF)
  const DARK = '1A1F2E';
  const GREY = '646464';

  const logo = await fetchLogoUint8();

  const children = [];

  // ─── Header: logo + contact details ───
  const headerCells = [];
  headerCells.push(new TableCell({
    width: { size: 35, type: WidthType.PERCENTAGE },
    borders: noBorders(BorderStyle),
    children: [ logo
      ? new Paragraph({ children: [ new ImageRun({ type: 'jpg', data: logo, transformation: { width: 120, height: 120 } }) ] })
      : new Paragraph('') ]
  }));
  const contact = [
    '1 De Villiers Drive, P O Box 472, DURBANVILLE, 7550',
    'Tel: (021) 976 3087',
    'Reg No. 1999/006693/07',
    'Branch Offices: Stellenbosch & George',
    'Email: admin@devmoore.co.za | Web: devmoore.co.za',
    'Certified BEE Level 2 Contributor'
  ];
  headerCells.push(new TableCell({
    width: { size: 65, type: WidthType.PERCENTAGE },
    borders: noBorders(BorderStyle),
    children: contact.map((t, i) => new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [ new TextRun({ text: t, size: 16, color: GREY, bold: i === contact.length - 1 }) ]
    }))
  }));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(BorderStyle),
    rows: [ new TableRow({ children: headerCells }) ]
  }));

  // Helper: full-width horizontal rule (a paragraph with a bottom border)
  const rule = (color, size, spacing) => new Paragraph({
    spacing: spacing || { before: 80, after: 80 },
    border: { bottom: { color, style: BorderStyle.SINGLE, size, space: 1 } },
    children: []
  });

  // Grey rule under the header
  children.push(rule(RULE, 14, { before: 60, after: 160 }));

  // ─── Title ───
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 160 },
    children: [ new TextRun({ text: (job.reportType || 'INSPECTION REPORT').toUpperCase(), bold: true, size: 40, color: DARK }) ]
  }));

  // ─── Project info ───
  const info = [
    ['Property:', job.address || ''],
    ['Project:', job.clientName || ''],
    ['Date:', formatDate(job.date)],
    ['Project No:', job.reference || ''],
    ['Compiled By:', settings.surveyorName || ''],
    ['Contact:', [settings.email, settings.phone].filter(Boolean).join(' | ')]
  ];
  info.forEach(([label, val]) => {
    if (!val) return;
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: label + ' ', bold: true, size: 20, color: DARK }),
        new TextRun({ text: val, size: 20, color: GREY })
      ]
    }));
  });

  // Grey rule below the project info (closes the cover block)
  children.push(rule(RULE, 14, { before: 160, after: 80 }));

  // ─── Rooms ───
  const PHOTOS_PER_ROW = 2;        // match the PDF (2 photos per row)
  const PHOTO_W = 250;             // px — two fit across an A4 page width
  const THIN = 'C8C8C8';           // thin separator between items

  let firstRoom = true;
  for (const room of (job.rooms || [])) {
    const roomItems = allItems
      .filter(i => i.roomId === room.id && !i.resolved)   // resolved items excluded from report
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!roomItems.length) continue;

    const code = getRoomCode(room.name);

    // Room heading — bold with grey underline; rooms start on a new page (like PDF)
    children.push(new Paragraph({
      pageBreakBefore: firstRoom ? true : false,
      spacing: { before: firstRoom ? 0 : 240, after: 120 },
      border: { bottom: { color: RULE, space: 1, style: BorderStyle.SINGLE, size: 14 } },
      children: [ new TextRun({ text: room.name || 'Unnamed Room', bold: true, size: 28, color: DARK }) ]
    }));
    firstRoom = false;

    // Plan excerpt for orientation (if marked)
    if (room.excerpt && room.excerptW && room.excerptH) {
      try {
        const w = 170;
        const h = Math.round(w * (room.excerptH / room.excerptW));
        children.push(new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: 'Location: ', bold: true, size: 20, color: DARK }),
            new ImageRun({ type: 'jpg', data: dataUrlToUint8(room.excerpt), transformation: { width: w, height: h } })
          ]
        }));
      } catch (e) {}
    }

    for (let idx = 0; idx < roomItems.length; idx++) {
      const item = roomItems[idx];
      const itemNum = `${code}-${String(idx + 1).padStart(2, '0')}`;
      const sevLabel = (item.severity || 'medium').toUpperCase();
      const desc = item.expandedDescription || item.description || '';

      // 1. Item header row: number (left)  |  trade + [SEVERITY] (right-aligned)
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders(BorderStyle),
        rows: [ new TableRow({ children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            borders: noBorders(BorderStyle),
            children: [ new Paragraph({ children: [ new TextRun({ text: `${item.flagged ? '⚑ ' : ''}${itemNum}`, bold: true, size: 22, color: DARK }) ] }) ]
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            borders: noBorders(BorderStyle),
            children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ text: [item.trade, `[${sevLabel}]`].filter(Boolean).join('   '), size: 18, color: GREY }) ] }) ]
          })
        ] }) ]
      }));

      // 2. Comment / description
      children.push(new Paragraph({
        spacing: { before: 40, after: 80 },
        children: [ new TextRun({ text: desc, size: 20 }) ]
      }));

      // 3. Photos side-by-side, 2 per row (borderless table)
      const photos = (photoMap[item.id] || []).filter(p => p.includeInReport !== false);
      if (photos.length) {
        const photoRows = [];
        for (let pi = 0; pi < photos.length; pi += PHOTOS_PER_ROW) {
          const slice = photos.slice(pi, pi + PHOTOS_PER_ROW);
          const cells = slice.map(p => {
            let para;
            try {
              const ratio = (p.imgW && p.imgH) ? (p.imgH / p.imgW) : 0.75;
              const h = Math.round(PHOTO_W * ratio);
              para = new Paragraph({ children: [ new ImageRun({ type: 'jpg', data: dataUrlToUint8(p.dataUrl), transformation: { width: PHOTO_W, height: h } }) ] });
            } catch (e) { para = new Paragraph(''); }
            return new TableCell({
              width: { size: Math.floor(100 / PHOTOS_PER_ROW), type: WidthType.PERCENTAGE },
              borders: noBorders(BorderStyle),
              children: [ para ]
            });
          });
          while (cells.length < PHOTOS_PER_ROW) {
            cells.push(new TableCell({ borders: noBorders(BorderStyle), children: [ new Paragraph('') ] }));
          }
          photoRows.push(new TableRow({ children: cells }));
        }
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: noBorders(BorderStyle),
          rows: photoRows
        }));
      }

      // 4. Thin grey rule between items (not after the last one)
      if (idx < roomItems.length - 1) {
        children.push(rule(THIN, 6, { before: 120, after: 120 }));
      } else {
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      }
    }
  }

  const doc = new Document({
    sections: [ { properties: {}, children } ]
  });

  const blob = await Packer.toBlob(doc);
  const reference = (job.reference || 'report').replace(/[^a-zA-Z0-9-]/g, '-');
  const date = job.date || new Date().toISOString().slice(0, 10);
  const now = new Date();
  const stamp = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const filename = `SiteNote-${reference}-${date}-${stamp}.docx`;
  return { blob, filename };
}

function noBorders(BorderStyle) {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
}
