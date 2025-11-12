import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSupabaseClient } from './_utils/supabase.js';

const SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST'
};

const RAW_BODY_SYMBOL = Symbol('squareRawBody');

function response(status, body = '', extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      ...BASE_HEADERS,
      ...extraHeaders
    }
  });
}

function safeCompareBase64(expectedBase64, receivedBase64) {
  try {
    const expected = Buffer.from(expectedBase64, 'base64');
    const received = Buffer.from(receivedBase64, 'base64');
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  } catch (_) {
    return false;
  }
}

function verifySignature(signature, body, notificationUrl) {
  if (!SIGNATURE_KEY) return true; // optionally skip verification in dev
  if (!signature) return false;

  const payload = notificationUrl + body;

  // Primary: Square Webhooks v2 (HMAC-SHA256)
  const hmac256 = createHmac('sha256', SIGNATURE_KEY);
  hmac256.update(payload);
  if (safeCompareBase64(hmac256.digest('base64'), signature)) {
    return true;
  }

  // Fallback: legacy Connect webhooks (HMAC-SHA1)
  const hmac1 = createHmac('sha1', SIGNATURE_KEY);
  hmac1.update(payload);
  return safeCompareBase64(hmac1.digest('base64'), signature);
}

async function notifyZapier(eventName, payload) {
  const webhook = process.env.ZAPIER_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: eventName, data: payload })
    });
  } catch (error) {
    console.error('Zapier notification failed', error);
  }
}

function getMethod(event) {
  if (typeof event?.httpMethod === 'string') return event.httpMethod.toUpperCase();
  if (typeof event?.method === 'string') return event.method.toUpperCase();
  if (typeof event?.request?.method === 'string') return event.request.method.toUpperCase();
  if (typeof event === 'object' && typeof event?.text === 'function' && typeof event?.headers?.get === 'function') {
    // Native Request instance
    return event.method?.toUpperCase?.() || '';
  }
  return '';
}

function getHeaderValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase()) || '';
  }
  const lower = name.toLowerCase();
  return headers[name] || headers[lower] || headers[name.toUpperCase?.()] || '';
}

function resolveNotificationUrl(event) {
  const rawUrl = typeof event?.rawUrl === 'string' && event.rawUrl.length
    ? event.rawUrl
    : typeof event?.url === 'string' && event.url.length
      ? event.url
      : typeof event?.request?.url === 'string'
        ? event.request.url
        : '';

  if (rawUrl) return rawUrl;

  const host = getHeaderValue(event?.headers, 'host');
  const path = event?.rawPath || event?.path || '';
  if (host) {
    return `https://${host}${path}`;
  }
  return path;
}

async function getRawBody(event) {
  if (!event) return '';

  if (event[RAW_BODY_SYMBOL]) return event[RAW_BODY_SYMBOL];

  if (typeof event.body === 'string') {
    event[RAW_BODY_SYMBOL] = event.body;
    return event.body;
  }

  if (typeof event.rawBody === 'string') {
    event[RAW_BODY_SYMBOL] = event.rawBody;
    return event.rawBody;
  }

  if (typeof event.text === 'function') {
    const text = await event.text();
    event[RAW_BODY_SYMBOL] = text;
    return text;
  }

  if (event.request && typeof event.request.text === 'function') {
    const text = await event.request.text();
    event[RAW_BODY_SYMBOL] = text;
    return text;
  }

  return '';
}

export default async function handler(event) {
  const method = getMethod(event);

  if (method === 'OPTIONS') {
    return response(200, 'OK');
  }

  if (method === 'GET' || method === 'HEAD') {
    return response(200, 'Square webhook up');
  }

  if (method !== 'POST') {
    return response(405, 'Method Not Allowed', { Allow: 'POST' });
  }

  const signature = getHeaderValue(event.headers, 'x-square-hmacsha256-signature') || getHeaderValue(event.headers, 'x-square-signature');
  const notificationUrl = resolveNotificationUrl(event);

  const rawBody = await getRawBody(event);
  const expectedSignature = createHmac('sha256', SIGNATURE_KEY)
    .update(notificationUrl + rawBody)
    .digest('base64');

  console.log('square signature debug', {
    signature,
    expectedSignature,
    bodyLength: rawBody?.length,
    notificationUrl
  });

  if (!verifySignature(signature, rawBody, notificationUrl)) {
    console.warn('Square signature verification failed');
    return response(400, 'Invalid signature');
  }

  try {
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const { type, data } = payload;

    const supabase = getSupabaseClient();

    if (type.startsWith('payment.')) {
      const payment = data.object?.payment;
      if (payment) {
        await supabase
          .from('peak.payments')
          .upsert({
            square_payment_id: payment.id,
            lead_id: payment.customerId || null,
            status: payment.status,
            amount_cents: payment.amountMoney?.amount || null,
            currency: payment.amountMoney?.currency || null,
            receipt_url: payment.receiptUrl || null,
            raw: payment
          }, { onConflict: 'square_payment_id' });
        await notifyZapier(type, { squarePaymentId: payment.id, status: payment.status });
      }
    }

    if (type.startsWith('refund.')) {
      const refund = data.object?.refund;
      if (refund) {
        await supabase
          .from('peak.payments')
          .upsert({
            square_payment_id: refund.paymentId,
            status: refund.status,
            raw: refund
          }, { onConflict: 'square_payment_id' });
        await notifyZapier(type, { refundId: refund.id, status: refund.status });
      }
    }

    return response(200, 'OK');
  } catch (error) {
    console.error('square-webhook error', error);
    return response(500, 'Internal Error');
  }
}
