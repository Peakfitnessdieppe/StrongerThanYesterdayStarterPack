import { createClient } from '@supabase/supabase-js';

const ORDER_REGEX = /^START-\d{3,}$/i;

function badRequest(message) {
  return new Response(JSON.stringify({ message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  try {
    const method = (req.method || '').toUpperCase();
    if (!['POST', 'GET'].includes(method)) {
      return new Response(JSON.stringify({ message: 'Method not allowed' }), {
        status: 405,
        headers: { 'Allow': 'GET, POST', 'Content-Type': 'application/json' },
      });
    }

    let body = {};
    if (method === 'POST') {
      try {
        body = await req.json();
      } catch (_) {
        body = {};
      }
    }

    let order = String(body?.order || '').trim().toUpperCase();
    if (!order) {
      try {
        const url = new URL(req.url, 'http://localhost');
        order = String(url.searchParams.get('order') || '').trim().toUpperCase();
      } catch (_) {}
    }

    const buddyName = String(body?.buddyName || body?.name || '').trim();
    const buddyEmail = String(body?.buddyEmail || body?.email || '').trim();
    const buyerName = String(body?.buyerName || body?.buyer || '').trim();

    if (!ORDER_REGEX.test(order)) return badRequest('Enter a valid order number like START-001');
    if (method === 'POST' && !body?.checkOnly) {
      if (!buddyName) return badRequest('Enter your buddy’s name');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buddyEmail)) return badRequest('Enter a valid buddy email');
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const GLOFOX_BUDDY_URL = process.env.GLOFOX_BUDDY_URL || 'https://app.glofox.com/portal/#/branch/6245c53b0ebd700576474a53/memberships/6908fc1bbc2e9d5ab609889b/plan/1762196452061/buy';
    const BUDDY_WEBHOOK = process.env.ZAPIER_BUDDY_PASS_WEBHOOK;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ message: 'Server not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Ensure the order has fewer than 2 claims
    const { data: existing, count, error: countError } = await supabase
      .from('buddy_passes')
      .select('id, buddy_email, buddy_name, created_at', { count: 'exact' })
      .eq('order_number', order);

    if (countError) throw countError;
    const remaining = Math.max(0, 2 - (count ?? 0));

    if (method === 'GET' || body?.checkOnly) {
      return new Response(JSON.stringify({
        ok: true,
        remaining,
        total: 2,
        redemptions: existing ?? [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (remaining <= 0) return badRequest('This order has already used both buddy passes.');

    const { data: insertData, error: insertError } = await supabase.from('buddy_passes').insert({
      order_number: order,
      buddy_name: buddyName,
      buddy_email: buddyEmail,
      status: 'claimed',
    }).select().single();

    if (insertError) throw insertError;

    const updatedRemaining = Math.max(0, remaining - 1);

    if (BUDDY_WEBHOOK) {
      try {
        await fetch(BUDDY_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'buddy_pass.claimed',
            order,
            buyerName,
            buddyName,
            buddyEmail,
            glofoxLink: GLOFOX_BUDDY_URL,
            claimedAt: new Date().toISOString(),
            buddyPassId: insertData?.id || null,
            remaining: updatedRemaining,
          }),
        });
      } catch (webhookError) {
        console.error('Buddy pass webhook failed', webhookError);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      glofoxLink: GLOFOX_BUDDY_URL,
      message: buyerName ? `${buyerName} just reserved a buddy pass for ${buddyName}. Share the link below to finish registration.` : undefined,
      remaining: updatedRemaining,
      total: 2,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ message: err.message || 'Unexpected error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
