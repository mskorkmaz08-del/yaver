// Training (v57): the weekly plan for Mustafa's goal (an athletic body that is
// muscular, strong, fast and flexible), the sessions he marks done, and how many
// hard sets each muscle got this week, which lights the muscle map.
//
// What the plan rests on:
// - Muscle: about 10 or more hard sets per muscle a week, each muscle trained
//   twice a week (Schoenfeld 2016 and 2017 meta-analyses). Big lifts at 4-8 reps
//   for strength, 8-15 for size.
// - Power and speed: jumps, throws and sprints done first in a session while
//   fresh, few reps, full rest (sprint 10-30 m, walk back).
// - Flexibility: every major muscle stretched at least 2-3 days a week, about
//   60 seconds per stretch in total (ACSM); here a 10-minute mobility block every day.
// The weekday template depends on days a week (3, 4 or 5).
import * as db from './db.js';
import { today, addDays } from './util.js';

// Exercise → muscles it trains: [primary..], [secondary..] (a secondary muscle counts half a set).
export const EX = {
  boxjump: ['Box jumps', ['quadriceps', 'gluteal', 'calves'], ['hamstring']],
  squat: ['Back squat', ['quadriceps', 'gluteal'], ['adductors', 'lower-back', 'abs']],
  rdl: ['Romanian deadlift', ['hamstring', 'gluteal'], ['lower-back', 'forearm']],
  deadlift: ['Deadlift', ['hamstring', 'gluteal', 'lower-back'], ['quadriceps', 'trapezius', 'forearm']],
  lunge: ['Walking lunges', ['quadriceps', 'gluteal'], ['adductors', 'calves']],
  split: ['Bulgarian split squat', ['quadriceps', 'gluteal'], ['adductors']],
  nordic: ['Nordic or leg curl', ['hamstring'], ['calves']],
  thrust: ['Hip thrust', ['gluteal'], ['hamstring']],
  calf: ['Calf raises', ['calves'], ['tibialis']],
  plank: ['Plank', ['abs'], ['obliques']],
  legraise: ['Hanging leg raise', ['abs'], ['obliques', 'forearm']],
  pallof: ['Pallof press', ['obliques'], ['abs']],
  bench: ['Bench press', ['chest', 'triceps'], ['deltoids']],
  incline: ['Incline dumbbell press', ['chest', 'deltoids'], ['triceps']],
  pullup: ['Pull-ups', ['upper-back', 'biceps'], ['forearm', 'trapezius']],
  ohp: ['Overhead press', ['deltoids', 'triceps'], ['trapezius', 'abs']],
  pushpress: ['Push press', ['deltoids', 'triceps'], ['quadriceps', 'trapezius']],
  row: ['Barbell row', ['upper-back', 'trapezius'], ['biceps', 'lower-back', 'forearm']],
  cablerow: ['Seated cable row', ['upper-back'], ['biceps', 'trapezius']],
  dips: ['Dips', ['chest', 'triceps'], ['deltoids']],
  facepull: ['Face pulls', ['deltoids', 'trapezius'], ['upper-back']],
  curl: ['Dumbbell curls', ['biceps'], ['forearm']],
  pushdown: ['Triceps pushdown', ['triceps'], []],
  mbthrow: ['Medicine-ball chest throws', ['chest', 'triceps'], ['deltoids', 'obliques']],
  swing: ['Kettlebell swings', ['gluteal', 'hamstring'], ['lower-back', 'forearm']],
  carry: ['Farmer carry', ['forearm', 'trapezius'], ['obliques', 'abs']],
  sprint: ['Sprints, 20-30 m, walk back', ['hamstring', 'gluteal', 'calves'], ['quadriceps', 'adductors']],
  agility: ['Agility drills (cones or ladder)', ['calves', 'adductors'], ['quadriceps', 'obliques']],
  shrug: ['Shrugs', ['trapezius'], ['forearm']],
  neckbridge: ['Neck flexion and extension', ['neck'], []],
};

// Sessions: [exercise, sets, reps].
export const SESSIONS = {
  lowerPower: { name: 'Lower body: power and strength', items: [['boxjump', 4, '3'], ['squat', 4, '5'], ['rdl', 3, '8'], ['lunge', 3, '10 a leg'], ['calf', 3, '12'], ['plank', 3, '40 s']] },
  upperStrength: { name: 'Upper body: strength', items: [['bench', 4, '5'], ['pullup', 4, '6-8'], ['ohp', 3, '8'], ['row', 3, '8'], ['dips', 3, '10'], ['facepull', 3, '15']] },
  lowerStrength: { name: 'Lower body: strength and size', items: [['sprint', 4, '1'], ['deadlift', 4, '4'], ['split', 3, '8 a leg'], ['nordic', 3, '6'], ['thrust', 3, '10'], ['legraise', 3, '10']] },
  upperPower: { name: 'Upper body: power and size', items: [['mbthrow', 4, '5'], ['pushpress', 4, '5'], ['pullup', 3, '6'], ['incline', 3, '10'], ['cablerow', 3, '10'], ['curl', 3, '12'], ['pushdown', 3, '12'], ['shrug', 2, '12']] },
  speed: { name: 'Speed, agility and conditioning', items: [['sprint', 6, '1'], ['agility', 4, '30 s'], ['swing', 4, '15'], ['carry', 4, '30 m'], ['pallof', 3, '10 a side']] },
  fullA: { name: 'Full body A: strength', items: [['boxjump', 3, '3'], ['squat', 4, '5'], ['bench', 4, '5'], ['pullup', 3, '6-8'], ['rdl', 3, '8'], ['plank', 3, '40 s']] },
  fullB: { name: 'Full body B: power and size', items: [['mbthrow', 3, '5'], ['deadlift', 3, '4'], ['ohp', 3, '8'], ['row', 3, '8'], ['split', 3, '8 a leg'], ['legraise', 3, '10']] },
  fullC: { name: 'Full body C: speed and strength', items: [['sprint', 6, '1'], ['pushpress', 3, '5'], ['lunge', 3, '10 a leg'], ['incline', 3, '10'], ['cablerow', 3, '10'], ['swing', 3, '15'], ['curl', 2, '12'], ['pushdown', 2, '12']] },
};
export const MOBILITY = 'Mobility, 10 min: hips, hamstrings, calves, chest, shoulders and upper back; hold each stretch 30-60 s.';

// Weekday (0 = Sunday) → session, by days a week.
const WEEK = {
  3: { 1: 'fullA', 3: 'fullB', 5: 'fullC' },
  4: { 1: 'lowerPower', 2: 'upperStrength', 4: 'lowerStrength', 5: 'upperPower' },
  5: { 1: 'lowerPower', 2: 'upperStrength', 4: 'lowerStrength', 5: 'upperPower', 6: 'speed' },
};
export const daysAWeek = () => [3, 4, 5].includes(Number(db.setting('trainDays', 4))) ? Number(db.setting('trainDays', 4)) : 4;
const dow = date => new Date(date + 'T12:00').getDay();
export function sessionOn(date = today()) {
  const key = WEEK[daysAWeek()][dow(date)];
  return key ? { key, ...SESSIONS[key] } : null;
}
export function week(date = today()) {
  // Monday-first list of the week's days with their session.
  const d = dow(date), monday = addDays(date, -((d + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const day = addDays(monday, i); return { day, session: sessionOn(day), done: doneOn(day) }; });
}

// Logged sessions: { date, session (key), name }.
export const workouts = () => db.all('workouts').sort((a, b) => a.date.localeCompare(b.date));
export const doneOn = date => db.all('workouts').find(w => w.date === date) || null;
export async function markDone(date = today(), key = sessionOn(date)?.key || 'other') {
  const have = doneOn(date);
  if (have) { await db.remove('workouts', have.id); return null; }
  return db.put('workouts', { date, session: key, name: SESSIONS[key]?.name || 'Training' });
}
// Sessions a week over the last 14 days (null when nothing was logged).
export function recentPerWeek(end = today()) {
  const from = addDays(end, -13);
  const n = db.all('workouts').filter(w => w.date >= from && w.date <= end).length;
  return n ? n / 2 : null;
}

// Hard sets per muscle from the sessions done in the last 7 days.
export function setsThisWeek(end = today()) {
  const from = addDays(end, -6), sets = {};
  for (const w of db.all('workouts').filter(w => w.date >= from && w.date <= end)) {
    for (const [ex, n] of SESSIONS[w.session]?.items || []) {
      const [, main, side] = EX[ex];
      for (const m of main) sets[m] = (sets[m] || 0) + n;
      for (const m of side) sets[m] = (sets[m] || 0) + n / 2;
    }
  }
  return sets;
}
// Muscles a session works (primary only), and the exercises that hit a muscle.
export const musclesOf = s => new Set((s?.items || []).flatMap(([ex]) => EX[ex][1]));
export const exercisesFor = (muscle, s) => (s?.items || []).filter(([ex]) => EX[ex][1].includes(muscle) || EX[ex][2].includes(muscle)).map(([ex]) => EX[ex][0]);
export const MUSCLE_NAMES = {
  chest: 'Chest', abs: 'Abs', obliques: 'Obliques', biceps: 'Biceps', triceps: 'Triceps', forearm: 'Forearms', deltoids: 'Shoulders', trapezius: 'Traps', neck: 'Neck',
  'upper-back': 'Upper back and lats', 'lower-back': 'Lower back', gluteal: 'Glutes', quadriceps: 'Quads', hamstring: 'Hamstrings', adductors: 'Inner thighs', calves: 'Calves', tibialis: 'Shins',
};
