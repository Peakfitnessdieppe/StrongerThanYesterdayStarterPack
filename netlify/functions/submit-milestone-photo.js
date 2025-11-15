import { randomUUID } from 'crypto';
import { getSupabaseClient } from './_utils/supabase.js';

const TABLE_SCHEMA = process.env.MILESTONE_PHOTOS_SCHEMA || 'peak';
const TABLE_NAME = process.env.MILESTONE_PHOTOS_TABLE || 'milestone_photos';
const ZAPIER_WEBHOOK = process.env.ZAPIER_MILESTONE_PHOTO_WEBHOOK_URL;

const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const REQUIRED_FIELDS = ['email', 'member_name', 'photo_url', 'share_permission'];

const buildResponse = (status, payload = null, extraHeaders = {}) => {
  const headers = { ...BASE_HEADERS, ...extraHeaders };
  if (payload !== null) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  return new Response(payload !== null ? JSON.stringify(payload) : null, {
    status,
    headers
  });
};

const normalizeValue = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const isFormUrlEncoded = (headers = {}) => {
  const getHeader = (key) => {
    if (!headers) return '';
    if (typeof headers?.get === 'function') {
      return headers.get(key) || headers.get(key.toLowerCase()) || '';
    }
    return headers[key] || headers[key?.toLowerCase?.()] || '';
  };
  const contentType = getHeader('Content-Type');
  return typeof contentType === 'string' && contentType.includes('application/x-www-form-urlencoded');
};

const parseBody = async (eventOrRequest) => {
  if (!eventOrRequest) return {};

  if (typeof eventOrRequest.text === 'function' && typeof eventOrRequest.headers?.get === 'function') {
    const raw = await eventOrRequest.text();
    if (!raw) return {};
    if (isFormUrlEncoded(eventOrRequest.headers)) {
      return Object.fromEntries(new URLSearchParams(raw).entries());
    }
    try {
      return JSON.parse(raw);
    } catch (_) {
      return {};
    }
  }

  const bodyText = eventOrRequest.body || eventOrRequest.rawBody || '';
  if (!bodyText) return {};

  if (isFormUrlEncoded(eventOrRequest.headers)) {
    return Object.fromEntries(new URLSearchParams(bodyText).entries());
  }

  try {
    return JSON.parse(bodyText);
  } catch (_) {
    return {};
  }
};

const getMethod = (eventOrRequest) => {
  if (typeof eventOrRequest?.method === 'string') return eventOrRequest.method.toUpperCase();
  if (typeof eventOrRequest?.httpMethod === 'string') return eventOrRequest.httpMethod.toUpperCase();
  if (typeof eventOrRequest?.request?.method === 'string') return eventOrRequest.request.method.toUpperCase();
  return '';
};

async function persistSubmission(payload) {
  const supabase = getSupabaseClient();
  const db = TABLE_SCHEMA ? supabase.schema(TABLE_SCHEMA) : supabase;

  const insertPayload = {
    submission_uuid: normalizeValue(payload.submission_uuid) || randomUUID(),
    email: normalizeValue(payload.email),
    first_name: normalizeValue(payload.first_name),
    last_name: normalizeValue(payload.last_name),
    member_name: normalizeValue(payload.member_name),
    milestone_code: normalizeValue(payload.milestone_code),
    milestone_label: normalizeValue(payload.milestone_label),
    note: normalizeValue(payload.note),
    photo_url: normalizeValue(payload.photo_url),
    storage_path: normalizeValue(payload.storage_path),
    storage_bucket: normalizeValue(payload.storage_bucket),
    submitted_at_local: normalizeValue(payload.submitted_at_local),
    share_permission: normalizeValue(payload.share_permission),
    uploaded_at_utc: new Date().toISOString()
  };

  const { error } = await db.from(TABLE_NAME).insert([insertPayload]);

  if (error) {
    console.error('submit-milestone-photo: supabase insert failed', error);
    throw new Error('Unable to save milestone photo');
  }

  return insertPayload;
}

async function notifyZapier(payload) {
  if (!ZAPIER_WEBHOOK) return;

  try {
    const response = await fetch(ZAPIER_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '<unreadable body>');
      console.warn('submit-milestone-photo: Zapier non-200 response', {
        status: response.status,
        statusText: response.statusText,
        bodyPreview: text.slice(0, 200)
      });
    }
  } catch (error) {
    console.warn('submit-milestone-photo: Zapier webhook failed', error);
  }
}

export default async function handler(eventOrRequest) {
  const method = getMethod(eventOrRequest);

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: BASE_HEADERS });
  }

  if (method !== 'POST') {
    return buildResponse(405, { error: 'Method Not Allowed' }, { ...JSON_HEADERS, Allow: 'POST, OPTIONS' });
  }

  try {
    const payload = await parseBody(eventOrRequest);
    const submission_uuid = payload.submission_uuid || randomUUID();
    payload.submission_uuid = submission_uuid;

    for (const field of REQUIRED_FIELDS) {
      if (!normalizeValue(payload[field])) {
        return buildResponse(400, { error: `${field} is required` }, JSON_HEADERS);
      }
    }

    const record = await persistSubmission(payload);
    await notifyZapier(record);

    return buildResponse(200, {
      success: true,
      submission_uuid: record.submission_uuid,
      photo_url: record.photo_url,
      storage_path: record.storage_path,
      share_permission: record.share_permission
    }, JSON_HEADERS);
  } catch (error) {
    console.error('submit-milestone-photo: unexpected error', error);
    return buildResponse(500, { error: 'Unable to save milestone photo' }, JSON_HEADERS);
  }
}
