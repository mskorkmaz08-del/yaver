// The tools Claude can use. Each tool is a JSON schema Claude reads, plus a
// JavaScript function the app runs on the phone when Claude calls it.
// This is how "add a 250 lira dinner" turns into a real row in the database.
import * as db from '../db.js';
import * as D from '../data.js';
import { today, addDays } from '../util.js';

const date = { type: 'string', description: 'Day as YYYY-MM-DD in the user\'s local time. Defaults to today.' };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const TOOLS = [
  {
    name: 'get_overview',
    description: 'Snapshot of the user\'s day: spending, budget, today\'s and upcoming meetings, study time and streak, diet totals, open tasks. Call this first whenever the user asks how they are doing, wants a briefing, or you need context.',
    input_schema: obj({}),
    run: () => D.overview(),
  },
  // ----- Money -----
  {
    name: 'add_expense',
    description: `Record money the user spent. Categories: ${D.EXPENSE_CATEGORIES.join(', ')}. Amount is in the user's currency unless they say otherwise.`,
    input_schema: obj({ amount: { type: 'number' }, category: { type: 'string', enum: D.EXPENSE_CATEGORIES }, note: { type: 'string', description: 'What it was, e.g. "Dinner with Ali"' }, date }, ['amount', 'category']),
    run: async i => slim(await D.addExpense(i)),
  },
  {
    name: 'list_expenses',
    description: 'List expenses between two days (inclusive), newest first, with totals by category.',
    input_schema: obj({ from: date, to: date, category: { type: 'string' } }),
    run: ({ from = addDays(today(), -30), to = today(), category }) => {
      let list = D.expensesBetween(from, to);
      if (category) list = list.filter(e => e.category.toLowerCase() === category.toLowerCase());
      return { total: list.reduce((a, e) => a + e.amount, 0), byCategory: D.byCategory(list), expenses: list.slice(0, 60).map(slim) };
    },
  },
  {
    name: 'delete_expense',
    description: 'Delete an expense by id (get ids from list_expenses). Only when the user asks.',
    input_schema: obj({ id: { type: 'string' } }, ['id']),
    run: async ({ id }) => ({ deleted: await db.remove('expenses', id) }),
  },
  // ----- Calendar -----
  {
    name: 'add_meeting',
    description: 'Add a meeting or event to the user\'s Yaver calendar. Times are local wall-clock time like 2026-10-15T14:00. If no end is given it lasts one hour. Check list_meetings first to avoid clashes.',
    input_schema: obj({ title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, location: { type: 'string' }, notes: { type: 'string' }, remind_minutes_before: { type: 'number' } }, ['title', 'start']),
    run: async i => D.slimEvent(await D.addEvent({ ...i, remind: i.remind_minutes_before ?? 15 })),
  },
  {
    name: 'list_meetings',
    description: 'List meetings between two days (inclusive), and the free time slots (08:00 to 21:00) on each of those days.',
    input_schema: obj({ from: date, to: date }),
    run: ({ from = today(), to }) => {
      to = to || addDays(from, 6);
      const days = [];
      for (let k = from; k <= to && days.length < 31; k = addDays(k, 1)) {
        days.push({ day: k, meetings: D.eventsOn(k).map(D.slimEvent), free: D.freeSlots(k).map(s => `${local(s.start)}-${local(s.end)}`) });
      }
      return days;
    },
  },
  {
    name: 'update_meeting',
    description: 'Change a meeting (move it, rename it, etc.). Pass the id and only the fields that change.',
    input_schema: obj({ id: { type: 'string' }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, location: { type: 'string' }, notes: { type: 'string' } }, ['id']),
    run: async ({ id, ...ch }) => {
      const ev = db.get('events', id);
      if (!ev) throw new Error('No meeting with that id');
      const dur = new Date(ev.end) - new Date(ev.start);
      if (ch.start) { ev.start = new Date(ch.start).toISOString(); if (!ch.end) ev.end = new Date(new Date(ch.start).getTime() + dur).toISOString(); }
      if (ch.end) ev.end = new Date(ch.end).toISOString();
      for (const k of ['title', 'location', 'notes']) if (ch[k] !== undefined) ev[k] = ch[k];
      return D.slimEvent(await db.put('events', ev));
    },
  },
  {
    name: 'delete_meeting',
    description: 'Delete a meeting by id. Only when the user asks.',
    input_schema: obj({ id: { type: 'string' } }, ['id']),
    run: async ({ id }) => ({ deleted: await db.remove('events', id) }),
  },
  // ----- Study -----
  {
    name: 'log_study',
    description: 'Record a study session. Creates the subject if it is new.',
    input_schema: obj({ subject: { type: 'string' }, minutes: { type: 'number' }, note: { type: 'string' }, date }, ['subject', 'minutes']),
    run: async i => { await D.logStudy(i); const s = D.studySummary(); return { logged: true, todayMin: s.todayMin, streakDays: s.streak.current }; },
  },
  {
    name: 'get_study_stats',
    description: 'Study progress: minutes today and this week, daily goal, current and best streak, time per subject, and minutes per day for the last 14 days.',
    input_schema: obj({}),
    run: () => {
      const s = D.studySummary();
      const last14 = {};
      for (let i = 13; i >= 0; i--) { const k = addDays(today(), -i); last14[k] = s.streak.perDay[k] || 0; }
      return { ...s, streak: { current: s.streak.current, best: s.streak.best, studiedToday: s.streak.studiedToday }, last14 };
    },
  },
  // ----- Diet -----
  {
    name: 'log_meal',
    description: 'Record food the user ate. Estimate calories and macros (grams) yourself from the description or photo if the user does not give them, and say they are estimates.',
    input_schema: obj({ name: { type: 'string' }, meal: { type: 'string', enum: D.MEAL_TYPES }, calories: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' }, date }, ['name', 'meal', 'calories']),
    run: async i => { await D.logMeal(i); const d = D.dietDay(i.date || today()); return { logged: true, dayCalories: d.calories, calorieGoal: d.goals.dailyCalories, dayProtein: d.protein }; },
  },
  {
    name: 'get_diet_day',
    description: 'Meals, calories, macros and water for a day, with the user\'s goals.',
    input_schema: obj({ date }),
    run: ({ date: k = today() }) => { const d = D.dietDay(k); return { ...d, meals: d.meals.map(slim) }; },
  },
  {
    name: 'log_water',
    description: 'Add glasses of water drunk today (can be negative to correct).',
    input_schema: obj({ glasses: { type: 'number' } }, ['glasses']),
    run: async ({ glasses }) => { const k = `water:${today()}`; const v = Math.max(0, db.setting(k, 0) + glasses); await db.setSetting(k, v); return { waterToday: v }; },
  },
  // ----- Tasks & goals -----
  {
    name: 'add_task',
    description: 'Add a to-do / reminder to the user\'s task list.',
    input_schema: obj({ title: { type: 'string' }, due: date }, ['title']),
    run: async i => slim(await D.addTask(i)),
  },
  {
    name: 'complete_task',
    description: 'Mark a task done by id.',
    input_schema: obj({ id: { type: 'string' } }, ['id']),
    run: async ({ id }) => { const t = db.get('tasks', id); if (!t) throw new Error('No task with that id'); t.done = true; t.doneAt = new Date().toISOString(); await db.put('tasks', t); return { done: true }; },
  },
  {
    name: 'set_goal',
    description: 'Change one of the user\'s goals.',
    input_schema: obj({ goal: { type: 'string', enum: ['monthlyBudget', 'dailyStudyMin', 'dailyCalories', 'dailyProtein', 'dailyWater'] }, value: { type: 'number' } }, ['goal', 'value']),
    run: async ({ goal, value }) => { await db.setSetting(goal, value); return { [goal]: value }; },
  },
];

const local = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function slim(row) {
  const { createdAt, ...rest } = row;
  return rest;
}

// What gets sent to the API (schemas only, no functions).
export const toolDefinitions = TOOLS.map(({ run, ...def }) => def);

// Which tools change data, so the chat can show a small receipt and screens refresh.
export const WRITE_TOOLS = new Set(['add_expense', 'delete_expense', 'add_meeting', 'update_meeting', 'delete_meeting', 'log_study', 'log_meal', 'log_water', 'add_task', 'complete_task', 'set_goal']);

export async function runTool(name, input) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return { error: `Unknown tool ${name}` };
  if (input === null || typeof input !== 'object') return { error: 'Tool input must be an object' };
  try {
    return await tool.run(input);
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

export function describeAction(name, input) {
  switch (name) {
    case 'add_expense': return `💸 Added ${input.amount} · ${input.category}${input.note ? ` · ${input.note}` : ''}`;
    case 'add_meeting': return `📅 Scheduled “${input.title}” · ${String(input.start).replace('T', ' ')}`;
    case 'update_meeting': return '📅 Updated a meeting';
    case 'delete_meeting': return '🗑️ Removed a meeting';
    case 'delete_expense': return '🗑️ Removed an expense';
    case 'log_study': return `📚 Logged ${input.minutes} min of ${input.subject}`;
    case 'log_meal': return `🥗 Logged ${input.name} · ${input.calories} kcal`;
    case 'log_water': return `💧 Water ${input.glasses > 0 ? '+' : ''}${input.glasses}`;
    case 'add_task': return `✅ Task: ${input.title}`;
    case 'complete_task': return '✅ Completed a task';
    case 'set_goal': return `🎯 ${input.goal} → ${input.value}`;
    default: return null;
  }
}


