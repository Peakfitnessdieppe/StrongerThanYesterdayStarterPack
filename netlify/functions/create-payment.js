import { randomUUID } from 'node:crypto';
import { getSquareClient, getSquareConfig } from './_utils/square.js';
import { getSupabaseClient } from './_utils/supabase.js';

const DEFAULT_PRICE_CENTS = Number.parseInt(process.env.STARTER_PACK_PRICE_CENTS || '13999', 10);
const DEFAULT_CURRENCY = process.env.STARTER_PACK_CURRENCY || 'CAD';

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
    return {
      statusCode: 405,
      headers: { Allow: 'POST' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const {
      leadId,
      sourceId,
      idempotencyKey = randomUUID(),
      buyerEmail,
      buyerName,
      buyerPhone,
      audience,
      language,
      utm,
      amountCents
    } = payload;

    if (!leadId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'leadId is required' }) };
    }

    if (!sourceId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'sourceId is required' }) };
    }

    const priceCents = Number.isFinite(amountCents) ? amountCents : DEFAULT_PRICE_CENTS;
    if (!priceCents || priceCents <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount' }) };
    }

    const square = getSquareClient();
    const { locationId } = getSquareConfig();

    const { paymentsApi } = square;

    const paymentRequest = {
      sourceId,
      idempotencyKey,
      locationId,
      amountMoney: {
        amount: priceCents,
        currency: DEFAULT_CURRENCY
      },
      autocomplete: true,
      note: 'Peak Fitness Starter Pack',
      buyerEmailAddress: buyerEmail || undefined,
      customerDetails: {
        emailAddress: buyerEmail || undefined,
        phoneNumber: buyerPhone || undefined
      }
    };

    const response = await paymentsApi.createPayment(paymentRequest);
    const payment = response.result?.payment;

    if (!payment) {
      throw new Error('Square payment response missing payment object');
    }

    const supabase = getSupabaseClient();

    const { data: existingLead, error: leadError } = await supabase
      .from('peak.leads')
      .select('id')
      .eq('id', leadId)
      .maybeSingle();

    if (leadError) throw leadError;
    if (!existingLead) {
      console.warn('Lead not found for payment, inserting fallback lead');
      await supabase
        .from('peak.leads')
        .insert({ id: leadId, email: buyerEmail, audience, language, utm, consent_email: true });
    }

    const paymentRecord = {
      lead_id: leadId,
      square_payment_id: payment.id,
      status: payment.status,
      amount_cents: payment.amountMoney?.amount ?? priceCents,
      currency: payment.amountMoney?.currency ?? DEFAULT_CURRENCY,
      receipt_url: payment.receiptUrl || null,
      raw: payment
    };

    const { error: upsertError } = await supabase
      .from('peak.payments')
      .upsert(paymentRecord, { onConflict: 'square_payment_id' });

    if (upsertError) throw upsertError;

    await notifyZapier('payment.created', {
      leadId,
      squarePaymentId: payment.id,
      status: payment.status,
      amountCents: paymentRecord.amount_cents,
      currency: paymentRecord.currency,
      receiptUrl: paymentRecord.receipt_url
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        paymentId: payment.id,
        status: payment.status,
        receiptUrl: payment.receiptUrl || null
      })
    };
  } catch (error) {
    console.error('create-payment error', error);
    const message = error.errors?.[0]?.detail || error.message || 'Payment failed';
    return {
      statusCode: 502,
      body: JSON.stringify({ error: message })
    };
  }
}
