const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const jsonResponse = (status, payload = {}, extraHeaders = {}) => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      ...BASE_HEADERS,
      ...extraHeaders
    }
  }
);

const PROMO_WEBHOOK_URL = process.env.ZAPIER_PROMO_HOOK_URL || 'https://hooks.zapier.com/hooks/catch/21052435/uippsc8/';

export default async function handler(eventOrRequest) {
  const isRequest = typeof eventOrRequest?.method === 'string';
  const method = (isRequest ? eventOrRequest.method : eventOrRequest?.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: BASE_HEADERS });
  }

  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
  }

  let payload = {};
  try {
    if (isRequest) {
      try {
        payload = await eventOrRequest.json();
      } catch (_) {
        const text = await eventOrRequest.text?.();
        payload = text ? JSON.parse(text) : {};
      }
    } else {
      payload = JSON.parse(eventOrRequest.body || '{}');
    }
  } catch (error) {
    console.error('promo-hook invalid json', error);
    return jsonResponse(400, { error: 'Invalid JSON payload' });
  }

  try {
    const response = await fetch(PROMO_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Zapier forward failed', response.status, text);
      return jsonResponse(502, { error: 'Failed to forward to Zapier' });
    }

    return new Response(null, { status: 204, headers: BASE_HEADERS });
  } catch (error) {
    console.error('Promo hook error', error);
    return jsonResponse(500, { error: 'Internal Server Error' });
  }
}
