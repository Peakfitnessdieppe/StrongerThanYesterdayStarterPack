import { randomUUID } from 'crypto';
import { getSupabaseClient } from './_utils/supabase.js';

const TABLE_SCHEMA = process.env.ONBOARDING_CHECKINS_SCHEMA || 'peak';
const TABLE_NAME = process.env.ONBOARDING_CHECKINS_TABLE || 'onboarding_checkins';
const ZAPIER_WEBHOOK = process.env.ZAPIER_CHECKIN_WEBHOOK_URL;

const REQUIRED_FIELDS = ['q1_helpful', 'q2_ready', 'q3_better'];

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      ...BASE_HEADERS,
      ...JSON_HEADERS,
      ...extraHeaders
    }
  });
}

function redirectResponse(location) {
  return new Response('', {
    status: 303,
    headers: {
      ...BASE_HEADERS,
      Location: location,
      'Cache-Control': 'no-store'
    }
  });
}

function isLikelyFormUrlEncoded(headers = {}) {
  const getHeader = (key) => {
    if (!headers) return '';
    if (typeof headers?.get === 'function') return headers.get(key) || headers.get(key.toLowerCase()) || '';
    return headers[key] || headers[key?.toLowerCase?.()] || '';
  };
  const contentType = getHeader('Content-Type');
  return typeof contentType === 'string' && contentType.includes('application/x-www-form-urlencoded');
}

async function parseBody(event) {
  if (!event) return {};

  // Request object support
  if (typeof event.text === 'function' && typeof event.headers?.get === 'function') {
    const raw = await event.text();
    if (!raw) return {};
    if (isLikelyFormUrlEncoded(event.headers)) {
      return Object.fromEntries(new URLSearchParams(raw).entries());
    }
    try {
      return JSON.parse(raw);
    } catch (_) {
      return {};
    }
  }

  const bodyText = event.body || event.rawBody || '';
  if (!bodyText) return {};

  if (isLikelyFormUrlEncoded(event.headers)) {
    return Object.fromEntries(new URLSearchParams(bodyText).entries());
  }

  try {
    return JSON.parse(bodyText);
  } catch (_) {
    return {};
  }
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

async function persistSubmission(payload, submissionUuid) {
  const supabase = getSupabaseClient();
  const db = TABLE_SCHEMA ? supabase.schema(TABLE_SCHEMA) : supabase;

  const insertPayload = {
    submission_uuid: normalizeValue(submissionUuid),
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

function getMethod(event) {
  if (typeof event?.httpMethod === 'string') return event.httpMethod.toUpperCase();
  if (typeof event?.method === 'string') return event.method.toUpperCase();
  if (typeof event?.request?.method === 'string') return event.request.method.toUpperCase();
  return '';
}

export default async function handler(event) {
  const method = getMethod(event);

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: BASE_HEADERS
    });
  }

  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
  }

  const payload = await parseBody(event);
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
    const submissionUuid = payload.submission_uuid || randomUUID();
    payload.submission_uuid = submissionUuid;

    await persistSubmission(payload, submissionUuid);
    await notifyZapier(payload);
  } catch (error) {
    console.error('submit-onboarding-checkin: unexpected error', error);
    return jsonResponse(500, { error: 'Submission failed. Please try again later.' });
  }

  const redirectTarget = normalizeValue(payload.redirect) || '/thank-you-onboarding/';
  return redirectResponse(redirectTarget);
}
