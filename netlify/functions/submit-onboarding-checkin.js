import { getSupabaseClient } from './_utils/supabase.js';

const TABLE_SCHEMA = process.env.ONBOARDING_CHECKINS_SCHEMA || 'peak';
const TABLE_NAME = process.env.ONBOARDING_CHECKINS_TABLE || 'onboarding_checkins';
const ZAPIER_WEBHOOK = process.env.ZAPIER_CHECKIN_WEBHOOK_URL;

const REQUIRED_FIELDS = ['q1_helpful', 'q2_ready', 'q3_better'];

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
}

function redirectResponse(location) {
  return {
    statusCode: 303,
    headers: {
      Location: location,
      'Cache-Control': 'no-store'
    },
    body: ''
  };
}

function isLikelyFormUrlEncoded(headers = {}) {
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  return contentType.includes('application/x-www-form-urlencoded');
}

function parseBody(event) {
  if (!event.body) return {};

  if (isLikelyFormUrlEncoded(event.headers)) {
    const params = new URLSearchParams(event.body);
    return Object.fromEntries(params.entries());
  }

  try {
    return JSON.parse(event.body);
  } catch (_) {
    return {};
  }
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

async function persistSubmission(payload) {
  const supabase = getSupabaseClient();
  const db = TABLE_SCHEMA ? supabase.schema(TABLE_SCHEMA) : supabase;

  const insertPayload = {
    email: normalizeValue(payload.email),
    member_name: normalizeValue(payload.name),
    order_number: normalizeValue(payload.order),
    q1_helpful: normalizeValue(payload.q1_helpful),
    q2_ready: normalizeValue(payload.q2_ready),
    q3_better: normalizeValue(payload.q3_better),
    note: normalizeValue(payload.note),
    source: normalizeValue(payload.source),
    mc_id: normalizeValue(payload.mc_id),
    lang: normalizeValue(payload.lang),
    submitted_at_local: normalizeValue(payload.submitted_at_local)
  };

  const { error } = await db
    .from(TABLE_NAME)
    .insert([insertPayload]);

  if (error) {
    console.error('submit-onboarding-checkin: supabase insert failed', error);
    throw new Error('Unable to save submission');
  }
}

async function notifyZapier(payload) {
  if (!ZAPIER_WEBHOOK) return;
  try {
    await fetch(ZAPIER_WEBHOOK, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn('submit-onboarding-checkin: Zapier webhook failed', error);
  }
}

export default async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { Allow: 'POST', ...JSON_HEADERS },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  const payload = parseBody(event);
  const botField = normalizeValue(payload['bot-field']);
  if (botField) {
    return jsonResponse(200, { success: true });
  }

  for (const field of REQUIRED_FIELDS) {
    if (!normalizeValue(payload[field])) {
      return jsonResponse(400, { error: `${field} is required` });
    }
  }

  try {
    await persistSubmission(payload);
    await notifyZapier(payload);
  } catch (error) {
    console.error('submit-onboarding-checkin: unexpected error', error);
    return jsonResponse(500, { error: 'Submission failed. Please try again later.' });
  }

  const redirectTarget = normalizeValue(payload.redirect) || '/thank-you-onboarding/';
  return redirectResponse(redirectTarget);
}
