// Calisthenics from CaliCoach (v67). CaliCoach, the camera form coach in Yaver
// Mark II (https://mskorkmaz08-del.github.io/yaver-m2/gym/), recognises the
// exercise, counts reps and scores every rep's form. Yaver reads those workouts
// so the Body screen, the muscle map, Insights and the assistant can use them.
//
// Where the workouts come from (read only, nothing is written back):
// 1. CaliCoach's Supabase server: the same project and account CaliCoach uploads
//    to (table public.sessions). Works on every device; needs a one-time sign-in
//    with an emailed 6-digit code (Settings → CaliCoach).
// 2. This browser: CaliCoach and Yaver share an address (mskorkmaz08-del.github.io),
//    so in the same browser (e.g. Chrome on the laptop) Yaver can open CaliCoach's
//    own database directly. Home Screen apps on the iPhone keep separate storage,
//    so the iPhone needs the server.
// The copy lives in the device-only 'calisthenics' store (like applecal): each
// device fetches it itself; it never goes into the encrypted sync.
import * as db from './db.js';
import { today, addDays } from './util.js';

export const APP_URL = 'https://mskorkmaz08-del.github.io/yaver-m2/gym/';
const EVERY = 10 * 60000;

// CaliCoach exercise → name, muscles [primary], [secondary] (names match the
// muscle map in training.js), the clean-rep goal per set before moving on, and
// the easier / harder variation (the same ladder CaliCoach uses).
export const EX = {
  push_up: ['Push-ups', ['chest', 'triceps'], ['deltoids', 'abs'], 20, 'incline push-ups', 'diamond, decline or archer push-ups', 'push'],
  pike_push_up: ['Pike push-ups', ['deltoids', 'triceps'], ['chest', 'trapezius'], 12, 'regular push-ups and pike holds', 'feet-elevated pike push-ups, then wall handstand push-ups', 'push'],
  dip: ['Dips', ['chest', 'triceps'], ['deltoids'], 15, 'bench dips or dip negatives', 'ring dips or weighted dips', 'push'],
  pull_up: ['Pull-ups', ['upper-back', 'biceps'], ['forearm', 'trapezius'], 10, 'negatives, band-assisted pull-ups or inverted rows', 'L-sit, archer or weighted pull-ups', 'pull'],
  inverted_row: ['Inverted rows', ['upper-back', 'trapezius'], ['biceps', 'lower-back'], 15, 'a higher bar or bent knees', 'feet-elevated or archer rows', 'pull'],
  squat: ['Squats', ['quadriceps', 'gluteal'], ['adductors', 'calves'], 30, 'box squats to a bench', 'Bulgarian split squats, then pistol progressions', 'legs'],
  lunge: ['Lunges', ['quadriceps', 'gluteal'], ['adductors', 'hamstring', 'calves'], 20, 'supported split squats', 'Bulgarian split squats or jumping lunges', 'legs'],
  hanging_leg_raise: ['Hanging leg raises', ['abs'], ['obliques', 'forearm'], 12, 'hanging knee raises', 'toes-to-bar', 'core'],
  plank: ['Plank', ['abs'], ['obliques'], 60, 'knee plank', 'RKC plank or long-lever plank', 'core'],
};
export const FAULTS = {
  partial_depth: ['Partial range', 'Slow 3-second lowering to a target and a 1 s pause at the bottom; an easier variation if needed to reach full range.'],
  no_lockout: ['No lockout', 'Pause for a second fully straight at the start of every rep.'],
  hip_sag: ['Hips sagging', 'Hollow-body holds and planks with a hard glute squeeze.'],
  hip_pike: ['Hips too high', 'Planks side-on to a mirror; push-ups with a stick along the back.'],
  elbow_flare: ['Elbows flared', 'Hands just outside the shoulders, elbows back at about 45 degrees.'],
  rushed: ['Too fast', 'Count a 2-3 second lowering on every rep.'],
  hips_low: ['Hips too low', 'Walk the feet closer so the hips stack high.'],
  chin_below_bar: ['Chin below the bar', 'Negatives from the top, flexed-arm hangs, band-assisted full reps.'],
  kipping: ['Kipping', 'Hollow-body hang and slow strict reps.'],
  excess_lean: ['Too much lean', 'Keep the chest up; for squats, ankle mobility and heels slightly raised.'],
  swinging: ['Swinging', 'Start from a still hang or support and pause at the bottom.'],
  knee_valgus: ['Knees caving in', 'Knees out over the toes; glute bridges and band walks.'],
  bent_knees: ['Bent knees', 'Fine as a progression; straighten the legs as you get stronger.'],
};
export const exName = k => EX[k]?.[0] || k;

// ------------------------------------------------------------ settings and status
const s = (k, f) => db.setting(k, f);
export const server = () => ({ url: String(s('caliUrl', '') || '').trim().replace(/\/+$/, ''), key: String(s('caliKey', '') || '').trim(), email: String(s('caliEmail', '') || '').trim() });
export const serverSet = () => { const v = server(); return !!(v.url && v.key); };
const auth = () => s('caliAuth', null);
export const signedIn = () => !!auth()?.access_token;
export const status = () => s('caliStatus', null);
const setStatus = st => db.setSetting('caliStatus', { ...st, at: new Date().toISOString() });

async function api(path, { method = 'GET', body, token = true } = {}) {
  const { url, key } = server();
  if (!url || !key) throw new Error('Add the CaliCoach server first (Settings → CaliCoach).');
  const headers = { apikey: key };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${await accessToken()}`;
  const r = await fetch(url + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `The server answered ${r.status}.`);
  return data;
}
async function keep(d) {
  await db.setSetting('caliAuth', { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000, email: d.user?.email || auth()?.email || server().email });
}
async function accessToken() {
  const a = auth();
  if (!a) throw new Error('Sign in to the CaliCoach server first (Settings → CaliCoach).');
  if (a.expires_at - Date.now() > 60000) return a.access_token;
  const d = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', token: false, body: { refresh_token: a.refresh_token } });
  await keep(d);
  return d.access_token;
}
export async function sendCode(email) {
  await api('/auth/v1/otp', { method: 'POST', token: false, body: { email, create_user: true } });
}
export async function verifyCode(email, code) {
  const d = await api('/auth/v1/verify', { method: 'POST', token: false, body: { type: 'email', email, token: String(code).trim() } });
  await keep(d);
}
export async function signOut() { await db.setSetting('caliAuth', null); }

// Same browser as CaliCoach: its settings (server address) can be reused.
export function sameBrowserServer() {
  try {
    const c = JSON.parse(localStorage.getItem('calicoach.settings') || 'null');
    return c?.sbUrl && c?.sbKey ? { url: c.sbUrl, key: c.sbKey, email: c.sbEmail || '' } : null;
  } catch { return null; }
}

// ------------------------------------------------------------ fetching
// A CaliCoach session → one compact row (per-rep details without the replay data).
export function toRow(x, origin) {
  const sets = (x.sets || []).map(st => ({
    exercise: st.exercise, kind: st.kind || (st.exercise === 'plank' ? 'hold' : 'reps'),
    reps: st.reps || 0, clean: st.clean || 0, score: st.score ?? null, tempo: st.tempo ?? null,
    hold: st.hold ?? null, best: st.best ?? null, faults: st.faults || {},
    repList: (st.repList || []).map(r => ({ n: r.n, score: r.score, clean: r.clean, bottom: r.bottom, top: r.top, ecc: r.ecc, con: r.con, side: r.side || null, faults: (r.faults || []).map(f => f.key || f) })),
  })).filter(st => EX[st.exercise]);
  const start = new Date(x.start || x.started_at).toISOString();
  return { id: 'cali:' + x.id, source: origin, start, end: x.end ? new Date(x.end).toISOString() : null, date: start.slice(0, 10), origin: x.source || '', sets };
}

async function fromServer() {
  const rows = await api('/rest/v1/sessions?select=id,started_at,ended_at,source,data&order=started_at.desc&limit=300');
  return (rows || []).map(r => toRow({ ...r.data, id: r.id, start: r.data?.start || r.started_at, end: r.data?.end || r.ended_at, source: r.source }, 'server'));
}

async function fromThisBrowser() {
  if (!indexedDB.databases) return null;
  const list = await indexedDB.databases().catch(() => []);
  if (!list.some(d => d.name === 'calicoach')) return null;
  const idb = await new Promise((res, rej) => { const r = indexedDB.open('calicoach'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  try {
    if (!idb.objectStoreNames.contains('sessions')) return [];
    const all = await new Promise((res, rej) => { const r = idb.transaction('sessions').objectStore('sessions').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return all.filter(x => x.source !== 'demo').map(x => toRow(x, 'browser'));
  } finally { idb.close(); }
}

let running = null, lastTry = 0;
/** Fetch the latest workouts (at most every 10 minutes unless forced). Returns true when something was read. */
export function refresh({ force = false } = {}) {
  const st = status();
  if (!force && st?.ok && Date.now() - new Date(st.at) < EVERY) return Promise.resolve(false);
  if (!force && Date.now() - lastTry < 2 * 60000) return Promise.resolve(false);
  lastTry = Date.now();
  return (running ||= run().finally(() => { running = null; }));
}
async function run() {
  const found = new Map();
  let from = [], error = null;
  try {
    const local = await fromThisBrowser();
    if (local) { local.forEach(r => found.set(r.id, r)); if (local.length) from.push('this browser'); }
  } catch (e) { console.warn('calicoach local', e); }
  if (serverSet() && signedIn()) {
    try { const rows = await fromServer(); rows.forEach(r => found.set(r.id, r)); from.push('server'); }
    catch (e) { error = e.message; }
  }
  if (!from.length) {
    await setStatus({ ok: false, error: error || (serverSet() ? 'Sign in to the CaliCoach server (Settings → CaliCoach).' : 'Connect CaliCoach in Settings → CaliCoach, or open CaliCoach in this browser.') });
    return false;
  }
  await db.replaceLocal('calisthenics', [...found.values()]);
  await setStatus({ ok: !error, count: found.size, from, error });
  return true;
}

// ------------------------------------------------------------ analysis
export const workouts = () => db.all('calisthenics').sort((a, b) => a.start.localeCompare(b.start));
export const has = () => db.all('calisthenics').length > 0;
export const onDay = date => db.all('calisthenics').filter(w => w.date === date);
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const avg = a => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);

/** One row per workout that has the exercise (oldest first). */
export function history(ex) {
  return workouts().map(w => {
    const sets = w.sets.filter(st => st.exercise === ex);
    if (!sets.length) return null;
    const reps = sum(sets, st => st.reps), clean = sum(sets, st => st.clean);
    const faults = {};
    for (const st of sets) for (const [k, v] of Object.entries(st.faults || {})) faults[k] = (faults[k] || 0) + v;
    const isHold = ex === 'plank';
    const score = isHold ? Math.round(sum(sets, st => (st.score || 0) * (st.hold || 0)) / Math.max(1, sum(sets, st => st.hold || 0)))
      : Math.round(sum(sets, st => (st.score || 0) * st.reps) / Math.max(1, reps));
    const reps2 = sets.flatMap(st => st.repList || []);
    return { date: w.date, sets: sets.length, reps, clean, score, bestSet: Math.max(...sets.map(st => isHold ? (st.best || st.hold || 0) : st.clean)),
      hold: sum(sets, st => st.hold || 0), faults, ecc: avg(reps2.map(r => r.ecc).filter(v => v != null)), bottom: avg(reps2.map(r => r.bottom).filter(v => v != null)) };
  }).filter(Boolean);
}

/** Everything about one exercise: progress, trend, faults, the next step. */
export function exercise(ex) {
  const rows = history(ex);
  if (!rows.length) return null;
  const [name, , , target, easier, harder] = EX[ex];
  const isHold = ex === 'plank';
  const last = rows[rows.length - 1], recent = rows.slice(-3), before = rows.slice(-6, -3);
  const faults = {};
  let n = 0;
  for (const r of recent) { n += isHold ? r.hold : r.reps; for (const [k, v] of Object.entries(r.faults)) faults[k] = (faults[k] || 0) + v; }
  const top = Object.entries(faults).filter(([k]) => FAULTS[k]).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: FAULTS[k][0], share: isHold ? null : Math.round((100 * v) / Math.max(1, n)), seconds: isHold ? v : null, fix: FAULTS[k][1] }));
  const trend = before.length ? Math.round(avg(recent.map(r => r.score)) - avg(before.map(r => r.score))) : null;
  const best = Math.max(...rows.map(r => r.bestSet));
  const hits = recent.filter(r => r.bestSet >= target).length;
  let next;
  if (top[0] && (isHold || top[0].share >= 30)) next = { kind: 'form', text: `Fix ${top[0].label.toLowerCase()} first (${isHold ? `${top[0].seconds} s of recent holds` : `${top[0].share}% of recent reps`}). ${top[0].fix}` };
  else if (hits >= 2 && last.score >= 80) next = { kind: 'progress', text: `Ready to progress: ${target}+ clean ${isHold ? 'seconds' : 'reps'} in a set with good form. Move on to ${harder}, working in the 5-12 rep range.` };
  else if (!isHold && (last.bestSet < Math.max(3, Math.round(target * 0.2)) || last.score < 60)) next = { kind: 'regress', text: `Use ${easier} to train full-range reps with good form; come back at 8-12 clean reps.` };
  else next = { kind: 'build', text: isHold ? `Add 5-10 s to the best hold (${last.bestSet} s), 3 holds.` : `Beat the best clean set (${last.bestSet}) by 1-2 reps over 3-4 sets. At ${target} move to ${harder.split(',')[0]}.` };
  return { exercise: ex, name, sessions: rows.length, last: last.date, lastScore: last.score, lastBestSet: last.bestSet, bestEver: best, target, unit: isHold ? 's' : 'reps', trend,
    totalReps: sum(rows, r => r.reps), faults: top.slice(0, 3), lowering: last.ecc != null ? +last.ecc.toFixed(1) : null, next, history: rows.slice(-8) };
}

export function all() {
  return Object.keys(EX).map(exercise).filter(Boolean).sort((a, b) => b.last.localeCompare(a.last) || b.sessions - a.sessions);
}

/** Reps by movement pattern over the last `days` days. */
export function balance(days = 14, end = today()) {
  const from = addDays(end, -days + 1), out = { push: 0, pull: 0, legs: 0, core: 0 };
  for (const w of workouts().filter(w => w.date >= from && w.date <= end)) for (const st of w.sets) out[EX[st.exercise][6]] += st.reps || 0;
  return out;
}

/** Hard sets per muscle from CaliCoach workouts in the last 7 days (a set of 3+ reps or a 20 s hold; secondary muscles count half). */
export function setsThisWeek(end = today()) {
  const from = addDays(end, -6), sets = {};
  for (const w of workouts().filter(w => w.date >= from && w.date <= end)) for (const st of w.sets) {
    if ((st.kind === 'hold' ? (st.hold || 0) < 20 : st.reps < 3)) continue;
    const [, main, side] = EX[st.exercise];
    for (const m of main) sets[m] = (sets[m] || 0) + 1;
    for (const m of side) sets[m] = (sets[m] || 0) + 0.5;
  }
  return sets;
}
/** CaliCoach exercises from the last 7 days that work a muscle. */
export function exercisesFor(muscle, end = today()) {
  const from = addDays(end, -6), seen = new Set();
  for (const w of workouts().filter(w => w.date >= from && w.date <= end)) for (const st of w.sets) if (EX[st.exercise][1].includes(muscle) || EX[st.exercise][2].includes(muscle)) seen.add(EX[st.exercise][0]);
  return [...seen];
}

// ------------------------------------------------------------ for the assistant
export function forAI() {
  const st = status();
  if (!has()) return { connected: serverSet() && signedIn(), workouts: 0, note: st?.error || 'No CaliCoach workouts yet. CaliCoach is the camera form coach: ' + APP_URL };
  const ws = workouts();
  const last = ws[ws.length - 1];
  const b14 = balance(14);
  return {
    source: st?.from || [], lastChecked: st?.at || null,
    workouts: ws.length, firstWorkout: ws[0].date, lastWorkout: last.date,
    workoutsLast28Days: ws.filter(w => w.date > addDays(today(), -28)).length,
    lastWorkoutSets: last.sets.map(x => ({ exercise: exName(x.exercise), reps: x.reps, clean: x.clean, formScore: x.score, hold_s: x.hold, faults: Object.fromEntries(Object.entries(x.faults || {}).map(([k, v]) => [FAULTS[k]?.[0] || k, v])) })),
    exercises: all().map(e => ({ ...e, history: e.history.map(h => ({ date: h.date, sets: h.sets, reps: h.reps, clean: h.clean, bestSet: h.bestSet, formScore: h.score })) })),
    repsByPattern14Days: b14,
    hardSetsPerMuscleThisWeek: setsThisWeek(),
    note: 'From CaliCoach, the camera form coach: reps are counted from video and each rep is scored 0-100 against coaching standards (depth, lockout, body line, tempo...). A clean rep has no major fault. Use this to explain progress, name the one fault to fix first, and plan the next sessions with sets, reps and the variation; keep the body plan (body_status) and recovery in mind. Plans: 2-3 calisthenics sessions a week per movement, every muscle about 10+ hard sets a week, balance pushing and pulling.',
  };
}
