import { randomUUID } from 'node:crypto';
import { getSquareClient, getSquareConfig } from './_utils/square.js';
import { getSupabaseClient } from './_utils/supabase.js';

const DEFAULT_PRICE_CENTS = Number.parseInt(process.env.STARTER_PACK_PRICE_CENTS || '13999', 10);
const DEFAULT_CURRENCY = process.env.STARTER_PACK_CURRENCY || 'CAD';

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

export default async function handler(eventOrRequest) {
  const isRequest = typeof eventOrRequest?.method === 'string';
  const method = (isRequest ? eventOrRequest.method : eventOrRequest?.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: BASE_HEADERS });
  }

  if (method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
  }

  try {
    let payload = {};
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
      return jsonResponse(400, { error: 'leadId is required' });
    }

    if (!sourceId) {
      return jsonResponse(400, { error: 'sourceId is required' });
    }

    const priceCents = Number.isFinite(amountCents) ? amountCents : DEFAULT_PRICE_CENTS;
    if (!priceCents || priceCents <= 0) {
      return jsonResponse(400, { error: 'Invalid amount' });
    }

    const square = getSquareClient();
    const { locationId } = getSquareConfig();

    let paymentsApi =
      square?.paymentsApi ??
      square?.payments ??
      square?._payments ??
      (typeof square?.getPaymentsApi === 'function' ? square.getPaymentsApi() : undefined);

    if (typeof paymentsApi === 'function' && !paymentsApi.createPayment) {
      try {
        paymentsApi = paymentsApi();
      } catch (factoryError) {
        console.error('Square payments API factory invocation failed', factoryError);
      }
    }

    const proto = paymentsApi ? Object.getPrototypeOf(paymentsApi) : null;
    const prototypeMethods = proto ? Object.getOwnPropertyNames(proto) : null;

    let createPaymentFn = typeof paymentsApi?.createPayment === 'function' ? paymentsApi.createPayment.bind(paymentsApi) : null;

    if (!createPaymentFn && prototypeMethods) {
      const directMatch = prototypeMethods.find(name => name.toLowerCase() === 'createpayment');
      if (directMatch && typeof paymentsApi[directMatch] === 'function') {
        createPaymentFn = paymentsApi[directMatch].bind(paymentsApi);
      }
    }

    if (!createPaymentFn && typeof paymentsApi?.create === 'function') {
      createPaymentFn = paymentsApi.create.bind(paymentsApi);
    }

    if (!createPaymentFn && prototypeMethods) {
      const fuzzyMatch = prototypeMethods.find(name => name.toLowerCase().includes('create') && typeof paymentsApi[name] === 'function');
      if (fuzzyMatch) {
        createPaymentFn = paymentsApi[fuzzyMatch].bind(paymentsApi);
      }
    }

    console.log('Square payments API introspection', {
      paymentsApiType: typeof paymentsApi,
      constructorName: paymentsApi?.constructor?.name,
      hasCreatePayment: typeof paymentsApi?.createPayment,
      squareKeys: square ? Object.keys(square) : null,
      prototypeMethods
    });

    if (!paymentsApi || !createPaymentFn) {
      console.error('Square payments API unavailable', {
        squareKeys: square ? Object.keys(square) : null,
        paymentsApiType: typeof paymentsApi,
        paymentsApiKeys: paymentsApi && typeof paymentsApi === 'object' ? Object.keys(paymentsApi) : null,
        prototypeMethods
      });
      throw new Error('Square payments API unavailable. Check SDK version and exports.');
    }

    const paymentRequest = {
      sourceId,
      idempotencyKey,
      locationId,
      amountMoney: {
        amount: BigInt(priceCents),
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

    const response = await createPaymentFn(paymentRequest);
    const payment = response.result?.payment;

    if (!payment) {
      throw new Error('Square payment response missing payment object');
    }

    const supabase = getSupabaseClient();
    const db = supabase.schema('peak');

    const { data: existingLead, error: leadError } = await db
      .from('leads')
      .select('id')
      .eq('id', leadId)
      .maybeSingle();

    if (leadError) throw leadError;
    if (!existingLead) {
      console.warn('Lead not found for payment, inserting fallback lead');
      await db
        .from('leads')
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

    const { error: upsertError } = await db
      .from('payments')
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

    return jsonResponse(200, {
      paymentId: payment.id,
      status: payment.status,
      receiptUrl: payment.receiptUrl || null
    });
  } catch (error) {
    console.error('create-payment error', error);
    const message = error.errors?.[0]?.detail || error.message || 'Payment failed';
    return jsonResponse(502, { error: message });
  }
}
