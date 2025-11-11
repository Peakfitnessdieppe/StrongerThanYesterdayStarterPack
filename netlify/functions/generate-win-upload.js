import { getSupabaseClient } from './_utils/supabase.js';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const BUCKET = 'member-wins';
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
const SIGNED_URL_EXPIRY_SECONDS = 90;

const jsonResponse = (status, payload, extraHeaders = {}) => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      ...BASE_HEADERS,
      ...extraHeaders
    }
  }
);

const sanitizeSegment = (value, fallback = 'member') => {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || fallback;
};

const sanitizeFilename = (value) => {
  if (!value || typeof value !== 'string') return 'upload';
  const parts = value.split('.');
  const ext = parts.length > 1 ? parts.pop() : '';
  const name = sanitizeSegment(parts.join('.') || 'upload', 'upload');
  const safeExt = ext ? ext.replace(/[^a-z0-9]/gi, '') : '';
  return safeExt ? `${name}.${safeExt}` : name;
};

const buildObjectPath = ({ email, firstName, lastName, memberName, filename }) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeFilename = sanitizeFilename(filename);

  const safeEmail = sanitizeSegment(email, null);
  const safeFirst = sanitizeSegment(firstName, null);
  const safeLast = sanitizeSegment(lastName, null);
  const safeMember = sanitizeSegment(memberName, 'member');

  const memberSegment = safeEmail
    || [safeFirst, safeLast].filter(Boolean).join('-')
    || safeMember
    || 'member';

  return `${memberSegment}/${timestamp}-${safeFilename}`;
};

const parseBody = async (eventOrRequest) => {
  if (eventOrRequest?.json) {
    try {
      return await eventOrRequest.json();
    } catch (_) {
      return {};
    }
  }
  try {
    return JSON.parse(eventOrRequest?.body || '{}');
  } catch (_) {
    return {};
  }
};

export default async function handler(eventOrRequest) {
  const isRequest = typeof eventOrRequest?.method === 'string';
  const method = (isRequest ? eventOrRequest.method : eventOrRequest?.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: BASE_HEADERS });
  }

  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' }, { Allow: 'POST, OPTIONS' });
  }

  try {
    const payload = await parseBody(eventOrRequest);
    const {
      filename: rawFilename,
      contentType,
      email,
      firstName,
      lastName,
      memberName
    } = payload || {};

    if (!rawFilename) {
      return jsonResponse(400, { error: 'filename is required' });
    }

    const objectPath = buildObjectPath({
      email,
      firstName,
      lastName,
      memberName,
      filename: rawFilename
    });

    const supabase = getSupabaseClient();

    const { data: signedData, error: signedError } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUploadUrl(objectPath, SIGNED_URL_EXPIRY_SECONDS);

    if (signedError || !signedData?.signedUrl || !signedData?.token) {
      console.error('createSignedUploadUrl error', signedError);
      return jsonResponse(500, { error: 'Unable to create upload URL' });
    }

    const { data: publicData } = supabase
      .storage
      .from(BUCKET)
      .getPublicUrl(objectPath);

    return jsonResponse(200, {
      uploadUrl: signedData.signedUrl,
      token: signedData.token,
      path: objectPath,
      publicUrl: publicData?.publicUrl || null,
      maxBytes: MAX_UPLOAD_BYTES,
      contentType: contentType || 'application/octet-stream'
    });
  } catch (error) {
    console.error('generate-win-upload error', error);
    return jsonResponse(500, { error: 'Failed to prepare upload' });
  }
}
