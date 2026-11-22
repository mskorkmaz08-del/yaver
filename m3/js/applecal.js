// Apple Calendar in Yaver: the Mac bridge reads the Mac's Calendar app (every
// account added there: iCloud, Google, work) and Yaver keeps a read-only copy
// in the device-only 'applecal' store. Meet, free slots, Home and the assistant
// then see those events next to Yaver's own meetings. Nothing is written back.
import * as db from './db.js';
import { macOnline, macConfigured } from './ai/mac.js';

const PAST = 7, AHEAD = 60;           // days of events to keep
const EVERY = 10 * 60000;             // refresh at most this often by itself
let running = null, lastTry = 0;

export const enabled = () => db.setting('appleCal', true) !== false;
export const status = () => db.setting('appleCalStatus', null);

// Turns bridge events into rows for the store. Ids are stable per occurrence.
export function toRows(events) {
  return (events || []).filter(e => e && e.start).map(e => ({
    id: 'apple:' + String(e.uid || `${e.title}@${e.start}`),
    source: 'apple',
    title: String(e.title || '(No title)'),
    start: new Date(e.start).toISOString(),
    end: new Date(e.end || e.start).toISOString(),
    allDay: !!e.allDay,
    location: String(e.location || ''),
    notes: String(e.notes || ''),
    calendar: String(e.calendar || ''),
    color: /^#[0-9a-f]{6}$/i.test(e.color || '') ? e.color : '',
  }));
}

async function setStatus(s) { await db.setSetting('appleCalStatus', { ...s, at: new Date().toISOString() }); }

// force: the person tapped Sync, so try even if we synced a moment ago.
export function syncAppleCalendar({ force = false } = {}) {
  if (!enabled()) return Promise.resolve(false);
  const last = status();
  if (!force && last?.ok && Date.now() - new Date(last.at) < EVERY) return Promise.resolve(false);
  // After a failed try, wait a little before trying again by itself.
  if (!force && Date.now() - lastTry < 2 * 60000) return Promise.resolve(false);
  lastTry = Date.now();
  return (running ||= run(force).finally(() => { running = null; }));
}

async function run(force) {
  // Without a bridge set up, don't go looking for one by itself (the laptop
  // already checks for a local bridge when Yaver starts).
  if (!force && !macConfigured()) return false;
  if (!(await macOnline(force))) {
    if (force || !status()) await setStatus({ ok: false, error: macConfigured() ? 'Your Mac is not reachable right now. Showing the last copy.' : 'Connect Claude on your Mac first (Settings → Claude on your Mac).' });
    return false;
  }
  const base = db.setting('macUrl', '').trim().replace(/\/+$/, '');
  const now = Date.now();
  let res, out;
  try {
    res = await fetch(`${base}/calendar?from=${now - PAST * 86400e3}&to=${now + AHEAD * 86400e3}`, {
      headers: { Authorization: `Bearer ${db.setting('macToken', '').trim()}` },
      signal: AbortSignal.timeout(100000),
    });
    out = await res.json().catch(() => ({}));
  } catch {
    await setStatus({ ok: false, error: 'Lost the connection to your Mac. Showing the last copy.' });
    return false;
  }
  if (res.status === 404) { await setStatus({ ok: false, old: true, error: 'The bridge on your Mac is an older version. Run the setup line on the Mac once more to update it.' }); return false; }
  if (!res.ok) { await setStatus({ ok: false, error: out.error || `The bridge answered ${res.status}.` }); return false; }
  const rows = toRows(out.events);
  await db.replaceLocal('applecal', rows);
  await setStatus({ ok: true, count: rows.length, calendars: (out.calendars || []).length });
  return true;
}
