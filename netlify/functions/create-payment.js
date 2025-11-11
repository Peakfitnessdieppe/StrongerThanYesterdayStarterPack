import { randomUUID } from 'node:crypto';
import { getSquareClient, getSquareConfig } from './_utils/square.js';
import { getSupabaseClient } from './_utils/supabase.js';

const DEFAULT_PRICE_CENTS = Number.parseInt(process.env.STARTER_PACK_PRICE_CENTS || '13999', 10);
const DEFAULT_CURRENCY = process.env.STARTER_PACK_CURRENCY || 'CAD';
const NB_HST_RATE = Number.parseFloat(process.env.NB_HST_RATE || '0.15');

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
  const webhook =
    process.env.ZAPIER_SQUARE_PURCHASE_WEBHOOK_URL ||
    process.env.ZAPIER_WEBHOOK_URL;
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
      utm
    } = payload;

    if (!leadId) {
      return jsonResponse(400, { error: 'leadId is required' });
    }

    if (!sourceId) {
      return jsonResponse(400, { error: 'sourceId is required' });
    }

    const taxRate = Number.isFinite(NB_HST_RATE) ? NB_HST_RATE : 0;
    const subtotalCents = DEFAULT_PRICE_CENTS;
    if (!subtotalCents || subtotalCents <= 0) {
      return jsonResponse(400, { error: 'Invalid amount' });
    }
    const taxCents = Math.round(subtotalCents * taxRate);
    const priceCents = subtotalCents + taxCents;

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
      note: 'Stronger Than Yesterday Starter',
      buyerEmailAddress: buyerEmail || undefined,
      customerDetails: {
        emailAddress: buyerEmail || undefined,
        phoneNumber: buyerPhone || undefined
      }
    };

    const squareBaseUrl = (process.env.SQUARE_ENVIRONMENT || '').toLowerCase() === 'sandbox'
      ? 'https://connect.squareupsandbox.com'
      : 'https://connect.squareup.com';

    const restPayload = {
      idempotency_key: idempotencyKey,
      source_id: sourceId,
      location_id: locationId,
      amount_money: {
        amount: Number(paymentRequest.amountMoney.amount),
        currency: paymentRequest.amountMoney.currency
      },
      autocomplete: true,
      note: paymentRequest.note,
      buyer_email_address: paymentRequest.buyerEmailAddress,
      customer_details: {
        email_address: paymentRequest.customerDetails?.emailAddress,
        phone_number: paymentRequest.customerDetails?.phoneNumber
      }
    };

    const squareResponse = await fetch(`${squareBaseUrl}/v2/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        'Square-Version': process.env.SQUARE_API_VERSION || '2024-01-18'
      },
      body: JSON.stringify(restPayload)
    });

    const squareJson = await squareResponse.json().catch(() => null);

    if (!squareResponse.ok) {
      console.error('Square REST error', squareJson);
      const detail = squareJson?.errors?.[0]?.detail || 'Square payment failed';
      throw new Error(detail);
    }

    const payment = squareJson?.payment;

    if (!payment) {
      throw new Error('Square payment response missing payment object');
    }

    let receiptUrl = payment.receipt_url || payment.receiptUrl || null;
    if (
      receiptUrl &&
      (process.env.SQUARE_ENVIRONMENT || '').toLowerCase() === 'sandbox' &&
      receiptUrl.includes('squareup.com/receipt')
    ) {
      receiptUrl = receiptUrl.replace('squareup.com/receipt', 'squareupsandbox.com/receipt');
    }

    const amountMoney = payment.amountMoney || {};
    const rawAmount = amountMoney.amount ?? priceCents;
    const amountCentsValue = typeof rawAmount === 'bigint' ? Number(rawAmount) : Number(rawAmount);
    const amountCentsSafe = Number.isFinite(amountCentsValue) ? amountCentsValue : priceCents;
    const currency = amountMoney.currency || DEFAULT_CURRENCY;

    let formattedAmount = `${(amountCentsSafe / 100).toFixed(2)} ${currency}`;
    try {
      formattedAmount = new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency
      }).format(amountCentsSafe / 100);
    } catch (_) {}

    const purchasedAtIso = payment.createdAt || payment.created_at || new Date().toISOString();

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

    let orderNumber;

    const { data: existingPayment, error: existingPaymentError } = await db
      .from('payments')
      .select('id, order_number')
      .eq('square_payment_id', payment.id)
      .maybeSingle();

    if (existingPaymentError && existingPaymentError.code !== 'PGRST116') {
      throw existingPaymentError;
    }

    if (existingPayment?.order_number) {
      orderNumber = existingPayment.order_number;
    } else {
      const { data: latestOrders, error: latestOrderError } = await db
        .from('payments')
        .select('order_number')
        .not('order_number', 'is', null)
        .order('order_number', { ascending: false })
        .limit(1);

      if (latestOrderError && latestOrderError.code !== 'PGRST116') {
        throw latestOrderError;
      }

      const latestValue = latestOrders?.[0]?.order_number;
      const numericPart = latestValue ? Number.parseInt(String(latestValue).replace(/^START-/i, ''), 10) : 0;
      const nextValue = Number.isFinite(numericPart) ? numericPart + 1 : 1;
      orderNumber = `START-${String(nextValue).padStart(3, '0')}`;
    }

    const paymentRecord = {
      lead_id: leadId,
      square_payment_id: payment.id,
      order_number: orderNumber,
      status: payment.status,
      amount_cents: amountCentsSafe,
      currency,
      receipt_url: receiptUrl,
      purchased_at: purchasedAtIso,
      buyer_phone: buyerPhone || payment.customerDetails?.phoneNumber || null,
      raw: payment
    };

    const { error: upsertError } = await db
      .from('payments')
      .upsert(paymentRecord, { onConflict: 'square_payment_id' });

    if (upsertError) throw upsertError;

    await notifyZapier('payment.created', {
      leadId,
      buyerEmail: buyerEmail || payment.customerDetails?.emailAddress || null,
      buyerName,
      buyerPhone: paymentRecord.buyer_phone,
      squarePaymentId: payment.id,
      orderNumber,
      status: payment.status,
      amountCents: amountCentsSafe,
      formattedAmount,
      currency,
      purchasedAt: purchasedAtIso,
      receiptUrl: paymentRecord.receipt_url
    });

    return jsonResponse(200, {
      paymentId: payment.id,
      status: payment.status,
      amountCents: amountCentsSafe,
      formattedAmount,
      currency,
      purchasedAt: purchasedAtIso,
      orderNumber,
      buyerPhone: paymentRecord.buyer_phone,
      receiptUrl: receiptUrl
    });
  } catch (error) {
    console.error('create-payment error', error);
    const message = error.errors?.[0]?.detail || error.message || 'Payment failed';
    return jsonResponse(502, { error: message });
  }
}
