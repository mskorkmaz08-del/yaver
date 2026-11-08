// Add/edit sheets, shared by Home's quick actions and each tab.
import * as db from './db.js';
import * as D from './data.js';
import { sheet, today, localInput, toast, haptic, html, raw, timeHM, fmtDay, dayKey } from './util.js';
import { openInCalendar } from './ics.js';
import * as T from './teams.js';

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
  if (v.__danger) { await db.remove('expenses', e.id); haptic(); toast('Expense deleted', { action: { label: 'Undo', run: () => db.put('expenses', e) } }); return; }
  if (existing) await db.put('expenses', { ...e, ...v, amount: Number(v.amount) });
  else await D.addExpense(v);
  toast(existing ? 'Saved' : 'Expense added');
}

// Opens any event by id: Yaver's own meetings are editable; Apple Calendar events
// are a read-only copy, so they open as a details card (change them in Calendar).
export function openEvent(id) {
  const ev = db.get('events', id) || db.get('applecal', id);
  if (!ev) return;
  if (!D.isApple(ev)) return meetingForm(ev);
  const s = new Date(ev.start), e = new Date(ev.end);
  const when = ev.allDay
    ? `All day · ${fmtDay(dayKey(s), { weekday: 'long', day: 'numeric', month: 'long' })}`
    : `${fmtDay(dayKey(s), { weekday: 'long', day: 'numeric', month: 'long' })} · ${timeHM(ev.start)}–${timeHM(ev.end)}`;
  return sheet({
    title: ev.title,
    submit: 'Done',
    body: html`<div class="apple-ev">
      <p>${when}</p>
      ${raw(ev.location ? html`<p>${ev.location}</p>` : '')}
      ${raw(ev.notes ? html`<p class="muted">${ev.notes}</p>` : '')}
      <p class="muted small">From Apple Calendar${ev.calendar ? ' · ' + ev.calendar : ''}. Read only here: change it in the Calendar app.</p>
    </div>`,
  });
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
    await db.remove('events', e.id); haptic(); toast('Meeting deleted', { action: { label: 'Undo', run: () => db.put('events', e) } });
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
    body: existing ? (m.items?.length ? html`<p class="small muted">${m.source === 'photo' ? 'From a photo (estimate): ' : ''}${m.items.map(i => `${i.name} ${i.grams}g`).join(', ')}${m.fiber != null ? ` · fiber ${m.fiber}g, sugar ${m.sugar}g, sodium ${m.sodium}mg` : ''}</p>` : '') : '<p class="muted small">Don\'t know the calories? Tap Photo a meal on the Diet screen, or ask Yaver.</p>',
    fields: [
      { name: 'name', label: 'Food', value: m.name, required: true, placeholder: 'e.g. Chicken wrap' },
      { name: 'meal', label: 'Meal', type: 'select', options: D.MEAL_TYPES, value: m.meal || guess },
      { name: 'calories', label: 'Calories (kcal)', type: 'number', value: m.calories },
      { name: 'protein', label: 'Protein (g)', type: 'number', value: m.protein },
      { name: 'carbs', label: 'Carbs (g)', type: 'number', value: m.carbs },
      { name: 'fat', label: 'Fat (g)', type: 'number', value: m.fat },
      { name: 'date', label: 'Date', type: 'date', value: m.date || day },
      { name: 'time', label: 'Eaten at', type: 'time', value: m.time || (existing ? D.mealTime(m)?.time || '' : (m.date || day) === today() ? D.nowHM() : '') },
    ],
  });
  if (!v) return;
  if (v.__danger) { await db.remove('meals', m.id); haptic(); toast('Meal deleted', { action: { label: 'Undo', run: () => db.put('meals', m) } }); return; }
  if (existing) await db.put('meals', { ...m, ...v, time: D.cleanTime(v.time) || undefined });
  else await D.logMeal(v);
  toast('Meal logged');
}

export async function taskForm() {
  const v = await sheet({ title: 'New task', fields: [{ name: 'title', label: 'Task', required: true }, { name: 'due', label: 'Due (optional)', type: 'date' }] });
  if (v?.title) { await D.addTask({ title: v.title, due: v.due || null }); toast('Task added'); }
}

// ---------- Teams ----------
export async function personForm(existing, team = 'student') {
  const p = existing || { team, meetEvery: team === 'dev' ? 0 : 14 };
  const st = existing ? T.status(existing) : null;
  const history = existing ? T.contacts(existing).slice(0, 6) : [];
  const v = await sheet({
    title: existing ? existing.name : 'New person',
    danger: existing ? 'Delete' : null,
    body: existing ? html`<div class="apple-ev">
      <p class="small">${T.ago(st.days)}${st.next ? ` · next: ${st.next.title}, ${localInput(new Date(st.next.at)).replace('T', ' ')}` : ''}</p>
      ${raw(history.map(c => html`<p class="small muted">${localInput(new Date(c.at)).replace('T', ' ')} · ${c.title}${c.place ? ' · ' + c.place : ''}${c.from === 'apple' ? ' · Apple Calendar' : ''}</p>`).join(''))}
    </div>` : '',
    fields: [
      { name: 'name', label: 'Name', value: p.name, required: true, placeholder: 'Ayşe Yılmaz' },
      { name: 'team', label: 'Team', type: 'select', value: p.team, options: Object.entries(T.TEAMS) },
      { name: 'role', label: 'Role or group', value: p.role, placeholder: p.team === 'dev' ? 'Backend' : 'Group A, week 3' },
      { name: 'meetEvery', label: 'Meet', type: 'select', value: p.meetEvery ?? 0, options: T.EVERY },
      { name: 'contact', label: 'Contact', value: p.contact, placeholder: 'Phone, Telegram, email' },
      { name: 'notes', label: 'Notes', type: 'textarea', value: p.notes },
    ],
  });
  if (!v) return;
  if (v.__danger) {
    await db.remove('people', p.id); haptic(); toast(`${p.name} removed`, { action: { label: 'Undo', run: () => db.put('people', p) } });
    return;
  }
  const row = { name: v.name.trim(), team: v.team, role: v.role, meetEvery: Number(v.meetEvery) || 0, contact: v.contact, notes: v.notes };
  if (existing) await db.put('people', { ...existing, ...row });
  else await T.addPerson(row);
  toast(existing ? 'Saved' : `${row.name} added to ${T.TEAMS[row.team]}`);
}

export async function activityForm(existing, team = 'student') {
  const a = existing || { team, kind: 'activity', date: new Date().toISOString() };
  const names = (a.people || []).map(id => db.get('people', id)?.name).filter(Boolean).join(', ');
  const known = T.people(a.team === 'dev' ? 'dev' : a.team === 'both' ? null : 'student').map(p => p.name.split(' ')[0]).slice(0, 4).join(', ');
  const v = await sheet({
    title: existing ? 'Activity' : 'Log activity',
    danger: existing ? 'Delete' : null,
    fields: [
      { name: 'title', label: 'What', value: a.title, required: true, placeholder: 'Workshop, code review, 1:1…' },
      { name: 'kind', label: 'Kind', type: 'select', value: a.kind, options: Object.entries(T.KINDS) },
      { name: 'team', label: 'Team', type: 'select', value: a.team, options: [...Object.entries(T.TEAMS), ['both', 'Both']] },
      { name: 'date', label: 'When', type: 'datetime-local', value: localInput(new Date(a.date)), required: true },
      { name: 'place', label: 'Where', value: a.place, placeholder: 'Lab 2, Zoom, café…' },
      { name: 'people', label: 'Who came (names, commas)', value: names, placeholder: known || 'Ali, Ayşe' },
      { name: 'notes', label: 'Notes', type: 'textarea', value: a.notes },
    ],
  });
  if (!v) return;
  if (v.__danger) {
    await db.remove('activities', a.id); haptic(); toast('Activity deleted', { action: { label: 'Undo', run: () => db.put('activities', a) } });
    return;
  }
  const list = String(v.people || '').split(',').map(x => x.trim()).filter(Boolean);
  if (existing) {
    const { ids, added } = await T.resolvePeople(list, v.team);
    await db.put('activities', { ...existing, title: v.title, kind: v.kind, team: v.team, date: new Date(v.date).toISOString(), place: v.place, people: ids, notes: v.notes });
    toast(added.length ? `Saved · added ${added.join(', ')}` : 'Saved');
  } else {
    const { added } = await T.logActivity({ ...v, people: list });
    toast(added.length ? `Logged · added ${added.join(', ')}` : 'Activity logged');
  }
}
