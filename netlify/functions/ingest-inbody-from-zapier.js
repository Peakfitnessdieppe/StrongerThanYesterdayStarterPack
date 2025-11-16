import { getSupabaseClient } from './_utils/supabase.js';

const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret, X-Zapier-Secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const SCHEMA = process.env.INBODY_SCHEMA || 'peak';
const TABLE = process.env.INBODY_TABLE || 'inbody_scans';
const SHARED_SECRET = process.env.ZAPIER_INGEST_SECRET || process.env.ZAPIER_INBODY_SECRET;

function json(status, payload, extra = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...BASE_HEADERS, ...extra } });
}

function methodOf(evt) {
  if (typeof evt?.method === 'string') return evt.method.toUpperCase();
  if (typeof evt?.httpMethod === 'string') return evt.httpMethod.toUpperCase();
  if (typeof evt?.request?.method === 'string') return evt.request.method.toUpperCase();
  return '';
}

function getHeader(headers, key) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(key) || headers.get(key.toLowerCase()) || '';
  return headers[key] || headers[key?.toLowerCase?.()] || '';
}

function verifySecret(headers) {
  if (!SHARED_SECRET) return false;
  const h1 = getHeader(headers, 'X-Webhook-Secret');
  const h2 = getHeader(headers, 'X-Zapier-Secret');
  return [h1, h2].some((v) => (v || '').trim() === SHARED_SECRET);
}

function normalizeStr(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function toFloat(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/,/g, '').trim();
  const m = s.match(/-?\d+(?:[\.,]\d+)?/);
  const n = parseFloat(m ? m[0].replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

function detectUnit(s) {
  const x = (s || '').toLowerCase();
  if (x.includes(' lb') || x.endsWith('lb') || x.includes('(lb)') || x.includes('pounds')) return 'lb';
  if (x.includes(' kg') || x.endsWith('kg') || x.includes('(kg)') || x.includes('kilograms')) return 'kg';
  if (x.includes('%')) return '%';
  if (x.includes('kcal')) return 'kcal';
  if (x.includes('cm')) return 'cm';
  if (x.includes('in')) return 'in';
  return '';
}

function kgToLbs(n) { return n == null ? null : Math.round((n * 2.20462262185) * 100) / 100; }
function inchesToCm(n) { return n == null ? null : Math.round((n * 2.54) * 100) / 100; }

function parseHeight(value) {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  if (s.endsWith('cm')) {
    return toFloat(s);
  }
  if (s.includes("'")) {
    const m = s.match(/(\d+)\s*'\s*(\d+)?/);
    if (m) {
      const ft = parseInt(m[1], 10) || 0;
      const inches = parseInt(m[2] || '0', 10) || 0;
      return inchesToCm(ft * 12 + inches);
    }
  }
  if (s.endsWith('in') || s.includes('inches')) {
    const inches = toFloat(s);
    return inchesToCm(inches);
  }
  const n = toFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const d = new Date(s.includes('T') ? s : s.replace(/\//g, '-'));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] != null) out[k] = obj[k];
  return out;
}

function getBodyField(body, ...names) {
  for (const n of names) {
    if (body[n] != null && String(body[n]).trim() !== '') return body[n];
  }
  return null;
}

async function parseBody(event) {
  if (!event) return {};
  if (typeof event.text === 'function' && typeof event.headers?.get === 'function') {
    const raw = await event.text();
    const ct = getHeader(event.headers, 'Content-Type');
    if (ct.includes('application/json')) {
      try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
    }
    if (ct.includes('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(raw || '').entries());
    }
    try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
  }
  const bodyText = event.body || event.rawBody || '';
  const ct = getHeader(event.headers, 'Content-Type');
  if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(bodyText).entries());
  try { return JSON.parse(bodyText || '{}'); } catch (_) { return {}; }
}

function buildRecord(body) {
  const email = normalizeStr(getBodyField(body, 'email', 'Email', 'Member Email'));
  const first = normalizeStr(getBodyField(body, 'first_name', 'First Name', 'FirstName'));
  const last = normalizeStr(getBodyField(body, 'last_name', 'Last Name', 'LastName'));
  const phone = normalizeStr(getBodyField(body, 'phone', 'Phone', 'Phone Number'));
  const ageYears = toFloat(getBodyField(body, 'age', 'Age', 'Age (years)'));
  const heightRaw = getBodyField(body, 'height', 'Height', 'Height (cm)', 'Height (in)', 'Height (ft in)');
  const heightCm = parseHeight(heightRaw);

  const dateRaw = getBodyField(body, 'scan_date', 'Scan Date', 'Date');
  const scanDate = parseDate(dateRaw) || new Date().toISOString().slice(0, 10);

  function massInLbs(keys, fallbackUnit) {
    const raw = getBodyField(body, ...keys);
    if (raw == null || raw === '') return null;
    const v = toFloat(raw);
    const unit = detectUnit(String(raw)) || fallbackUnit || '';
    if (unit === 'kg') return kgToLbs(v);
    return v;
  }

  function numericValue(keys, convertInches = false) {
    const raw = getBodyField(body, ...keys);
    if (raw == null || raw === '') return null;
    if (convertInches) {
      const unit = detectUnit(String(raw));
      if (unit === 'in') return inchesToCm(toFloat(raw));
    }
    return toFloat(raw);
  }

  const weight_lb = massInLbs(['weight_lb','Weight (lb)','weight','Weight','Body Weight (lb)','Weight lb'], 'lb');
  const tbw_lb = massInLbs(['tbw_lb','TBW (lb)','Total Body Water','TBW'], 'lb');
  const dlm_lb = massInLbs(['dlm_lb','DLM (lb)','Dry Lean Mass','DLM'], 'lb');
  const bfm_lb = massInLbs(['bfm_lb','BFM (lb)','Body Fat Mass','BFM'], 'lb');
  const lbm_lb = massInLbs(['lbm_lb','LBM (lb)','Lean Body Mass','LBM'], 'lb');
  const smm_lb = massInLbs(['smm_lb','SMM (lb)','Skeletal Muscle Mass','SMM'], 'lb');
  const bmi = numericValue(['bmi','BMI']);
  const pbf = numericValue(['pbf','PBF (%)','Percent Body Fat','PBF']);
  const bfm_control_lb = massInLbs(['bfm_control_lb','BFM Control (lb)','BFM Control'], 'lb');
  const lbm_control_lb = massInLbs(['lbm_control_lb','LBM Control (lb)','LBM Control'], 'lb');
  const bmr_kcal = numericValue(['bmr','bmr_kcal','BMR (kcal)','Basal Metabolic Rate']);

  const member_name = [first, last].filter(Boolean).join(' ') || null;

  return {
    member_email: email,
    member_name,
    first_name: first,
    last_name: last,
    phone,
    age_years: ageYears != null ? Math.round(ageYears) : null,
    height_cm: heightCm,
    scan_date: scanDate,
    weight_lb,
    tbw_lb,
    dlm_lb,
    bfm_lb,
    lbm_lb,
    smm_lb,
    bmi,
    pbf,
    bfm_control_lb,
    lbm_control_lb,
    bmr_kcal
  };
}

function validateRecord(rec) {
  if (!rec.member_email) return 'email is required';
  if (!rec.scan_date) return 'scan_date is required';
  return null;
}

export default async function handler(event) {
  const method = methodOf(event);
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: BASE_HEADERS });
  if (method !== 'POST') return json(405, { error: 'Method Not Allowed' }, { Allow: 'POST, OPTIONS' });

  if (!verifySecret(event.headers)) {
    return json(401, { error: 'Unauthorized' });
  }

  const body = await parseBody(event);
  const record = buildRecord(body);
  const validationError = validateRecord(record);
  if (validationError) return json(400, { error: validationError });

  const supabase = getSupabaseClient();
  const db = SCHEMA ? supabase.schema(SCHEMA) : supabase;

  try {
    const { error } = await db
      .from(TABLE)
      .upsert([record], { onConflict: 'member_email,scan_date' });

    if (error) {
      console.error('ingest-inbody-from-zapier upsert error', error);
      return json(500, { error: 'Database error' });
    }
  } catch (e) {
    console.error('ingest-inbody-from-zapier unexpected', e);
    return json(500, { error: 'Unexpected error' });
  }

  return json(200, { success: true });
}
