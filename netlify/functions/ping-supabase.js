import { URL } from 'node:url';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const buildResponse = (status, payload) => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: JSON_HEADERS
  }
);

export default async function handler() {
  const url = process.env.SUPABASE_URL || '';
  if (!url) {
    console.error('ping-supabase missing SUPABASE_URL');
    return buildResponse(500, { ok: false, error: 'SUPABASE_URL not configured' });
  }

  let target;
  try {
    const base = new URL(url);
    target = `${base.origin}/auth/v1/health`;
  } catch (error) {
    console.error('ping-supabase invalid SUPABASE_URL', error);
    return buildResponse(500, { ok: false, error: 'Invalid SUPABASE_URL' });
  }

  try {
    const response = await fetch(target, { method: 'GET', redirect: 'follow' });
    const ok = response.ok;
    const status = response.status;
    const body = await response.json().catch(() => ({}));
    console.log('ping-supabase response', { status, ok, body });
    return buildResponse(200, { ok, status, body });
  } catch (error) {
    console.error('ping-supabase fetch failed', { message: error?.message });
    return buildResponse(502, { ok: false, error: 'Fetch to Supabase failed' });
  }
}
