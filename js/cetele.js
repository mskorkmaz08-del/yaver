// Çetele: daily spiritual minimums (Quran pages, salawat, tahajjud, fasting…).
// Shared by the Çetele screen, Home, reminders and the AI tools.
// Items live in 'ceteleItems'; each day's count is one 'ceteleLog' row "<item>:<day>".
import * as db from './db.js';
import { today, addDays, weekStart } from './util.js';

// Starting list. Fixed ids, so two devices seeding at once merge instead of duplicating.
const DEFAULTS = [
  { id: 'namaz', name: 'Namaz', unit: 'vakit', target: 5, per: 'day', step: 1 },
  { id: 'quran', name: "Kur'an", unit: 'pages', target: 5, per: 'day', step: 1 },
  { id: 'book', name: 'Kitap', unit: 'pages', target: 20, per: 'day', step: 5 },
  { id: 'salawat', name: 'Salavat', unit: 'times', target: 100, per: 'day', step: 10 },
  { id: 'jawshan', name: 'Cevşen', unit: 'parts', target: 1, per: 'day', step: 1 },
  { id: 'tahajjud', name: 'Teheccüd', unit: '', target: 1, per: 'day', step: 1 },
  { id: 'fasting', name: 'Oruç', unit: 'days', target: 2, per: 'week', step: 1 },
];

export async function seed() {
  if (db.setting('ceteleSeeded', false) || db.all('ceteleItems').length) return;
  for (const [i, d] of DEFAULTS.entries()) await db.put('ceteleItems', { ...d, order: i, archived: false });
  await db.setSetting('ceteleSeeded', true);
}

export const items = () => db.all('ceteleItems').filter(i => !i.archived).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
export const isCheck = item => Number(item.target) === 1 && !item.unit;

export function find(nameOrId) {
  const q = String(nameOrId || '').trim().toLocaleLowerCase('tr');
  const list = items();
  return list.find(i => i.id === q) || list.find(i => i.name.toLocaleLowerCase('tr') === q)
    || list.find(i => i.name.toLocaleLowerCase('tr').includes(q) || q.includes(i.name.toLocaleLowerCase('tr')))
    || list.find(i => ALIASES[i.id]?.some(a => q.includes(a)));
}
// English and other spellings the AI or the user may use.
const ALIASES = {
  namaz: ['prayer', 'salah', 'salat ', 'namaz'], quran: ['quran', 'koran', 'kuran', 'qur'], book: ['book', 'risale', 'reading'],
  salawat: ['salawat', 'salavat', 'salat-i', 'durood'], jawshan: ['jawshan', 'jevshan', 'cevsen', 'cevşen'],
  tahajjud: ['tahajjud', 'teheccud', 'teheccüd', 'night prayer'], fasting: ['fast', 'oruc', 'oruç', 'sawm'],
};

export const valueOn = (id, day = today()) => db.get('ceteleLog', `${id}:${day}`)?.value || 0;

export function setValue(id, value, day = today()) {
  value = Math.max(0, Math.round(Number(value) || 0));
  const row = db.get('ceteleLog', `${id}:${day}`);
  return db.put('ceteleLog', { ...(row || { id: `${id}:${day}`, item: id, day }), value });
}
export const add = (id, n, day = today()) => setValue(id, valueOn(id, day) + Number(n || 0), day);

// For a weekly item, progress is the sum Monday..day.
export function progress(item, day = today()) {
  if (item.per !== 'week') return valueOn(item.id, day);
  let total = 0;
  for (let k = weekStart(day); k <= day; k = addDays(k, 1)) total += valueOn(item.id, k);
  return total;
}
export const met = (item, day = today()) => progress(item, day) >= Number(item.target || 1);

export function day(dayKey = today()) {
  const list = items();
  const rows = list.map(i => ({ ...i, value: valueOn(i.id, dayKey), progress: progress(i, dayKey), met: met(i, dayKey) }));
  const daily = rows.filter(r => r.per !== 'week');
  return { day: dayKey, rows, done: daily.filter(r => r.met).length, total: daily.length, complete: daily.length > 0 && daily.every(r => r.met) };
}

// A day counts when every daily minimum is met. Today counts only once it's complete.
export function streak() {
  const list = items().filter(i => i.per !== 'week');
  if (!list.length) return { current: 0, best: 0, perDay: {} };
  const full = k => list.every(i => valueOn(i.id, k) >= Number(i.target || 1));
  const perDay = {};
  for (let k = weekStart(); k <= today(); k = addDays(k, 1)) perDay[k] = full(k) ? 1 : list.some(i => valueOn(i.id, k) > 0) ? 0.5 : 0;
  let current = 0, k = full(today()) ? today() : addDays(today(), -1);
  while (current < 3650 && full(k)) { current++; k = addDays(k, -1); }
  const days = [...new Set(db.all('ceteleLog').map(r => r.day))].sort();
  let best = current, run = 0, prev = '';
  for (const d of days) { run = full(d) ? (prev && addDays(prev, 1) === d ? run + 1 : 1) : 0; if (full(d)) prev = d; best = Math.max(best, run); }
  return { current, best, perDay };
}

export async function saveItem({ id, name, unit = '', target = 1, per = 'day', step = 1 }) {
  if (!String(name || '').trim()) throw new Error('name is required');
  const old = id ? db.get('ceteleItems', id) : null;
  return db.put('ceteleItems', { ...(old || { order: items().length, archived: false }), ...(id ? { id } : {}), name: String(name).trim(), unit: String(unit || '').trim(), target: Math.max(1, Number(target) || 1), per: per === 'week' ? 'week' : 'day', step: Math.max(1, Number(step) || 1) });
}
// Archived, not deleted: past days keep their history.
export const archiveItem = id => { const i = db.get('ceteleItems', id); return i && db.put('ceteleItems', { ...i, archived: true }); };
export async function move(id, dir) {
  const list = items();
  const i = list.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (const [k, it] of list.entries()) if (it.order !== k) await db.put('ceteleItems', { ...it, order: k });
}

// Short summary for the AI and reminders.
export function summary(dayKey = today()) {
  const d = day(dayKey);
  const s = streak();
  return {
    day: d.day, done: `${d.done}/${d.total} daily minimums met`, streakDays: s.current, bestStreak: s.best,
    items: d.rows.map(r => ({ id: r.id, name: r.name, target: `${r.target}${r.unit ? ' ' + r.unit : ''} per ${r.per}`, done: r.progress, met: r.met })),
  };
}
