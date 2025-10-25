import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSupabaseClient } from './_utils/supabase.js';

const SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

function verifySignature(signature, body, notificationUrl) {
  if (!SIGNATURE_KEY) return true; // optionally skip verification in dev
  if (!signature) return false;

  const payload = notificationUrl + body;
  const hmac = createHmac('sha1', SIGNATURE_KEY);
  hmac.update(payload);
  const expected = Buffer.from(hmac.digest('hex'));
  const received = Buffer.from(signature);

  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
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

export default async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: 'Method Not Allowed' };
  }

  const signature = event.headers['x-square-hmacsha256-signature'] || event.headers['x-square-signature'];
  const notificationUrl = `https://${event.headers.host}${event.rawUrl?.split(event.headers.host)[1] || event.path}`;

  if (!verifySignature(signature, event.body || '', notificationUrl)) {
    console.warn('Square signature verification failed');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
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

    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('square-webhook error', error);
    return { statusCode: 500, body: 'Internal Error' };
  }
}
