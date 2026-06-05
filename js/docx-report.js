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

  const AMBER = 'F0A500';
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

  // ─── Title ───
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 120 },
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

  // ─── Rooms ───
  for (const room of (job.rooms || [])) {
    const roomItems = allItems
      .filter(i => i.roomId === room.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!roomItems.length) continue;

    const code = getRoomCode(room.name);

    children.push(new Paragraph({
      spacing: { before: 240, after: 80 },
      border: { bottom: { color: AMBER, space: 1, style: BorderStyle.SINGLE, size: 12 } },
      children: [ new TextRun({ text: room.name || 'Unnamed Room', bold: true, size: 28, color: DARK }) ]
    }));

    // Table: Ref | Description | Photos
    const rows = [ headerRow(D, ['Item', 'Description', 'Photos']) ];

    for (let idx = 0; idx < roomItems.length; idx++) {
      const item = roomItems[idx];
      const itemNum = `${code}-${String(idx + 1).padStart(2, '0')}`;
      const sevLabel = (item.severity || 'medium').toUpperCase();
      const desc = item.expandedDescription || item.description || '';

      // Photo cell content
      const photos = (photoMap[item.id] || []).filter(p => p.includeInReport !== false);
      const photoParas = [];
      photos.forEach(p => {
        try {
          const w = 200;
          const ratio = (p.imgW && p.imgH) ? (p.imgH / p.imgW) : 0.75;
          const h = Math.round(w * ratio);
          photoParas.push(new Paragraph({
            spacing: { after: 60 },
            children: [ new ImageRun({ type: 'jpg', data: dataUrlToUint8(p.dataUrl), transformation: { width: w, height: h } }) ]
          }));
        } catch (e) {}
      });
      if (!photoParas.length) photoParas.push(new Paragraph(''));

      rows.push(new TableRow({ children: [
        new TableCell({
          width: { size: 16, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({ children: [ new TextRun({ text: `${item.flagged ? '⚑ ' : ''}${itemNum}`, bold: true, size: 18 }) ] }),
            new Paragraph({ children: [ new TextRun({ text: sevLabel, size: 16, color: GREY }) ] }),
            ...(item.trade ? [ new Paragraph({ children: [ new TextRun({ text: item.trade, size: 16, color: GREY }) ] }) ] : [])
          ]
        }),
        new TableCell({
          width: { size: 44, type: WidthType.PERCENTAGE },
          children: [ new Paragraph({ children: [ new TextRun({ text: desc, size: 20 }) ] }) ]
        }),
        new TableCell({
          width: { size: 40, type: WidthType.PERCENTAGE },
          children: photoParas
        })
      ] }));
    }

    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
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
  return { top: none, bottom: none, left: none, right: none };
}

function headerRow(D, labels) {
  const { TableRow, TableCell, Paragraph, TextRun, WidthType } = D;
  const sizes = [16, 44, 40];
  return new TableRow({
    tableHeader: true,
    children: labels.map((l, i) => new TableCell({
      width: { size: sizes[i], type: WidthType.PERCENTAGE },
      shading: { fill: '1A1F2E' },
      children: [ new Paragraph({ children: [ new TextRun({ text: l, bold: true, color: 'FFFFFF', size: 18 }) ] }) ]
    }))
  });
}
