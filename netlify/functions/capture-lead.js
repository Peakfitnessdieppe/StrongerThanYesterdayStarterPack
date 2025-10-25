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

export default async function handler(event) {
  const method = (event.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: BASE_HEADERS
    });
  }

  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const {
      email,
      firstName,
      lastName,
      phone,
      audience,
      language,
      goals,
      utm,
      consentEmail = false,
      consentSms = false
    } = payload;

    if (!email) {
      return jsonResponse(400, { error: 'Email is required' });
    }

    const supabase = getSupabaseClient();

    // upsert lead by email
    const { data: existingLead, error: fetchError } = await supabase
      .from('peak.leads')
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
      goals: goals || existingLead?.goals || null,
      utm: utm ? utm : existingLead?.utm || null,
      consent_email: consentEmail,
      consent_sms: consentSms
    };

    let leadId;

    if (existingLead) {
      const { data, error } = await supabase
        .from('peak.leads')
        .update(payloadToSave)
        .eq('id', existingLead.id)
        .select('*')
        .maybeSingle();

      if (error) throw error;
      leadId = data.id;
    } else {
      const { data, error } = await supabase
        .from('peak.leads')
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
