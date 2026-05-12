import { getSupabaseClient } from './_utils/supabase.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const TABLE_SCHEMA = process.env.LEADS_SCHEMA || process.env.SUPABASE_SCHEMA || 'peak';
const TABLE_NAME = process.env.LEADS_TABLE || 'leads';

const buildResponse = (status, payload) => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: JSON_HEADERS
  }
);

export default async function handler() {
  try {
    const supabase = getSupabaseClient();
    const db = TABLE_SCHEMA ? supabase.schema(TABLE_SCHEMA) : supabase;

    const { data, error } = await db
      .from(TABLE_NAME)
      .select('id')
      .limit(1);

    if (error) {
      console.error('ping-supabase query failed', {
        message: error?.message,
        code: error?.code,
        details: error?.details
      });
      return buildResponse(502, { ok: false, error: 'Supabase query failed', code: error?.code });
    }

    const count = Array.isArray(data) ? data.length : 0;
    console.log('ping-supabase success', { table: TABLE_NAME, schema: TABLE_SCHEMA, count, firstId: data?.[0]?.id || null });
    return buildResponse(200, { ok: true, count, firstId: data?.[0]?.id || null });
  } catch (error) {
    console.error('ping-supabase unexpected error', { message: error?.message });
    return buildResponse(500, { ok: false, error: 'Unexpected error' });
  }
}
