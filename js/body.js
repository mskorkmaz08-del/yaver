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
import * as db from './db.js';
import * as D from './data.js';
import { today, addDays } from './util.js';
import * as T from './training.js';

export const ACTIVITY = [['low', 'Mostly sitting', 1.2], ['light', 'On my feet a bit, walk daily', 1.375], ['moderate', 'Active job or sport 3-5 days', 1.55], ['high', 'Hard training most days', 1.725]];
export const EXPERIENCE = [['new', 'New to lifting (under 1 year)', 1], ['some', '1 to 3 years', 0.5], ['long', 'More than 3 years', 0.25]];
const FAT_KCAL = 7700, MUSCLE_KCAL = 2800, LEAN_LOSS_KCAL = 1800;

const r1 = n => Math.round(n * 10) / 10;
export const weighins = () => db.all('weighins').sort((a, b) => a.date.localeCompare(b.date));
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
  const waist = weighins().filter(x => x.waist).at(-1)?.waist || 0;
  const measured = weighins().filter(x => x.fat).at(-1)?.fat || 0;
  let bodyFat, fatFrom;
  if (measured) { bodyFat = measured; fatFrom = 'measured'; }
  else if (waist) { bodyFat = (male ? 64 : 76) - 20 * (height / waist); fatFrom = 'waist'; }
  else { bodyFat = 1.2 * bmi + 0.23 * age - 10.8 * (male ? 1 : 0) - 5.4; fatFrom = 'BMI'; }
  bodyFat = Math.min(50, Math.max(male ? 5 : 10, bodyFat));
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
  if (!s) return { missing: 'No body profile yet. Ask for height (cm) and weight (kg), or point to the Body screen (Diet → Body).' };
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
    note: 'Estimates from standard formulas (Mifflin-St Jeor, RFM or Deurenberg body fat, FFMI target). Real weigh-ins over weeks are the check. Not medical advice.',
  };
}
