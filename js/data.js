// Domain logic shared by the screens and by Claude's tools, so both always
// agree on what "today's spending" or "the study streak" means.
import * as db from './db.js';
import { today, addDays, monthKey, sum, weekStart, dayKey, localInput } from './util.js';

export const EXPENSE_CATEGORIES = ['Food', 'Groceries', 'Transport', 'Shopping', 'Bills', 'Health', 'Education', 'Entertainment', 'Coffee', 'Other'];
export const CATEGORY_ICON = { Food: '🍽️', Groceries: '🛒', Transport: '🚕', Shopping: '🛍️', Bills: '🧾', Health: '💊', Education: '📚', Entertainment: '🎬', Coffee: '☕', Other: '•', Income: '💰' };
export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const SUBJECT_COLORS = ['#7c9cff', '#5ad1b0', '#ffb547', '#ff6b8b', '#b58cff', '#4fc3f7', '#9ccc65', '#ff8a65'];

export const goals = () => ({
  monthlyBudget: db.setting('monthlyBudget', 0),
  dailyStudyMin: db.setting('dailyStudyMin', 60),
  dailyCalories: db.setting('dailyCalories', 2200),
  dailyProtein: db.setting('dailyProtein', 120),
  dailyWater: db.setting('dailyWater', 8),
});

// ---------- Expenses ----------
export function addExpense({ amount, category = 'Other', note = '', date = today() }) {
  amount = Number(amount);
  if (!amount) throw new Error('amount is required');
  if (!EXPENSE_CATEGORIES.includes(category)) category = 'Other';
  return db.put('expenses', { amount, category, note, date });
}
export const expensesBetween = (from, to) => db.all('expenses').filter(e => e.date >= from && e.date <= to).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
export const expensesInMonth = (m = monthKey()) => db.all('expenses').filter(e => e.date.startsWith(m));
export function byCategory(list) {
  const out = {};
  for (const e of list) out[e.category] = (out[e.category] || 0) + e.amount;
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}
export function moneySummary() {
  const month = expensesInMonth();
  const spent = sum(month, e => e.amount);
  const budget = goals().monthlyBudget;
  const d = new Date();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return {
    today: sum(expensesBetween(today(), today()), e => e.amount),
    week: sum(expensesBetween(weekStart(), today()), e => e.amount),
    month: spent,
    budget,
    budgetLeft: budget ? budget - spent : null,
    dailyAllowance: budget ? Math.max(0, (budget - spent) / (daysInMonth - d.getDate() + 1)) : null,
    categories: byCategory(month),
  };
}

// ---------- Meetings / calendar ----------
export function addEvent({ title, start, end, location = '', notes = '', remind = 15 }) {
  if (!title || !start) throw new Error('title and start are required');
  const s = new Date(start);
  if (isNaN(s)) throw new Error('start must be a date/time like 2026-10-15T14:00');
  const e = end ? new Date(end) : new Date(s.getTime() + 60 * 60000);
  return db.put('events', { title, start: s.toISOString(), end: e.toISOString(), location, notes, remind: Number(remind) || 0 });
}
export const eventsOn = key => db.all('events').filter(e => dayKey(new Date(e.start)) === key).sort((a, b) => a.start.localeCompare(b.start));
export function eventsBetween(from, to) {
  return db.all('events').filter(e => { const k = dayKey(new Date(e.start)); return k >= from && k <= to; }).sort((a, b) => a.start.localeCompare(b.start));
}
export function upcomingEvents(n = 5) {
  const now = new Date().toISOString();
  return db.all('events').filter(e => e.end >= now).sort((a, b) => a.start.localeCompare(b.start)).slice(0, n);
}
// Find free slots on a day between 08:00 and 21:00.
export function freeSlots(key, minMinutes = 30) {
  const [y, m, d] = key.split('-').map(Number);
  let cursor = new Date(y, m - 1, d, 8, 0);
  const endOfDay = new Date(y, m - 1, d, 21, 0);
  if (key === today()) cursor = new Date(Math.max(cursor, Date.now()));
  const slots = [];
  for (const ev of eventsOn(key)) {
    const s = new Date(ev.start), e = new Date(ev.end);
    if (s - cursor >= minMinutes * 60000) slots.push([cursor, s]);
    if (e > cursor) cursor = e;
  }
  if (endOfDay - cursor >= minMinutes * 60000) slots.push([cursor, endOfDay]);
  return slots.map(([a, b]) => ({ start: a.toISOString(), end: b.toISOString() }));
}

// ---------- Study ----------
export function ensureSubject(name) {
  name = String(name || 'General').trim();
  const found = db.all('subjects').find(s => s.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const color = SUBJECT_COLORS[db.all('subjects').length % SUBJECT_COLORS.length];
  const row = { id: db.uid(), name, color, goalHours: 0 };
  db.put('subjects', row);
  return row;
}
export function logStudy({ subject, minutes, date = today(), note = '' }) {
  minutes = Number(minutes);
  if (!minutes || minutes <= 0) throw new Error('minutes must be positive');
  const s = ensureSubject(subject);
  return db.put('sessions', { subjectId: s.id, minutes, date, note });
}
export const minutesOn = key => sum(db.all('sessions').filter(s => s.date === key), s => s.minutes);
export function studyStreak() {
  // A day counts when you studied at least 15 minutes (or hit your goal, if lower).
  const need = Math.min(15, goals().dailyStudyMin || 15);
  const perDay = {};
  for (const s of db.all('sessions')) perDay[s.date] = (perDay[s.date] || 0) + s.minutes;
  let streak = 0;
  let k = today();
  if ((perDay[k] || 0) < need) k = addDays(k, -1); // today still counts as "in progress"
  while ((perDay[k] || 0) >= need) { streak++; k = addDays(k, -1); }
  let best = 0, run = 0;
  const days = Object.keys(perDay).sort();
  for (let i = 0; i < days.length; i++) {
    if (perDay[days[i]] < need) { run = 0; continue; }
    run = i > 0 && addDays(days[i - 1], 1) === days[i] && perDay[days[i - 1]] >= need ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return { current: streak, best: Math.max(best, streak), studiedToday: (perDay[today()] || 0) >= need, perDay };
}
export function studySummary() {
  const subjects = db.all('subjects');
  const sessions = db.all('sessions');
  const ws = weekStart();
  const bySubject = subjects.map(s => ({
    name: s.name,
    color: s.color,
    totalMin: sum(sessions.filter(x => x.subjectId === s.id), x => x.minutes),
    weekMin: sum(sessions.filter(x => x.subjectId === s.id && x.date >= ws), x => x.minutes),
    goalHours: s.goalHours || 0,
  })).sort((a, b) => b.totalMin - a.totalMin);
  return {
    todayMin: minutesOn(today()),
    weekMin: sum(sessions.filter(x => x.date >= ws), x => x.minutes),
    dailyGoalMin: goals().dailyStudyMin,
    streak: studyStreak(),
    bySubject,
  };
}

// ---------- Diet ----------
export function logMeal({ name, calories = 0, protein = 0, carbs = 0, fat = 0, meal = 'Snack', date = today() }) {
  if (!name) throw new Error('name is required');
  if (!MEAL_TYPES.includes(meal)) meal = 'Snack';
  return db.put('meals', { name, calories: Number(calories) || 0, protein: Number(protein) || 0, carbs: Number(carbs) || 0, fat: Number(fat) || 0, meal, date });
}
export function dietDay(key = today()) {
  const meals = db.all('meals').filter(m => m.date === key).sort((a, b) => MEAL_TYPES.indexOf(a.meal) - MEAL_TYPES.indexOf(b.meal));
  const water = db.setting(`water:${key}`, 0);
  return {
    date: key,
    meals,
    calories: sum(meals, m => m.calories),
    protein: sum(meals, m => m.protein),
    carbs: sum(meals, m => m.carbs),
    fat: sum(meals, m => m.fat),
    water,
    goals: goals(),
  };
}

// ---------- Tasks ----------
export function addTask({ title, due = null }) {
  if (!title) throw new Error('title is required');
  return db.put('tasks', { title, due, done: false });
}
export const openTasks = () => db.all('tasks').filter(t => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt.localeCompare(b.createdAt));

// One compact snapshot of the user's life, used by the dashboard and given to Claude.
export function overview() {
  const m = moneySummary();
  const s = studySummary();
  const d = dietDay();
  return {
    now: new Date().toString(),
    money: { currency: db.setting('currency', 'TRY'), today: m.today, thisWeek: m.week, thisMonth: m.month, monthlyBudget: m.budget || null, budgetLeft: m.budgetLeft, topCategories: m.categories.slice(0, 4) },
    calendar: { today: eventsOn(today()).map(slimEvent), upcoming: upcomingEvents(6).map(slimEvent) },
    study: { todayMin: s.todayMin, dailyGoalMin: s.dailyGoalMin, weekMin: s.weekMin, streakDays: s.streak.current, bestStreak: s.streak.best, subjects: s.bySubject.map(x => ({ name: x.name, totalMin: x.totalMin, weekMin: x.weekMin })) },
    diet: { calories: d.calories, calorieGoal: d.goals.dailyCalories, protein: d.protein, proteinGoal: d.goals.dailyProtein, waterGlasses: d.water, meals: d.meals.map(x => `${x.meal}: ${x.name} (${x.calories} kcal)`) },
    tasks: openTasks().slice(0, 10).map(t => ({ id: t.id, title: t.title, due: t.due })),
  };
}
// Claude sees local wall-clock times ("2026-10-15T14:00"), the same way the user thinks about them.
export const slimEvent = e => ({ id: e.id, title: e.title, start: localInput(new Date(e.start)), end: localInput(new Date(e.end)), location: e.location || undefined, notes: e.notes || undefined });
