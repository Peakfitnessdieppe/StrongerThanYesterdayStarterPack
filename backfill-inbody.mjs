import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import fetch from 'node-fetch';

const CSV_PATH = './assets/inbody-backfill.csv';
const ENDPOINT = 'https://starter.peakfitnessdieppe.ca/.netlify/functions/ingest-inbody-from-zapier';
const SECRET = process.env.ZAPIER_INGEST_SECRET || 'peakfitnessmystoryinbody';

function normalizeRow(record) {
  const normalized = {};
  for (const [key, value] of Object.entries(record)) {
    if (!key) continue;
    const safeKey = key.trim().toLowerCase();
    normalized[safeKey] = typeof value === 'string' ? value.trim() : value;
  }
  return normalized;
}

function getField(row, ...candidates) {
  for (const key of candidates) {
    if (key == null) continue;
    const value = row[key.toLowerCase?.() ? key.toLowerCase() : key];
    if (value !== undefined && value !== null) {
      const trimmed = typeof value === 'string' ? value.trim() : value;
      if (trimmed !== '') return trimmed;
    }
  }
  return '';
}

function normalizeScanDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const replaced = raw.replace(/[.\/]/g, '-');
  const date = new Date(replaced);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }
  const parts = raw.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if (parts) {
    const [_, year, month, day] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return '';
}

function normalizeHeight(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/cm/i.test(raw)) return raw;
  const ftInMatch = raw.match(/(\d+(?:\.\d+)?)\s*ft\.?\s*(\d+(?:\.\d+)?)\s*in\.?/i);
  if (ftInMatch) {
    const feet = Math.floor(parseFloat(ftInMatch[1]) || 0);
    const inches = Math.round(parseFloat(ftInMatch[2]) || 0);
    return `${feet}' ${inches}"`;
  }
  const quoteMatch = raw.match(/(\d+)\s*'\s*(\d+)/);
  if (quoteMatch) {
    const feet = parseInt(quoteMatch[1], 10) || 0;
    const inches = parseInt(quoteMatch[2], 10) || 0;
    return `${feet}' ${inches}"`;
  }
  return raw;
}

async function sendRow(record) {
  const row = normalizeRow(record);

  const email = getField(row, 'email', 'email address', 'member email', 'client email');
  const rawScanDate = getField(row, 'scan_date', 'scan date', 'test date / time', 'test date time', 'date', 'scan datetime', 'scan');
  const scanDate = normalizeScanDate(rawScanDate);

  if (!email || !scanDate) {
    return { skipped: true, reason: !email ? 'missing email' : 'missing scan_date', email: email || '', scanDate: rawScanDate || '' };
  }

  const payload = {
    email,
    first_name: getField(row, 'first name', 'first_name', 'member first name'),
    last_name: getField(row, 'last name', 'last_name', 'member last name'),
    phone: getField(row, 'phone'),
    age: getField(row, 'age', 'age (years)'),
    height: normalizeHeight(getField(row, 'height')),
    scan_date: scanDate,
    weight_lb: getField(row, 'weight', 'weight_lb', 'weight (lb)'),
    tbw_lb: getField(row, 'tbw (total body water)', 'tbw_lb', 'tbw (lb)'),
    dlm_lb: getField(row, 'dlm (dry lean mass)', 'dlm_lb', 'dlm (lb)'),
    bfm_lb: getField(row, 'bfm (body fat mass)', 'bfm_lb', 'bfm (lb)'),
    lbm_lb: getField(row, 'lbm (lean body mass)', 'lbm_lb', 'lbm (lb)'),
    smm_lb: getField(row, 'smm (skeletal muscle mass)', 'smm_lb', 'smm (lb)'),
    bmi: getField(row, 'bmi', 'bmi (body mass index)'),
    pbf: getField(row, 'pbf (percent body fat)', 'pbf'),
    bfm_control_lb: getField(row, 'bfm control', 'bfm_control_lb'),
    lbm_control_lb: getField(row, 'lbm control', 'lbm_control_lb'),
    bmr_kcal: getField(row, 'bmr (basal metabolic rate)', 'bmr_kcal', 'bmr')
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Zapier-Secret': SECRET
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
}

async function run() {
  let success = 0;
  let failed = 0;
  let skipped = 0;

  const parser = createReadStream(CSV_PATH).pipe(parse({ columns: true, trim: true }));

  for await (const record of parser) {
    try {
      const result = await sendRow(record);
      if (result?.skipped) {
        skipped += 1;
        const normalized = normalizeRow(record);
        console.warn('Skipped row:', result.email || normalized.email || '<no email>', result.scanDate || normalized['scan_date'] || normalized['scan date'] || '<no date>', result.reason);
      } else {
        success += 1;
      }
    } catch (error) {
      failed += 1;
      const normalized = normalizeRow(record);
      console.error('Failed row:', normalized.email || '<no email>', normalized['scan_date'] || normalized['scan date'] || '<no date>', error.message);
    }
  }

  console.log(`Done. Success: ${success}, Skipped: ${skipped}, Failed: ${failed}`);
}

run().catch((err) => {
  console.error('Fatal error', err);
  process.exit(1);
});
