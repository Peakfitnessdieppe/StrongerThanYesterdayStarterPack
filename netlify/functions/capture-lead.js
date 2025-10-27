import { getSupabaseClient } from './_utils/supabase.js';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

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

// Support both legacy (event/httpMethod) and modern (Request.method) Netlify runtimes
export default async function handler(eventOrRequest) {
  const isRequest = typeof eventOrRequest?.method === 'string';
  const method = (isRequest ? eventOrRequest.method : eventOrRequest?.httpMethod || '').toUpperCase();
  const contentType = isRequest
    ? eventOrRequest.headers?.get?.('content-type')
    : eventOrRequest?.headers?.['content-type'];
  console.log('capture-lead method', method, 'headers', contentType);

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: BASE_HEADERS });
  }

  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
  }

  try {
    let payload = {};
    if (isRequest) {
      // Modern Web API
      try {
        payload = await eventOrRequest.json();
      } catch (_) {
        const text = await eventOrRequest.text?.();
        payload = text ? JSON.parse(text) : {};
      }
    } else {
      // Legacy event-based API
      payload = JSON.parse(eventOrRequest.body || '{}');
    }

    const {
      email,
      firstName,
      lastName,
      phone,
      audience,
      language,
      utm,
      consentEmail = false,
      consentSms = false
    } = payload;

    if (!email) {
      return jsonResponse(400, { error: 'Email is required' });
    }

    const supabase = getSupabaseClient();
    const db = supabase.schema('peak');

    // upsert lead by email
    const { data: existingLead, error: fetchError } = await db
      .from('leads')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    const payloadToSave = {
      email,
      first_name: firstName || existingLead?.first_name || null,
      last_name: lastName || existingLead?.last_name || null,
      phone: phone || existingLead?.phone || null,
      audience: audience || existingLead?.audience || null,
      language: language || existingLead?.language || null,
      utm: utm ? utm : existingLead?.utm || null,
      consent_email: consentEmail,
      consent_sms: consentSms
    };

    let leadId;

    if (existingLead) {
      const { data, error } = await db
        .from('leads')
        .update(payloadToSave)
        .eq('id', existingLead.id)
        .select('*')
        .maybeSingle();

      if (error) throw error;
      leadId = data.id;
    } else {
      const { data, error } = await db
        .from('leads')
        .insert(payloadToSave)
        .select('*')
        .single();

      if (error) throw error;
      leadId = data.id;
    }

    return jsonResponse(200, { leadId });
  } catch (error) {
    console.error('capture-lead error', error);
    return jsonResponse(500, { error: 'Failed to capture lead' });
  }
}
