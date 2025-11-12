import { randomUUID } from 'crypto';
import { getSupabaseClient } from './_utils/supabase.js';

const TABLE_SCHEMA = process.env.WINS_CAPTURE_SCHEMA || 'peak';
const TABLE_NAME = process.env.WINS_CAPTURE_TABLE || 'wins_capture';
const ZAPIER_WEBHOOK = process.env.ZAPIER_WINS_WEBHOOK_URL;

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

const REQUIRED_FIELDS = ['email', 'name', 'win_story'];

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
      const base = Object.fromEntries(params.entries());
      const tags = params.getAll('wins_tags');
      if (tags.length) base.wins_tags = tags;
      return base;
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
    const base = Object.fromEntries(params.entries());
    const tags = params.getAll('wins_tags');
    if (tags.length) base.wins_tags = tags;
    return base;
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

function normalizeTags(value) {
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

  const winsTags = normalizeTags(payload.wins_tags || payload['wins_tags[]']);

  const insertPayload = {
    submission_uuid: normalizeValue(submissionUuid),
    email: normalizeValue(payload.email),
    first_name: normalizeValue(payload.first_name),
    last_name: normalizeValue(payload.last_name),
    member_name: normalizeValue(payload.name),
    wins_tags: winsTags.length ? winsTags : null,
    win_story: normalizeValue(payload.win_story),
    next_win: normalizeValue(payload.next_win),
    media_url: normalizeValue(payload.media_url),
    source: normalizeValue(payload.source),
    mc_id: normalizeValue(payload.mc_id),
    lang: normalizeValue(payload.lang),
    submitted_at_local: normalizeValue(payload.submitted_at_local)
  };

  const { error } = await db
    .from(TABLE_NAME)
    .insert([insertPayload]);

  if (error) {
    console.error('submit-wins-capture: supabase insert failed', error);
    throw new Error('Unable to save submission');
  }

  return { insertPayload: { ...insertPayload, wins_tags: winsTags.length ? winsTags : null }, winsTags };
}

async function notifyZapier(payload) {
  if (!ZAPIER_WEBHOOK) {
    console.warn('submit-wins-capture: Zapier webhook URL is not configured');
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
      console.warn('submit-wins-capture: Zapier responded with non-200', {
        status: response.status,
        statusText: response.statusText,
        bodyPreview: text.slice(0, 200)
      });
    }
  } catch (error) {
    console.warn('submit-wins-capture: Zapier webhook failed', error);
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
    return buildResponse(204);
  }

  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
  }

  const payload = await parseBody(event);
  const botField = normalizeValue(payload['bot-field']);
  if (botField) {
    return jsonResponse(200, { success: true });
  }

  const tags = normalizeTags(payload.wins_tags || payload['wins_tags[]']);

  for (const field of REQUIRED_FIELDS) {
    if (!normalizeValue(payload[field])) {
      return jsonResponse(400, { error: `${field} is required` });
    }
  }

  if (!tags.length) {
    return jsonResponse(400, { error: 'wins_tags is required' });
  }

  try {
    const submissionUuid = payload.submission_uuid || randomUUID();
    payload.submission_uuid = submissionUuid;

    const { insertPayload } = await persistSubmission({ ...payload, wins_tags: tags }, submissionUuid);
    await notifyZapier({
      ...insertPayload,
      wins_tags: tags
    });
  } catch (error) {
    console.error('submit-wins-capture: unexpected error', error);
    return jsonResponse(500, { error: 'Submission failed. Please try again later.' });
  }

  const redirectTarget = normalizeValue(payload.redirect) || '/thank-you-onboarding/';
  return redirectResponse(redirectTarget);
}
