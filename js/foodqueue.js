// Food in the background (v69). Mustafa found waiting on Gemini too slow, so a photo or
// a typed meal is handed in at once and the estimate runs in the background: the job is
// kept on this device (the device-only kv key foodQueue, with the photo), Diet shows it as
// "Estimating…", and when Gemini answers the meal is logged by itself with a toast and
// Edit. A job that fails stays in the list with Retry and Remove; a job cut off by closing
// the app is picked up again the next time Yaver opens.
import * as db from './db.js';
import * as D from './data.js';
import * as F from './foodscan.js';
import { toast, today } from './util.js';
import { mealForm } from './forms.js';

const KEY = 'foodQueue';
const running = new Set();
export const jobs = () => db.setting(KEY, []) || [];
const save = list => db.setSetting(KEY, list);
const patch = (id, change) => save(jobs().map(j => (j.id === id ? { ...j, ...change } : j)));
const guessMeal = t => { const h = Number(String(t || '').slice(0, 2)); return !t ? null : h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : h < 21 ? 'Dinner' : 'Snack'; };

// Hand in a meal to estimate. image: { media_type, data } or null; note: the words.
export async function add({ image = null, note = '', date = today(), time = '', meal = null }) {
  if (!image && !String(note).trim()) throw new Error('Write what you ate or drank first.');
  if (!time && date === today()) time = D.nowHM();
  const job = { id: `fq${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, note: String(note).trim(), image: image ? { media_type: image.media_type, data: image.data } : null, date, time, meal, status: 'working', at: Date.now() };
  await save([...jobs(), job]);
  run(job.id);
  return job;
}

export async function run(id) {
  if (running.has(id)) return;
  const job = jobs().find(j => j.id === id);
  if (!job) return;
  running.add(id);
  if (job.status !== 'working') await patch(id, { status: 'working', error: '' });
  try {
    const r = await F.scanFood(job.image, job.note);
    if (!r.items.length) throw new Error(job.image ? 'No food found in the photo.' : 'Could not tell what that was.');
    if (!jobs().some(j => j.id === id)) return; // removed while it ran
    const meal = job.meal || guessMeal(job.time) || (D.MEAL_TYPES.includes(r.meal) ? r.meal : 'Snack');
    const row = await D.logMeal({ ...F.mealRow({ dish: r.dish, items: r.items, meal, date: job.date, confidence: r.confidence, source: job.image ? 'photo' : 'typed', sources: r.sources }), time: job.time });
    await save(jobs().filter(j => j.id !== id));
    toast(`Logged ${row.name} · ${Math.round(row.calories)} kcal`, { action: { label: 'Edit', run: () => mealForm(db.get('meals', row.id) || row) } });
  } catch (e) {
    if (jobs().some(j => j.id === id)) await patch(id, { status: 'failed', error: e.message || 'Estimate failed' });
  } finally {
    running.delete(id);
  }
}

export const remove = id => save(jobs().filter(j => j.id !== id));

// On start: pick up jobs that were cut off when the app closed.
export function resume() {
  for (const j of jobs()) if (j.status === 'working') run(j.id);
}
