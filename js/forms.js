// Add/edit sheets, shared by Home's quick actions and each tab.
import * as db from './db.js';
import * as D from './data.js';
import { sheet, today, localInput, toast, confirmSheet } from './util.js';
import { openInCalendar } from './ics.js';

export async function expenseForm(existing) {
  const e = existing || {};
  const v = await sheet({
    title: existing ? 'Edit expense' : 'New expense',
    danger: existing ? 'Delete' : null,
    fields: [
      { name: 'amount', label: `Amount (${db.setting('currency', 'TRY')})`, type: 'number', step: '0.01', value: e.amount, required: true },
      { name: 'category', label: 'Category', type: 'select', options: D.EXPENSE_CATEGORIES, value: e.category || 'Food' },
      { name: 'note', label: 'Note', value: e.note, placeholder: 'What was it?' },
      { name: 'date', label: 'Date', type: 'date', value: e.date || today() },
    ],
  });
  if (!v) return;
  if (v.__danger) { await db.remove('expenses', e.id); toast('Expense deleted'); return; }
  if (existing) await db.put('expenses', { ...e, ...v, amount: Number(v.amount) });
  else await D.addExpense(v);
  toast(existing ? 'Saved' : 'Expense added');
}

export async function meetingForm(existing, day = today(), preset = {}) {
  const e = existing || preset;
  const start = e.start ? new Date(e.start) : (() => { const d = new Date(`${day}T09:00`); if (day === today()) { d.setTime(Date.now() + 3600000); d.setMinutes(0); } return d; })();
  const end = e.end ? new Date(e.end) : new Date(start.getTime() + 3600000);
  const v = await sheet({
    title: existing ? 'Meeting' : 'New meeting',
    danger: existing ? 'Delete' : null,
    submit: 'Save',
    fields: [
      { name: 'title', label: 'Title', value: e.title, required: true, placeholder: 'Meeting with…' },
      { name: 'start', label: 'Starts', type: 'datetime-local', value: localInput(start), required: true },
      { name: 'end', label: 'Ends', type: 'datetime-local', value: localInput(end) },
      { name: 'location', label: 'Location / link', value: e.location },
      { name: 'remind', label: 'Remind me', type: 'select', value: e.remind ?? 15, options: [[0, 'No reminder'], [5, '5 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [1440, '1 day before']] },
      { name: 'notes', label: 'Notes', type: 'textarea', value: e.notes },
      { name: 'toCalendar', label: 'Also add to iPhone Calendar (gives a real alert)', type: 'checkbox', value: !existing },
    ],
  });
  if (!v) return;
  if (v.__danger) {
    if (await confirmSheet('Delete meeting?', e.title)) { await db.remove('events', e.id); toast('Meeting deleted'); }
    return;
  }
  let saved;
  if (existing) {
    saved = await db.put('events', { ...e, title: v.title, start: new Date(v.start).toISOString(), end: new Date(v.end || v.start).toISOString(), location: v.location, notes: v.notes, remind: Number(v.remind) });
  } else {
    saved = await D.addEvent({ ...v });
  }
  toast('Meeting saved');
  if (v.toCalendar) openInCalendar([saved], saved.title.replace(/\W+/g, '-').slice(0, 40) || 'meeting');
}

export async function studyForm(subjectName) {
  const subjects = db.all('subjects').map(s => s.name);
  const v = await sheet({
    title: 'Log study session',
    fields: [
      { name: 'subject', label: 'Subject', type: subjects.length ? 'select' : 'text', options: [...subjects, '+ New subject'], value: subjectName || subjects[0], placeholder: 'e.g. Mathematics' },
      { name: 'newSubject', label: 'New subject name (if new)', placeholder: 'e.g. Physics' },
      { name: 'minutes', label: 'Minutes', type: 'number', value: 30, required: true },
      { name: 'date', label: 'Date', type: 'date', value: today() },
      { name: 'note', label: 'What did you cover?', value: '' },
    ],
  });
  if (!v) return;
  const subject = v.subject === '+ New subject' || !v.subject ? v.newSubject : v.subject;
  if (!subject) { toast('Pick or name a subject'); return; }
  await D.logStudy({ ...v, subject });
  toast(`+${v.minutes} XP · streak ${D.studyStreak().current}d`);
}

export async function mealForm(existing, day = today(), preset = {}) {
  const m = existing || preset;
  const hour = new Date().getHours();
  const guess = hour < 11 ? 'Breakfast' : hour < 16 ? 'Lunch' : hour < 21 ? 'Dinner' : 'Snack';
  const v = await sheet({
    title: existing ? 'Edit meal' : 'Log a meal',
    danger: existing ? 'Delete' : null,
    body: existing ? '' : '<p class="muted small">Don\'t know the calories? Ask Yaver or send it a photo, and it estimates for you.</p>',
    fields: [
      { name: 'name', label: 'Food', value: m.name, required: true, placeholder: 'e.g. Chicken wrap' },
      { name: 'meal', label: 'Meal', type: 'select', options: D.MEAL_TYPES, value: m.meal || guess },
      { name: 'calories', label: 'Calories (kcal)', type: 'number', value: m.calories },
      { name: 'protein', label: 'Protein (g)', type: 'number', value: m.protein },
      { name: 'carbs', label: 'Carbs (g)', type: 'number', value: m.carbs },
      { name: 'fat', label: 'Fat (g)', type: 'number', value: m.fat },
      { name: 'date', label: 'Date', type: 'date', value: m.date || day },
    ],
  });
  if (!v) return;
  if (v.__danger) { await db.remove('meals', m.id); toast('Meal deleted'); return; }
  if (existing) await db.put('meals', { ...m, ...v });
  else await D.logMeal(v);
  toast('Meal logged');
}

export async function taskForm() {
  const v = await sheet({ title: 'New task', fields: [{ name: 'title', label: 'Task', required: true }, { name: 'due', label: 'Due (optional)', type: 'date' }] });
  if (v?.title) { await D.addTask({ title: v.title, due: v.due || null }); toast('Task added'); }
}
