// Food diary (v54): everything logged in Diet, looked at over time. Meals live in
// the synced 'meals' store, so they survive app updates and move between devices;
// this module adds them up per day, compares the averages with Mustafa's goals and
// the daily values, and flags what has been running low. Vitamins and minerals only
// come from photo or typed meals, so they are averaged over the days that have them.
import * as db from './db.js';
import * as D from './data.js';
import { today, addDays } from './util.js';
import { MICROS, FATS, DAILY } from './foodscan.js';

const r1 = n => Math.round((Number(n) || 0) * 10) / 10;

// Meal timing (v59). Times are "HH:MM"; a meal from 21:00 on counts as late.
export const LATE = '21:00';
const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hm = n => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(Math.round(n % 60)).padStart(2, '0')}`;
export function timing(meals) {
  const timed = meals.map(m => ({ m, t: D.mealTime(m)?.time })).filter(x => x.t).sort((a, b) => a.t.localeCompare(b.t));
  if (!timed.length) return null;
  const kcal = meals.reduce((a, m) => a + (Number(m.calories) || 0), 0);
  const late = timed.filter(x => x.t >= LATE).reduce((a, x) => a + (Number(x.m.calories) || 0), 0);
  const first = timed[0].t, last = timed.at(-1).t;
  return { first, last, window: r1((mins(last) - mins(first)) / 60), lateKcal: Math.round(late), latePct: kcal ? Math.round((late / kcal) * 100) : 0,
    // A late day: a third of the day's food from 21:00, or 400+ kcal after 22:00.
    late: (kcal && late / kcal >= 0.33) || timed.filter(x => x.t >= '22:00').reduce((a, x) => a + (Number(x.m.calories) || 0), 0) >= 400 };
}

// How Mustafa felt (v59): one check-in a day, good / ok / bad, with an optional note.
export const FEELS = [['good', 'Good'], ['ok', 'OK'], ['bad', 'Bad']];
export const feelOn = date => db.all('checkins').find(c => c.date === date) || null;
export async function setFeel(date, feel, note) {
  const have = feelOn(date);
  if (have && have.feel === feel && note == null) return db.remove('checkins', have.id);
  return db.put('checkins', { ...(have || {}), date, feel, ...(note != null ? { note } : {}) });
}

export function days(n = 30, end = today()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = addDays(end, -i);
    const d = D.dietDay(k);
    out.push({ date: k, timing: timing(d.meals), feel: feelOn(k)?.feel || null, nextFeel: feelOn(addDays(k, 1))?.feel || null, meals: d.meals.length, detailed: d.detailed, fatDetailed: d.meals.filter(m => m.micros && m.micros.satFat != null).length, calories: d.calories, protein: d.protein, carbs: d.carbs, fat: d.fat, fiber: d.fiber, sugar: d.sugar, sodium: d.sodium, micros: d.micros });
  }
  return out;
}

// Averages over logged days, % of goal / daily value, and what is low or high.
export function report(n = 30, end = today()) {
  const all = days(n, end);
  const logged = all.filter(d => d.meals);
  const detailed = logged.filter(d => d.detailed);
  const fatDays = logged.filter(d => d.fatDetailed);
  const g = D.goals();
  const avg = (list, f) => (list.length ? list.reduce((a, d) => a + (Number(f(d)) || 0), 0) / list.length : 0);
  const pct = (v, ref) => (ref ? Math.round((v / ref) * 100) : null);
  const nutrients = [
    { key: 'calories', label: 'Calories', unit: 'kcal', avg: avg(logged, d => d.calories), ref: g.dailyCalories, kind: 'goal' },
    { key: 'protein', label: 'Protein', unit: 'g', avg: avg(logged, d => d.protein), ref: g.dailyProtein, kind: 'goal' },
    { key: 'fiber', label: 'Fiber', unit: 'g', avg: avg(detailed, d => d.fiber), ref: DAILY.fiber, kind: 'min', partial: true },
    { key: 'sugar', label: 'Sugar', unit: 'g', avg: avg(detailed, d => d.sugar), ref: DAILY.sugar, kind: 'max', partial: true },
    { key: 'sodium', label: 'Sodium', unit: 'mg', avg: avg(detailed, d => d.sodium), ref: DAILY.sodium, kind: 'max', partial: true },
    // Fat quality (v55): saturated is a limit, omega-3 a target. Only meals logged since v55 carry them.
    ...FATS.filter(([, , , ref]) => ref).map(([key, label, unit, ref]) => ({ key, label, unit, avg: avg(fatDays, d => d.micros[key]), ref, kind: key === 'satFat' ? 'max' : 'min', partial: 'fat' })),
    ...MICROS.map(([key, label, unit, ref]) => ({ key, label, unit, avg: avg(detailed, d => d.micros[key]), ref, kind: key === 'caffeine' ? 'max' : 'min', partial: true })),
  ].map(x => ({ ...x, avg: r1(x.avg), pct: pct(x.avg, x.ref) }));
  const usable = x => (x.partial === 'fat' ? fatDays.length : x.partial ? detailed.length : logged.length) > 0;
  const low = nutrients.filter(x => usable(x) && x.kind !== 'max' && x.pct !== null && x.pct < 70).sort((a, b) => a.pct - b.pct);
  const high = nutrients.filter(x => usable(x) && x.kind === 'max' && x.pct > 100).sort((a, b) => b.pct - a.pct);
  return {
    days: n, from: all[0].date, to: end,
    loggedDays: logged.length, detailedDays: detailed.length,
    nutrients: nutrients.filter(usable), low, high,
    lowCalorieDays: logged.filter(d => g.dailyCalories && d.calories < g.dailyCalories * 0.7).map(d => d.date),
    lowProteinDays: logged.filter(d => g.dailyProtein && d.protein < g.dailyProtein * 0.7).map(d => d.date),
    missedDays: all.filter(d => !d.meals).map(d => d.date),
    timing: timingReport(logged),
  };
}

// Eating window, late days, and how the next morning felt after late and other days.
function timingReport(logged) {
  const t = logged.filter(d => d.timing);
  if (!t.length) return null;
  const avg = f => t.reduce((a, d) => a + f(d), 0) / t.length;
  const late = t.filter(d => d.timing.late), other = t.filter(d => !d.timing.late);
  const after = list => { const f = list.filter(d => d.nextFeel); return { days: f.length, bad: f.filter(d => d.nextFeel === 'bad').length, good: f.filter(d => d.nextFeel === 'good').length }; };
  return {
    days: t.length, first: hm(avg(d => mins(d.timing.first))), last: hm(avg(d => mins(d.timing.last))), window: r1(avg(d => d.timing.window)),
    lateDays: late.map(d => d.date), afterLate: after(late), afterOther: after(other),
  };
}

// For the assistant: the report plus a compact line per logged day.
export function forAI(n = 30) {
  const r = report(n);
  return {
    ...r,
    nutrients: r.nutrients.map(x => `${x.label}: avg ${x.avg}${x.unit}${x.pct !== null ? ` (${x.pct}% of ${x.kind === 'goal' ? 'goal' : x.kind === 'max' ? 'limit' : 'daily value'})` : ''}`),
    low: r.low.map(x => `${x.label} ${x.pct}%`), high: r.high.map(x => `${x.label} ${x.pct}%`),
    perDay: days(n).filter(d => d.meals || d.feel).map(d => `${d.date}: ${Math.round(d.calories)} kcal, P${Math.round(d.protein)}, ${d.meals} meals${d.detailed ? '' : ' (no vitamin data)'}${d.timing ? `, eaten ${d.timing.first}-${d.timing.last}, ${d.timing.latePct}% of calories from ${LATE}${d.timing.late ? ' (late day)' : ''}` : ''}${d.feel ? `, felt ${d.feel}` : ''}${d.nextFeel ? `, next morning ${d.nextFeel}` : ''}`),
    meals: db.all('meals').filter(m => m.date >= r.from).sort((a, b) => (a.date + (D.mealTime(a)?.time || '')).localeCompare(b.date + (D.mealTime(b)?.time || ''))).map(m => `${m.date} ${D.mealTime(m)?.time || '--:--'}${D.mealTime(m)?.approx ? '~' : ''} ${m.meal}: ${m.name} (${m.calories} kcal)`).slice(-120),
    feelings: db.all('checkins').filter(c => c.date >= r.from).sort((a, b) => a.date.localeCompare(b.date)).map(c => `${c.date}: ${c.feel}${c.note ? ` (${c.note})` : ''}`),
    note: 'Times with ~ are when the meal was logged, not eaten (older entries). Feelings are one check-in a day. Estimates from photos and descriptions. Vitamins and minerals only from photo or typed meals (detailedDays). Not a medical diagnosis.',
  };
}

// The whole diary as a spreadsheet, one row per meal.
export function csv() {
  const cols = ['date', 'time', 'meal', 'name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg', ...FATS.map(([k]) => `${k}_g`), ...MICROS.map(([k, , u]) => `${k}_${u === 'µg' ? 'ug' : u}`), 'items', 'source'];
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = db.all('meals').sort((a, b) => (a.date + D.MEAL_TYPES.indexOf(a.meal)).localeCompare(b.date + D.MEAL_TYPES.indexOf(b.meal))).map(m => [
    m.date, m.time || '', m.meal, m.name, m.calories, m.protein, m.carbs, m.fat, m.fiber ?? '', m.sugar ?? '', m.sodium ?? '',
    ...FATS.map(([k]) => m.micros?.[k] ?? ''), ...MICROS.map(([k]) => m.micros?.[k] ?? ''), (m.items || []).map(i => `${i.name} ${i.grams}g`).join('; '), m.source || 'manual',
  ].map(q).join(','));
  return [cols.join(','), ...rows].join('\n');
}
