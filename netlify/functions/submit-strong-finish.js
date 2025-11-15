import { randomUUID } from 'crypto';
import { getSupabaseClient } from './_utils/supabase.js';

const TABLE_SCHEMA = process.env.STRONGER_FINISH_SCHEMA || 'peak';
const TABLE_NAME = process.env.STRONGER_FINISH_TABLE || 'stronger_finish_feedback';
const ZAPIER_WEBHOOK = process.env.ZAPIER_STRONGER_FINISH_WEBHOOK_URL;

const REQUIRED_FIELDS = ['q1_overall', 'q2_biggest_win', 'q3_coach_support', 'q6_email_helpful', 'q8_confidence', 'q9_refer'];

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const SUPPORTS_WEB_RESPONSE = typeof Response === 'function';

function buildResponse(status, body = '', extraHeaders = {}) {
  const headers = { ...BASE_HEADERS, ...extraHeaders };
  if (SUPPORTS_WEB_RESPONSE) {
    return new Response(body, { status, headers });
  }
  return {
    statusCode: status,
    headers,
    body
  };
}

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return buildResponse(statusCode, JSON.stringify(payload), {
    ...JSON_HEADERS,
    ...extraHeaders
  });
}

function redirectResponse(location) {
  return buildResponse(303, '', {
    Location: location,
    'Cache-Control': 'no-store'
  });
}

function isUrlEncoded(headers = {}) {
  const getHeader = (key) => {
    if (!headers) return '';
    if (typeof headers?.get === 'function') {
      return headers.get(key) || headers.get(key.toLowerCase()) || '';
    }
    return headers[key] || headers[key?.toLowerCase?.()] || '';
  };
  const contentType = getHeader('Content-Type');
  return typeof contentType === 'string' && contentType.includes('application/x-www-form-urlencoded');
}

async function parseBody(event) {
  if (!event) return {};

  if (typeof event.text === 'function' && typeof event.headers?.get === 'function') {
    const raw = await event.text();
    if (!raw) return {};
    if (isUrlEncoded(event.headers)) {
      const params = new URLSearchParams(raw);
      return parseParams(params);
    }
    try {
      return JSON.parse(raw);
    } catch (_) {
      return {};
    }
  }

  const bodyText = event.body || event.rawBody || '';
  if (!bodyText) return {};

  if (isUrlEncoded(event.headers)) {
    const params = new URLSearchParams(bodyText);
    return parseParams(params);
  }

  try {
    return JSON.parse(bodyText);
  } catch (_) {
    return {};
  }
}

function parseParams(params) {
  const base = Object.fromEntries(params.entries());
  const favouriteFormats = params.getAll('q4_favourite_formats');
  if (favouriteFormats.length) base.q4_favourite_formats = favouriteFormats;
  const topResources = params.getAll('q7_top_resources');
  if (topResources.length) base.q7_top_resources = topResources;
  return base;
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeValue(item))
      .filter(Boolean);
  }
  const single = normalizeValue(value);
  return single ? [single] : [];
}

async function persistSubmission(payload, submissionUuid) {
  const supabase = getSupabaseClient();
  const db = TABLE_SCHEMA ? supabase.schema(TABLE_SCHEMA) : supabase;

  const favouriteFormats = normalizeStringArray(payload.q4_favourite_formats || payload['q4_favourite_formats[]']);
  const topResources = normalizeStringArray(payload.q7_top_resources || payload['q7_top_resources[]']);

  const insertPayload = {
    submission_uuid: normalizeValue(submissionUuid),
    email: normalizeValue(payload.email),
    member_name: normalizeValue(payload.member_name),
    first_name: normalizeValue(payload.first_name),
    last_name: normalizeValue(payload.last_name),
    order_number: normalizeValue(payload.order_number),
    source: normalizeValue(payload.source),
    mc_id: normalizeValue(payload.mc_id),
    lang: normalizeValue(payload.lang),
    submitted_at_local: normalizeValue(payload.submitted_at_local),
    q1_overall: normalizeValue(payload.q1_overall),
    q2_biggest_win: normalizeValue(payload.q2_biggest_win),
    q3_coach_support: normalizeValue(payload.q3_coach_support),
    q4_favourite_formats: favouriteFormats.length ? favouriteFormats : null,
    q5_schedule_gap: normalizeValue(payload.q5_schedule_gap),
    q6_email_helpful: normalizeValue(payload.q6_email_helpful),
    q7_top_resources: topResources.length ? topResources : null,
    q8_confidence: normalizeValue(payload.q8_confidence),
    q9_refer: normalizeValue(payload.q9_refer),
    q10_notes: normalizeValue(payload.q10_notes)
  };

  const { error } = await db
    .from(TABLE_NAME)
    .insert([insertPayload]);

  if (error) {
    console.error('submit-strong-finish: supabase insert failed', error);
    throw new Error('Unable to save submission');
  }

  return insertPayload;
}

async function notifyZapier(payload) {
  if (!ZAPIER_WEBHOOK) {
    return;
  }
  try {
    const response = await fetch(ZAPIER_WEBHOOK, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '<unable to read body>');
      console.warn('submit-strong-finish: Zapier responded with non-200', {
        status: response.status,
        statusText: response.statusText,
        bodyPreview: text.slice(0, 200)
      });
    }
  } catch (error) {
    console.warn('submit-strong-finish: Zapier webhook failed', error);
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
    return buildResponse(204, '');
  }

  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
  }

  const payload = await parseBody(event);
  const botField = normalizeValue(payload['bot-field']);
  if (botField) {
    return jsonResponse(200, { success: true });
  }

  payload.submitted_at_utc = new Date().toISOString();

  for (const field of REQUIRED_FIELDS) {
    if (!normalizeValue(payload[field])) {
      return jsonResponse(400, { error: `${field} is required` });
    }
  }

  try {
    const submissionUuid = payload.submission_uuid || randomUUID();
    payload.submission_uuid = submissionUuid;

    const insertPayload = await persistSubmission(payload, submissionUuid);
    await notifyZapier({
      ...insertPayload,
      submission_uuid: submissionUuid,
      submitted_at_utc: payload.submitted_at_utc
    });
  } catch (error) {
    console.error('submit-strong-finish: unexpected error', error);
    return jsonResponse(500, { error: 'Submission failed. Please try again later.' });
  }

  const redirectTarget = normalizeValue(payload.redirect) || '/thank-you-onboarding/';
  return redirectResponse(redirectTarget);
}
