// Body (v56, plan and training since v57): Mustafa's weight, height and training, an athletic target weight,
// what each logged day of eating does to the body, and where a month of eating
// like this leads. Every number here is an estimate from standard formulas; the
// screen says so, and real weigh-ins are what keep it honest.
//
// The formulas:
// - Energy burned (TDEE): Mifflin-St Jeor resting rate × an activity factor.
// - Body fat: measured if given; otherwise from the waist (Relative Fat Mass,
//   Woolcott 2018: 64 − 20 × height / waist for men, 76 for women), otherwise
//   from BMI and age (Deurenberg 1991), which is the roughest.
// - Athletic target: a fat-free mass index (lean kg / height² m) of 22 for men
//   (18.5 for women), athletic and reachable without drugs, at 12% body fat
//   (20% for women); the range is FFMI 21 to 23.
// - A day's effect: a surplus first builds muscle up to what training allows
//   (beginners about 0.9 kg a month for men, half for women, less with each year
//   of training, scaled down when protein is under 1.6 g per kg), at about
//   2,800 kcal per kg of muscle; the rest is stored as fat at 7,700 kcal per kg.
//   A deficit burns fat; with enough protein and training some muscle is still
//   built, otherwise about a quarter of the weight lost is lean tissue.
//
// v67: one Body section. A body record (the 'weighins' store, one per date) now
// also holds tape measurements and performance tests; the morning readiness check
// (sleep, resting pulse, soreness, energy, stress) sits on the day's record in
// 'checkins'; finished sessions in 'workouts' carry how hard they were (RPE 1-10)
// and minutes. What is tracked follows what strength coaches for gymnasts,
// Olympic lifters and fighters monitor: body mass trend, girths and waist rather
// than BMI, a short test battery (strength, power, speed, core, flexibility),
// a Hooper-style wellness check with resting heart rate, and session-RPE load.
import * as db from './db.js';
import * as D from './data.js';
import { today, addDays } from './util.js';
import * as T from './training.js';

export const ACTIVITY = [['low', 'Mostly sitting', 1.2], ['light', 'On my feet a bit, walk daily', 1.375], ['moderate', 'Active job or sport 3-5 days', 1.55], ['high', 'Hard training most days', 1.725]];
export const EXPERIENCE = [['new', 'New to lifting (under 1 year)', 1], ['some', '1 to 3 years', 0.5], ['long', 'More than 3 years', 0.25]];
const FAT_KCAL = 7700, MUSCLE_KCAL = 2800, LEAN_LOSS_KCAL = 1800;

const r1 = n => Math.round(n * 10) / 10;
// Every body record (weight, measurements and tests can each be missing), oldest first.
export const records = () => db.all('weighins').sort((a, b) => a.date.localeCompare(b.date));
// Records with a weight.
export const weighins = () => records().filter(w => Number(w.kg) > 0);
export const latest = () => weighins().at(-1) || null;

export async function logWeight({ kg, date = today(), waist, fat }) {
  kg = Number(kg);
  if (!(kg > 25 && kg < 350)) throw new Error('Weight should be in kilograms, between 25 and 350.');
  const same = db.all('weighins').find(w => w.date === date);
  const row = { ...(same || {}), date, kg: r1(kg), ...(waist ? { waist: r1(Number(waist)) } : {}), ...(fat ? { fat: r1(Number(fat)) } : {}) };
  return db.put('weighins', row);
}

// Everything known about the body, or null until height and a weight are in.
export function profile() {
  const w = latest();
  const height = Number(db.setting('bodyHeight', 0));
  if (!w || !height) return null;
  const sex = db.setting('bodySex', 'm');
  const male = sex !== 'f';
  const age = Math.max(16, new Date().getFullYear() - Number(db.setting('bodyBirth', 0) || new Date().getFullYear() - 30));
  const kg = w.kg, m = height / 100;
  const bmi = kg / (m * m);
  // The newest waist and measured body fat, from any weigh-in.
  const newest = k => records().filter(x => Number(x[k]) > 0).at(-1)?.[k] || 0;
  const waist = newest('waist');
  const { bodyFat, fatFrom } = fatOf({ kg, fat: newest('fat'), waist, neck: newest('neck'), hips: newest('hips') }, height, male, age);
  const lean = kg * (1 - bodyFat / 100);
  // Day to day plus the training plan (4 sessions a week by default): "moderate" unless set.
  const activity = ACTIVITY.find(a => a[0] === db.setting('bodyActivity', 'moderate')) || ACTIVITY[2];
  const bmr = 10 * kg + 6.25 * height - 5 * age + (male ? 5 : -161);
  // Strength sessions a week: what was actually logged in the last two weeks, else the plan.
  const logged = T.recentPerWeek();
  const training = logged ?? T.daysAWeek();
  const exp = EXPERIENCE.find(e => e[0] === db.setting('bodyExperience', 'new')) || EXPERIENCE[0];
  // Muscle a month at best, from training sessions a week and years of training.
  const muscleCap = (male ? 0.9 : 0.45) * exp[2] * Math.min(1, training / 3);
  return {
    kg, height, sex, male, age, bmi: r1(bmi), bodyFat: r1(bodyFat), fatFrom, waist, lean: r1(lean), fatKg: r1(kg - lean),
    ffmi: r1(lean / (m * m)), bmr: Math.round(bmr), tdee: Math.round(bmr * activity[2]), activity: activity[0], training, trainingFrom: logged == null ? 'plan' : 'logged', experience: exp[0], muscleCap,
    weighedOn: w.date,
  };
}

// Body fat %, the best way the data allows: measured (scan, calipers) > US Navy tape
// formula (neck and waist, plus hips for women; Hodgdon and Beckett 1984) > Relative
// Fat Mass from the waist (Woolcott 2018) > BMI and age (Deurenberg 1991).
export function fatOf(r, height, male, age) {
  const log = Math.log10;
  let bodyFat, fatFrom;
  if (r.fat > 0) { bodyFat = Number(r.fat); fatFrom = 'measured'; }
  else if (r.waist > 0 && r.neck > 0 && r.waist > r.neck && (male || r.hips > 0)) {
    bodyFat = male ? 495 / (1.0324 - 0.19077 * log(r.waist - r.neck) + 0.15456 * log(height)) - 450
      : 495 / (1.29579 - 0.35004 * log(Number(r.waist) + Number(r.hips) - r.neck) + 0.221 * log(height)) - 450;
    fatFrom = 'tape';
  } else if (r.waist > 0) { bodyFat = (male ? 64 : 76) - 20 * (height / r.waist); fatFrom = 'waist'; }
  else if (r.kg > 0) { const bmi = r.kg / (height / 100) ** 2; bodyFat = 1.2 * bmi + 0.23 * age - 10.8 * (male ? 1 : 0) - 5.4; fatFrom = 'BMI'; }
  else return { bodyFat: 0, fatFrom: '' };
  return { bodyFat: r1(Math.min(50, Math.max(male ? 5 : 10, bodyFat))), fatFrom };
}

// The athletic target weight and what it takes to get there.
export function target(p = profile()) {
  if (!p) return null;
  const m = p.height / 100, h2 = m * m;
  const ffmi = p.male ? 22 : 18.5, bf = p.male ? 12 : 20;
  const at = f => r1((f * h2) / (1 - bf / 100));
  // Lean mass at the target: never below what he already has.
  const lean = Math.max(p.lean, ffmi * h2);
  const kg = r1(lean / (1 - bf / 100));
  const muscle = r1(Math.max(0, lean - p.lean));
  const fatToLose = r1(Math.max(0, p.fatKg - kg * bf / 100));
  // The plan: cut first if clearly over the target fat, otherwise a lean gain.
  const cut = p.bodyFat > bf + 4;
  // Diet for the goal: a moderate deficit to lose fat first (keeps strength and
  // muscle), otherwise a small surplus of about 10% for a lean gain. Protein 2.2 g/kg
  // while cutting, 1.8 g/kg while gaining (Morton 2018: gains plateau near 1.6,
  // up to 2.2; more helps hold muscle in a deficit). Fat 25% of calories (ACSM:
  // 20-35%), the rest carbohydrate, which fuels sprint and power work.
  const calories = Math.round((p.tdee + (cut ? -450 : Math.min(300, p.tdee * 0.1))) / 10) * 10;
  const protein = Math.round(p.kg * (cut ? 2.2 : 1.8) / 5) * 5;
  const fat = Math.round((calories * 0.25) / 9 / 5) * 5;
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4 / 5) * 5);
  const monthlyFat = cut ? (450 * 30) / FAT_KCAL : 0;
  // Time to the target if the plan is followed: the fat-loss phase (some muscle still
  // comes with high protein and lifting), then the lean gain at the plan's best rate.
  const exp = EXPERIENCE.find(e => e[0] === p.experience) || EXPERIENCE[0];
  const monthlyMuscle = Math.max(0.05, (p.male ? 0.9 : 0.45) * exp[2] * Math.min(1, T.daysAWeek() / 3));
  const cutMonths = cut ? fatToLose / Math.max(0.1, monthlyFat) : 0;
  const months = Math.ceil(cutMonths + Math.max(0, muscle - cutMonths * monthlyMuscle * 0.4) / monthlyMuscle);
  return { kg, low: at(ffmi - 1), high: at(ffmi + 1), bodyFat: bf, ffmi, lean: r1(lean), muscle, fatToLose, mode: cut ? 'cut' : 'gain', calories, protein, fat, carbs, months: Math.min(months, 60) };
}

// What one day of eating did: energy balance, then fat and muscle in grams.
export function effect(kcal, protein, p) {
  const balance = kcal - p.tdee;
  const capDay = p.muscleCap / 30;
  const proteinOK = Math.min(1, protein / (1.6 * p.kg));
  const capped = capDay * proteinOK;
  let muscle, fat;
  if (balance >= 0) {
    muscle = Math.min(capped, balance / MUSCLE_KCAL);
    fat = (balance - muscle * MUSCLE_KCAL) / FAT_KCAL;
  } else if (proteinOK >= 0.9 && p.training >= 2) {
    // Recomposition: some muscle still comes, paid for from fat stores.
    muscle = capped * 0.4;
    fat = (balance - muscle * MUSCLE_KCAL) / FAT_KCAL;
  } else {
    const loss = -balance / (0.75 * FAT_KCAL + 0.25 * LEAN_LOSS_KCAL);
    fat = -0.75 * loss; muscle = -0.25 * loss * (1 - proteinOK * 0.6);
  }
  return { balance: Math.round(balance), fat: fat * 1000, muscle: muscle * 1000 }; // grams
}

// Day by day for the last n days. A day counts only when meals are logged and
// it reaches 40% of the burn (a nearly empty day is more likely unlogged than eaten).
export function days(n = 30, end = today(), p = profile()) {
  if (!p) return [];
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(end, -i);
    const d = D.dietDay(date);
    const logged = d.meals.length > 0;
    const counted = logged && d.calories >= p.tdee * 0.4;
    out.push({ date, logged, counted, calories: Math.round(d.calories), protein: Math.round(d.protein), ...(counted ? effect(d.calories, d.protein, p) : { balance: 0, fat: 0, muscle: 0 }) });
  }
  return out;
}

const sumUp = list => {
  const c = list.filter(d => d.counted);
  return { days: c.length, balance: c.reduce((a, d) => a + d.balance, 0), fat: c.reduce((a, d) => a + d.fat, 0), muscle: c.reduce((a, d) => a + d.muscle, 0) };
};

// Today, the last 7 and 30 days, and a projection of the next 30 and 90 days if
// the average of the counted days in the last 14 carries on.
export function status() {
  const p = profile();
  if (!p) return null;
  const month = days(30, today(), p);
  const week = month.slice(-7);
  const t = month.at(-1);
  const basis = month.slice(-14).filter(d => d.counted);
  let projection = null;
  if (basis.length >= 3) {
    const kcal = basis.reduce((a, d) => a + d.calories, 0) / basis.length;
    const protein = basis.reduce((a, d) => a + d.protein, 0) / basis.length;
    const e = effect(kcal, protein, p);
    const ahead = n => ({ days: n, fat: r1((e.fat * n) / 1000), muscle: r1((e.muscle * n) / 1000), kg: r1(p.kg + ((e.fat + e.muscle) * n) / 1000) });
    projection = { from: basis.length, kcal: Math.round(kcal), protein: Math.round(protein), balance: e.balance, month: ahead(30), quarter: ahead(90) };
  }
  return { profile: p, target: target(p), today: t, week: { ...sumUp(week), list: week }, month: sumUp(month), projection };
}

// For the assistant.
export function forAI() {
  const s = status();
  if (!s) return { missing: 'No body profile yet. Ask for height (cm) and weight (kg), or point to the Body tab (bottom right).' };
  const a = analysis();
  const g = x => `${Math.round(x)} g`;
  return {
    profile: { ...s.profile, muscleCap: `${r1(s.profile.muscleCap)} kg muscle a month at best` },
    target: s.target,
    today: s.today.counted ? `${s.today.balance > 0 ? '+' : ''}${s.today.balance} kcal vs burn: fat ${g(s.today.fat)}, muscle ${g(s.today.muscle)}` : 'not enough logged today',
    week: `${s.week.days} counted days: balance ${s.week.balance} kcal, fat ${g(s.week.fat)}, muscle ${g(s.week.muscle)}`,
    month: `${s.month.days} counted days: balance ${s.month.balance} kcal, fat ${g(s.month.fat)}, muscle ${g(s.month.muscle)}`,
    projection: s.projection,
    goal: 'Athletic: muscular, strong, fast and flexible',
    training: { daysAWeek: T.daysAWeek(), today: T.sessionOn()?.name || 'rest and mobility', doneLast14Days: T.workouts().filter(w => w.date >= addDays(today(), -13)).length, setsThisWeek: T.setsThisWeek() },
    weighins: weighins().slice(-10).map(w => `${w.date}: ${w.kg} kg${w.waist ? `, waist ${w.waist} cm` : ''}${w.fat ? `, ${w.fat}% fat` : ''}`),
    weightTrend: a.trend ? `${a.trend.kgWeek} kg a week (${a.trend.pctWeek}% of body weight) over ${a.trend.n} weigh-ins since ${a.trend.from}: ${a.pace}` : 'not enough weigh-ins (3+ over 10+ days)',
    composition: a.composition ? `${a.composition.from} to ${a.composition.to}: weight ${a.composition.kg} kg, fat ${a.composition.fat} kg, lean ${a.composition.lean} kg` : null,
    waistToHeight: a.waistHeight,
    measurementsCm: Object.fromEntries(a.measurements.map(m => [m.label, `${m.value}${m.change != null ? ` (${m.change > 0 ? '+' : ''}${m.change} since ${m.since})` : ''}`])),
    tests: a.tests.map(x => `${x.label}: ${x.value} ${x.unit} on ${x.date} (target ${x.target}${x.change != null ? `, change ${x.change > 0 ? '+' : ''}${x.change}` : ''})`),
    readinessToday: a.readiness ? `${a.readiness.score}/100, ${a.readiness.call}: ${a.readiness.advice}${a.readiness.up != null ? ` Resting pulse ${a.readiness.rhr} vs baseline ${a.readiness.base}.` : ''}` : 'no morning check today',
    recovery7Days: a.recovery,
    trainingLoad: { last4WeeksAU: a.load.weeks.map(w => w.load), acuteChronicRatio: a.load.ratio, zone: a.load.zone, note: 'session RPE × minutes; 0.8-1.3 steady, over 1.5 a spike' },
    note: 'Estimates from standard formulas (Mifflin-St Jeor; measured, US Navy tape, RFM or Deurenberg body fat; FFMI target). Real weigh-ins over weeks are the check. Not medical advice.',
  };
}

// ---------- v67: measurements, tests, readiness, load and trends ----------

// Tape sites, in cm. Measured in the morning before eating, relaxed, tape level
// and snug (ISAK-style girths); the flexed arm is the one exception.
export const SITES = [
  ['neck', 'Neck', 'Just below the Adam’s apple'],
  ['chest', 'Chest', 'Across the nipples, after a normal breath out'],
  ['arm', 'Arm, flexed', 'Biggest point of the flexed upper arm'],
  ['waist', 'Waist', 'At the navel, relaxed, after a breath out'],
  ['hips', 'Hips', 'Widest point of the buttocks'],
  ['thigh', 'Thigh', 'Just below the buttock crease'],
  ['calf', 'Calf', 'Widest point'],
];

// A short battery in the spirit of gymnastics, Olympic and combat-sport testing:
// relative strength, power, speed, core and flexibility. Targets are Yaver's
// "athletic" marks for a trained non-competing adult (male, female), not norms.
// [key, label, unit, higher is better, target m, target f, group, how]
export const TESTS = [
  ['pullups', 'Pull-ups', 'reps', true, 15, 6, 'Strength', 'Strict: from a dead hang, chin over the bar, no swing.'],
  ['pushups', 'Push-ups', 'reps', true, 40, 20, 'Strength', 'Body straight, chest to a fist off the floor, no rest at the top.'],
  ['dips', 'Dips', 'reps', true, 20, 8, 'Strength', 'Parallel bars, shoulders below the elbows, lock out at the top.'],
  ['hang', 'Dead hang', 's', true, 90, 60, 'Strength', 'Overhand grip, arms straight, until the grip goes.'],
  ['jump', 'Vertical jump', 'cm', true, 55, 40, 'Power', 'Countermovement jump: dip and jump, best of 3 (wall mark or a jump app).'],
  ['broad', 'Broad jump', 'cm', true, 250, 190, 'Power', 'Standing, two feet, best of 3, measured to the back heel.'],
  ['sprint20', '20 m sprint', 's', false, 3.1, 3.6, 'Speed', 'From a standing start, best of 2, full rest between.'],
  ['hollow', 'Hollow hold', 's', true, 60, 60, 'Core', 'Lower back pressed to the floor, arms overhead, legs low.'],
  ['lsit', 'L-sit', 's', true, 20, 15, 'Core', 'On the floor, parallettes or dip bars, legs straight and level.'],
  ['reach', 'Sit and reach', 'cm', true, 10, 15, 'Flexibility', 'Legs straight, reach past the toes (+) or short of them (−). Warm up first.'],
];
export const testDef = k => TESTS.find(t => t[0] === k);

// Save any mix of weight, measurements, body fat and tests on a date's record.
// Empty fields are left as they were; null removes one.
export async function logBody(fields, date = today()) {
  const have = db.all('weighins').find(w => w.date === date);
  const row = { ...(have || {}), date };
  let set = 0;
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v === undefined) continue;
    if (v === null) { delete row[k]; set++; continue; }
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (k === 'kg' && !(n > 25 && n < 350)) throw new Error('Weight should be in kilograms, between 25 and 350.');
    row[k] = Math.round(n * 100) / 100;
    set++;
  }
  if (!set) return null;
  return db.put('weighins', row);
}

// The newest value of a field and the one before it (from an earlier date).
export function lastTwo(key) {
  const list = records().filter(r => r[key] != null && r[key] !== '' && Number.isFinite(Number(r[key])));
  return { now: list.at(-1) || null, before: list.at(-2) || null, count: list.length };
}

export function measurements() {
  return SITES.map(([k, label, how]) => {
    const { now, before } = lastTwo(k);
    return { key: k, label, how, value: now ? Number(now[k]) : null, date: now?.date, change: now && before ? r1(now[k] - before[k]) : null, since: before?.date };
  });
}

export function tests(male = db.setting('bodySex', 'm') !== 'f') {
  return TESTS.map(([k, label, unit, up, tm, tf, group, how]) => {
    const list = records().filter(r => r[k] != null && Number.isFinite(Number(r[k])));
    const now = list.at(-1), before = list.at(-2);
    const target = male ? tm : tf;
    const v = now ? Number(now[k]) : null;
    const vals = list.map(r => Number(r[k]));
    const best = vals.length ? (up ? Math.max(...vals) : Math.min(...vals)) : null;
    // 0..1 of the way to the target (for times, the target over the time).
    const of = v == null ? 0 : up ? (k === 'reach' ? Math.max(0, Math.min(1, (v + 20) / (target + 20))) : Math.min(1, v / target)) : Math.min(1, target / v);
    const change = now && before ? r1(v - before[k]) : null;
    return { key: k, label, unit, up, group, how, target, value: v, date: now?.date, best, change, better: change == null || change === 0 ? null : (change > 0) === up, of, met: v != null && (up ? v >= target : v <= target) };
  });
}

// Weight trend from the weigh-ins of the last `days` days: a least-squares line,
// in kg and % of body weight a week, plus a 7-day average for the chart.
export function trend(days = 28, end = today()) {
  const from = addDays(end, -days);
  const list = weighins().filter(w => w.date >= from && w.date <= end);
  if (list.length < 3) return null;
  const t0 = new Date(list[0].date + 'T12:00').getTime();
  const xs = list.map(w => (new Date(w.date + 'T12:00').getTime() - t0) / 864e5), ys = list.map(w => Number(w.kg));
  const span = xs.at(-1);
  if (span < 10) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const week = slope * 7;
  return { from: list[0].date, n: list.length, kgWeek: Math.round(week * 100) / 100, pctWeek: Math.round((week / my) * 1000) / 10 };
}
// Is the pace right for the phase? Fat loss 0.5-1% of body weight a week keeps
// muscle (Helms 2014); a lean gain 0.25-0.5% a week (Iraki 2019).
export function pace(tr, mode) {
  if (!tr) return null;
  const p = tr.pctWeek;
  if (mode === 'cut') return p > 0.1 ? 'gaining while the plan is to lose fat' : p > -0.4 ? 'slower than the 0.5-1% a week fat-loss pace' : p >= -1.05 ? 'right pace for losing fat and keeping muscle' : 'faster than 1% a week: muscle is at risk';
  return p < -0.1 ? 'losing while the plan is a lean gain' : p < 0.2 ? 'about flat; a lean gain is 0.25-0.5% a week' : p <= 0.55 ? 'right pace for a lean gain' : 'faster than 0.5% a week: more of it is fat';
}

// Weight over time for the chart: each weigh-in and a 7-day rolling average.
export function series(days = 90, end = today()) {
  const from = addDays(end, -days);
  const list = weighins().filter(w => w.date >= from);
  return list.map(w => {
    const win = list.filter(x => x.date <= w.date && x.date > addDays(w.date, -7));
    return { date: w.date, kg: Number(w.kg), avg: r1(win.reduce((a, x) => a + Number(x.kg), 0) / win.length) };
  });
}

// Fat and lean change between the oldest and newest records with a waist (or
// measured fat) in the window: is the weight change fat or muscle?
export function composition(days = 90) {
  const p = profile();
  if (!p) return null;
  const from = addDays(today(), -days);
  const withFat = weighins().filter(w => w.date >= from && (w.fat > 0 || w.waist > 0)).map(w => {
    const f = fatOf({ kg: w.kg, fat: w.fat, waist: w.waist, neck: w.neck, hips: w.hips }, p.height, p.male, p.age);
    return { date: w.date, kg: Number(w.kg), bodyFat: f.bodyFat, fatFrom: f.fatFrom, fatKg: w.kg * f.bodyFat / 100, lean: w.kg * (1 - f.bodyFat / 100) };
  });
  if (withFat.length < 2) return null;
  const a = withFat[0], b = withFat.at(-1);
  if (a.date === b.date) return null;
  return { from: a.date, to: b.date, kg: r1(b.kg - a.kg), fat: r1(b.fatKg - a.fatKg), lean: r1(b.lean - a.lean), bodyFat: r1(b.bodyFat - a.bodyFat) };
}

// ---------- Morning readiness (on the day's check-in) ----------
// A Hooper-style wellness check (Hooper and Mackinnon 1995; McLean 2010), plus
// sleep hours and the resting pulse against your own 4-week baseline: a pulse
// 5+ beats over baseline is a common sign of fatigue, illness or poor recovery.
export const LEVELS = {
  sleepQ: ['Sleep quality', [['poor', 'Poor'], ['ok', 'OK'], ['good', 'Good']]],
  energy: ['Energy', [['low', 'Low'], ['ok', 'OK'], ['high', 'High']]],
  soreness: ['Muscle soreness', [['heavy', 'Heavy'], ['some', 'Some'], ['none', 'None']]],
  stress: ['Stress', [['high', 'High'], ['some', 'Some'], ['low', 'Low']]],
};
export const readinessOn = date => db.all('checkins').find(c => c.date === date) || null;
export async function logReadiness(fields, date = today()) {
  const have = readinessOn(date);
  const row = { ...(have || {}), date };
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v == null) continue;
    row[k] = ['sleep', 'rhr', 'hrv'].includes(k) ? Math.round(Number(v) * 10) / 10 : String(v);
  }
  return db.put('checkins', row);
}
export function baselineRHR(date = today()) {
  const list = db.all('checkins').filter(c => c.rhr > 0 && c.date < date && c.date >= addDays(date, -28));
  return list.length >= 4 ? r1(list.reduce((a, c) => a + Number(c.rhr), 0) / list.length) : null;
}
export function readiness(date = today()) {
  const c = readinessOn(date);
  if (!c || !(c.sleep || c.sleepQ || c.energy || c.soreness || c.stress || c.rhr)) return null;
  let got = 0, max = 0;
  for (const k of Object.keys(LEVELS)) if (c[k]) { max += 2; got += LEVELS[k][1].findIndex(x => x[0] === c[k]); }
  if (c.sleep) { max += 2; got += c.sleep >= 8 ? 2 : c.sleep >= 7 ? 1.5 : c.sleep >= 6 ? 0.75 : 0; }
  let score = max ? (got / max) * 100 : 70;
  const base = baselineRHR(date), up = base && c.rhr ? r1(c.rhr - base) : null;
  if (up != null && up >= 5) score -= 20; else if (up != null && up >= 3) score -= 8;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const call = score >= 75 ? 'ready' : score >= 50 ? 'normal' : 'easy';
  const advice = call === 'ready' ? 'Good day for the hard work: heavy lifts, jumps and sprints.' : call === 'normal' ? 'Train as planned; skip a set if the warm-up feels heavy.' : 'Go light today: technique, mobility and an easy walk or ride. Push tomorrow.';
  return { score, call, advice, sleep: c.sleep || null, rhr: c.rhr || null, base, up, entry: c };
}
// Average sleep and readiness over the last n days with a check.
export function recovery(n = 7, end = today()) {
  const list = db.all('checkins').filter(c => c.date > addDays(end, -n) && c.date <= end);
  const sleeps = list.filter(c => c.sleep > 0).map(c => Number(c.sleep));
  const scores = list.map(c => readiness(c.date)).filter(Boolean).map(r => r.score);
  return { days: list.length, sleep: sleeps.length ? r1(sleeps.reduce((a, b) => a + b, 0) / sleeps.length) : null, sleepDays: sleeps.length, score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null };
}

// ---------- Training load: session RPE × minutes (Foster 2001) ----------
// The acute (7-day) load against the chronic (28-day weekly average) load:
// 0.8-1.3 is the usual safe band; over 1.5 is a spike (Gabbett 2016).
export function load(end = today()) {
  const all = T.workouts();
  const sum = (from, to) => all.filter(w => w.date > from && w.date <= to).reduce((a, w) => a + (Number(w.rpe) || 7) * (Number(w.min) || 60), 0);
  const weeks = [3, 2, 1, 0].map(i => ({ end: addDays(end, -7 * i), load: sum(addDays(end, -7 * (i + 1)), addDays(end, -7 * i)), sessions: all.filter(w => w.date > addDays(end, -7 * (i + 1)) && w.date <= addDays(end, -7 * i)).length }));
  const acute = weeks[3].load, chronic = weeks.reduce((a, w) => a + w.load, 0) / 4;
  const first = all[0]?.date;
  const enough = first && first <= addDays(end, -21);
  const ratio = enough && chronic ? Math.round((acute / chronic) * 100) / 100 : null;
  const rated = all.filter(w => w.date > addDays(end, -28) && w.rpe).length;
  return { weeks, acute, chronic: Math.round(chronic), ratio, rated, zone: ratio == null ? null : ratio > 1.5 ? 'spike' : ratio > 1.3 ? 'high' : ratio < 0.8 ? 'low' : 'steady' };
}

// Everything above, for the assistant and the insights.
export function analysis() {
  const p = profile();
  const t = p && target(p);
  const tr = trend();
  return { trend: tr, pace: t ? pace(tr, t.mode) : null, composition: composition(), waistHeight: p && p.waist ? Math.round((p.waist / p.height) * 100) / 100 : null,
    measurements: measurements().filter(m => m.value != null), tests: tests(p ? p.male : true).filter(x => x.value != null), readiness: readiness(), recovery: recovery(), load: load() };
}
