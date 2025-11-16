import { getSupabaseClient } from './_utils/supabase.js';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

const SCHEMAS = {
  wins: process.env.WINS_CAPTURE_SCHEMA || 'peak',
  checkins: process.env.ONBOARDING_CHECKINS_SCHEMA || 'peak',
  finish: process.env.STRONGER_FINISH_SCHEMA || 'peak',
  milestones: process.env.MILESTONE_PHOTOS_SCHEMA || 'peak',
  inbody: process.env.INBODY_SCHEMA || 'peak'
};

const TABLES = {
  wins: process.env.WINS_CAPTURE_TABLE || 'wins_capture',
  checkins: process.env.ONBOARDING_CHECKINS_TABLE || 'onboarding_checkins',
  finish: process.env.STRONGER_FINISH_TABLE || 'stronger_finish_feedback',
  milestones: process.env.MILESTONE_PHOTOS_TABLE || 'milestone_photos',
  inbody: process.env.INBODY_TABLE || 'inbody_scans'
};

const jsonResponse = (status, payload, extraHeaders = {}) => new Response(
  JSON.stringify(payload),
  { status, headers: { ...BASE_HEADERS, ...extraHeaders } }
);

function getParamFromUrl(url, key) {
  try {
    const u = new URL(url);
    return u.searchParams.get(key) || '';
  } catch (_) {
    return '';
  }
}

async function fetchWins(db, email, limit) {
  try {
    const q = db
      .schema(SCHEMAS.wins)
      .from(TABLES.wins)
      .select('submission_uuid,email,member_name,win_story,wins_tags,media_url,submitted_at_local')
      .eq('email', email)
      .order('submitted_at_local', { ascending: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (_) {
    return [];
  }
}

async function fetchCheckins(db, email, limit) {
  try {
    const q = db
      .schema(SCHEMAS.checkins)
      .from(TABLES.checkins)
      .select('submission_uuid,email,member_name,order_number,q1_helpful,q2_ready,q3_better,note,submitted_at_local')
      .eq('email', email)
      .order('submitted_at_local', { ascending: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (_) {
    return [];
  }
}

async function fetchFinish(db, email, limit) {
  try {
    const q = db
      .schema(SCHEMAS.finish)
      .from(TABLES.finish)
      .select('submission_uuid,email,member_name,q1_overall,q2_biggest_win,q3_coach_support,q6_email_helpful,q8_confidence,q9_refer,q10_notes,submitted_at_local')
      .eq('email', email)
      .order('submitted_at_local', { ascending: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (_) {
    return [];
  }
}

async function fetchMilestones(db, email, limit) {
  try {
    const q = db
      .schema(SCHEMAS.milestones)
      .from(TABLES.milestones)
      .select('submission_uuid,email,member_name,photo_url,storage_path,storage_bucket,share_permission,submitted_at_local,uploaded_at_utc')
      .eq('email', email)
      .order('uploaded_at_utc', { ascending: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (_) {
    return [];
  }
}

async function fetchInbody(db, email, limit) {
  try {
    const q = db
      .schema(SCHEMAS.inbody)
      .from(TABLES.inbody)
      .select('scan_id,member_email,member_name,first_name,last_name,phone,age_years,height_cm,scan_date,weight_lb,tbw_lb,dlm_lb,bfm_lb,lbm_lb,smm_lb,bmi,pbf,bfm_control_lb,lbm_control_lb,bmr_kcal,notes,created_at')
      .eq('member_email', email)
      .order('scan_date', { ascending: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (_) {
    return [];
  }
}

function pickName(defaultName, ...candidates) {
  for (const c of candidates) {
    if (c && String(c).trim()) return String(c).trim();
  }
  return defaultName || '';
}

export default async function handler(event) {
  const method = (event?.method || event?.httpMethod || '').toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: BASE_HEADERS });
  if (method !== 'GET') return jsonResponse(405, { error: 'Method Not Allowed' }, { Allow: 'GET, OPTIONS' });

  const email = getParamFromUrl(event?.url || event?.rawUrl || '', 'email') || getParamFromUrl(event?.headers?.Referer || event?.headers?.referer || '', 'email');
  const limitParam = getParamFromUrl(event?.url || event?.rawUrl || '', 'limit');
  const limit = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 200);

  if (!email) return jsonResponse(400, { error: 'email is required' });

  const supabase = getSupabaseClient();

  const [wins, checkins, finish, milestones, inbody] = await Promise.all([
    fetchWins(supabase, email, limit),
    fetchCheckins(supabase, email, limit),
    fetchFinish(supabase, email, limit),
    fetchMilestones(supabase, email, limit),
    fetchInbody(supabase, email, limit)
  ]);

  const latestFinish = finish?.[0] || null;
  const latestCheckin = checkins?.[0] || null;
  const latestScan = inbody?.[0] || null;

  const nameFromData = pickName('', latestFinish?.member_name, latestCheckin?.member_name, wins?.[0]?.member_name, milestones?.[0]?.member_name, latestScan?.member_name);

  return jsonResponse(200, {
    member: {
      email,
      name: nameFromData
    },
    inbody: {
      latest: latestScan,
      history: inbody
    },
    checkins,
    wins,
    strong_finish: finish,
    milestones
  });
}
