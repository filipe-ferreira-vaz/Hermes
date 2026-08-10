const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const mailer = require('../src/mailer');
const { getAuthClient } = require('../src/auth');
const { google } = require('googleapis');

function SHEET_ID() {
  let id = process.env.GOOGLE_SHEET_ID || '';
  const urlMatch = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) id = urlMatch[1];
  else id = id.split('/')[0].split('?')[0].split('#')[0];
  return id.trim();
}

function cleanEmail(raw) {
  let value = String(raw || '').trim();
  value = value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  const mailtoMatch = value.match(/mailto:\s*([^\s"'<>#]+)/i);
  if (mailtoMatch) return (mailtoMatch[1] || '').trim();
  const match = value.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : '';
}

async function main() {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // Find first tab
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID(), fields: 'sheets.properties.title' });
  const tab = meta.data.sheets[0].properties.title;
  console.log(`Tab: "${tab}"`);

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `'${tab}'!A:G`,
  });
  const rows = resp.data.values || [];
  if (rows.length === 0) { console.log('Sheet empty'); return; }

  const header = rows[0];
  const headers = {};
  header.forEach((h, i) => { headers[String(h).trim().toLowerCase()] = i; });
  const cIdx = (n) => { const i = headers[n]; return i === undefined ? -1 : i; };
  const cSubject = cIdx('subject');
  const cBody = cIdx('body');
  const cEmail = cIdx('to_email');
  console.log('Columns ->', JSON.stringify(headers));

  const updates = []; // { row, col letter, old, new }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];

    if (cSubject >= 0 && row[cSubject]) {
      const norm = mailer.normalizeUtf8(row[cSubject]);
      if (norm !== row[cSubject]) updates.push({ r: r + 1, col: cSubject, old: row[cSubject], norm, label: 'subject' });
    }
    if (cBody >= 0 && row[cBody]) {
      const norm = mailer.normalizeUtf8(row[cBody]);
      if (norm !== row[cBody]) updates.push({ r: r + 1, col: cBody, old: row[cBody], norm, label: 'body' });
    }
    if (cEmail >= 0 && row[cEmail]) {
      const clean = /[<>]|mailto:/i.test(row[cEmail]) ? cleanEmail(row[cEmail]) : null;
      if (clean && clean !== row[cEmail]) {
        updates.push({ r: r + 1, col: cEmail, old: row[cEmail], norm: clean, label: 'to_email' });
      }
    }
  }

  if (updates.length === 0) {
    console.log('No rows need fixing.\n(Tip: if you already re-scheduled emails after the fix, the Sheet already holds clean text.)');
    return;
  }

  // Group by column for batched writes
  const byCol = {};
  for (const u of updates) {
    (byCol[u.col] = byCol[u.col] || []).push(u);
  }

  console.log(`Fixing ${updates.length} cell(s):`);
  for (const [, list] of Object.entries(byCol)) {
    for (const u of list) console.log(`  row ${u.row} ${u.label}: "${u.old}" -> "${u.norm}"`);
  }

  for (const [col, list] of Object.entries(byCol)) {
    const startRow = list[0].row;
    const endRow = list[list.length - 1].row;
    const updateByRow = {};
    for (const u of list) updateByRow[u.row] = u.norm;
    const values = [];
    for (let r = startRow; r <= endRow; r++) {
      const v = updateByRow[r] !== undefined ? updateByRow[r] : rows[r - 1][col];
      values.push([v !== undefined && v !== null ? v : '']);
    }
    const colLetter = String.fromCharCode(65 + col);
    const rangeC = `'${tab}'!${colLetter}${startRow}:${colLetter}${endRow}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID(),
      range: rangeC,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
    console.log(`Updated ${rangeC}`);
  }
  console.log('Sheet repair complete.');
}

main().catch((err) => {
  console.error('Sheet repair failed:', err.message);
  process.exit(1);
});