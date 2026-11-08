// The tools Claude can use. Each tool is a JSON schema Claude reads, plus a
// JavaScript function the app runs on the phone when Claude calls it.
// This is how "add a 250 lira dinner" turns into a real row in the database.
import * as db from '../db.js';
import * as D from '../data.js';
import { today, addDays } from '../util.js';
import { reminders } from '../reminders.js';
import * as Places from '../places.js';
import * as C from '../course.js';
import * as CT from '../cetele.js';
import * as T from '../teams.js';
import * as L from '../dietlog.js';
import * as G from '../foodgaps.js';
import * as B from '../body.js';
import * as TR from '../training.js';

const date = { type: 'string', description: 'Day as YYYY-MM-DD in the user\'s local time. Defaults to today.' };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const QA = { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] } };
const LESSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' }, track: { type: 'string' }, lane: { type: 'string' }, week: { type: 'number' }, kind: { type: 'string' }, minutes: { type: 'number' },
    title: { type: 'string' }, objectives: { type: 'array', items: { type: 'string' } },
    resources: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, part: { type: 'string' } }, required: ['title', 'url'] } },
    steps: { type: 'array', items: { type: 'object', properties: {
      kind: { type: 'string' }, minutes: { type: 'number' }, title: { type: 'string' }, body: { type: 'string' }, questions: QA, teachBack: { type: 'string' },
      tasks: { type: 'array', items: { type: 'object', properties: { prompt: { type: 'string' }, hints: { type: 'array', items: { type: 'string' } }, check: { type: 'string' }, solution: { type: 'string' } }, required: ['prompt', 'check'] } },
    }, required: ['kind', 'minutes', 'title'] } },
    cards: { type: 'array', items: { type: 'object', properties: { front: { type: 'string' }, back: { type: 'string' } }, required: ['front', 'back'] } },
    deliverable: { type: 'string' }, safety: { type: 'string' },
  },
  required: ['id', 'track', 'lane', 'week', 'kind', 'minutes', 'title', 'objectives', 'steps', 'cards'],
};
const attempts = {};

const TOOLS = [
  {
    name: 'get_overview',
    description: 'Snapshot of the user\'s day: spending, budget, today\'s and upcoming meetings, study time and streak, diet totals, open tasks. Call this first whenever the user asks how they are doing, wants a briefing, or you need context.',
    input_schema: obj({}),
    run: () => ({ ...D.overview(), reminders: reminders().map(r => r.text) }),
  },
  // ----- Çetele (daily spiritual minimums) -----
  {
    name: 'get_cetele',
    description: 'The user\'s çetele: daily spiritual minimums (namaz, Quran pages, book pages, salawat, Jawshan, tahajjud, fasting…), what is done on a day, and the streak. Weekly items (like fasting) count Monday to that day.',
    input_schema: obj({ date }),
    run: ({ date: d = today() }) => CT.summary(d),
  },
  {
    name: 'log_cetele',
    description: 'Record çetele progress. Use add for "I read 3 pages of Quran" or "100 salawat" (adds to the day), set to correct a total, done=true for yes/no items like tahajjud or a fast. Item is matched by name in Turkish or English.',
    input_schema: obj({ item: { type: 'string', description: 'e.g. Kur\'an, Quran, Salavat, Cevşen, Teheccüd, Oruç, Namaz' }, add: { type: 'number' }, set: { type: 'number' }, done: { type: 'boolean' }, date }, ['item']),
    run: async ({ item, add, set, done, date: d = today() }) => {
      const it = CT.find(item);
      if (!it) return { error: `No çetele item like "${item}". Items: ${CT.items().map(i => i.name).join(', ')}` };
      if (done !== undefined) await CT.setValue(it.id, done ? Math.max(1, CT.isCheck(it) ? 1 : it.target) : 0, d);
      else if (set !== undefined) await CT.setValue(it.id, set, d);
      else await CT.add(it.id, add ?? it.step ?? 1, d);
      const r = CT.day(d).rows.find(x => x.id === it.id);
      return { ok: true, item: it.name, value: CT.valueOn(it.id, d), progress: r.progress, target: it.target, met: r.met };
    },
  },
  {
    name: 'set_cetele_item',
    description: 'Add a çetele item or change its minimum (e.g. "make Quran 10 pages a day", "add Tesbihat"). per is day or week. Leave unit empty for a simple done / not done item.',
    input_schema: obj({ name: { type: 'string' }, target: { type: 'number' }, unit: { type: 'string' }, per: { type: 'string', enum: ['day', 'week'] }, remove: { type: 'boolean' } }, ['name']),
    run: async ({ name, target, unit, per, remove }) => {
      const it = CT.find(name);
      if (remove) return it ? (await CT.archiveItem(it.id), { ok: true, removed: it.name }) : { error: 'not found' };
      const row = await CT.saveItem({ id: it?.id, name: it?.name || name, target: target ?? it?.target ?? 1, unit: unit ?? it?.unit ?? '', per: per || it?.per || 'day', step: it?.step || 1 });
      return { ok: true, item: row.name, target: row.target, unit: row.unit, per: row.per };
    },
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
      if (!ev && db.get('applecal', id)) throw new Error('That event is from Apple Calendar and is read only in Yaver. Tell the user to change it in the Calendar app.');
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
    run: async ({ id }) => {
      if (db.get('applecal', id)) throw new Error('That event is from Apple Calendar and is read only in Yaver. Tell the user to delete it in the Calendar app.');
      return { deleted: await db.remove('events', id) };
    },
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
  {
    name: 'get_roadmap',
    description: 'The user\'s learning roadmap: milestones per subject, which are done, and what is next.',
    input_schema: obj({}),
    run: () => D.roadmap().map(r => ({ subject: r.subject, done: r.done, total: r.total, milestones: r.items.map(m => ({ id: m.id, title: m.title, done: m.done })) })),
  },
  {
    name: 'add_roadmap_milestones',
    description: 'Add ordered milestones (topics, chapters, projects) to a subject\'s roadmap, e.g. subject "Algorithms", milestones ["Big-O", "Sorting", "Binary search"]. Creates the subject if new.',
    input_schema: obj({ subject: { type: 'string' }, milestones: { type: 'array', items: { type: 'string' } } }, ['subject', 'milestones']),
    run: async ({ subject, milestones }) => { if (!Array.isArray(milestones) || !milestones.length) throw new Error('milestones must be a non-empty list'); const rows = await D.addMilestones(subject, milestones); return { added: rows.length }; },
  },
  {
    name: 'complete_milestone',
    description: 'Mark a roadmap milestone done (or not done) by id.',
    input_schema: obj({ id: { type: 'string' }, done: { type: 'boolean' } }, ['id']),
    run: async ({ id, done = true }) => { const m = db.get('milestones', id); if (!m) throw new Error('No milestone with that id'); await db.put('milestones', { ...m, done, doneAt: done ? new Date().toISOString() : null }); return { done }; },
  },
  {
    name: 'log_practice',
    description: 'Add to today\'s practice counters: coding problems solved and/or flashcard reviews done outside Yaver (course review cards count themselves).',
    input_schema: obj({ problems: { type: 'number' }, anki_reviews: { type: 'number' } }),
    run: async ({ problems, anki_reviews }) => {
      if (problems) await D.addPractice('problems', problems);
      if (anki_reviews) await D.addPractice('anki', anki_reviews);
      return { problemsToday: D.practiceOn('problems'), ankiToday: D.practiceOn('anki'), problemsTotal: D.practiceTotal('problems') };
    },
  },
  {
    name: 'get_study_plan',
    description: 'The user\'s long-term study plan (the ML Engineer roadmap if loaded): current week and phase, phase progress, next topics, weekly hours target, daily template and minimum-day rule.',
    input_schema: obj({}),
    run: () => { if (C.ready() && C.active()) return { active: 'Yaver Course', note: 'The day-by-day course is the active plan; use get_course_today and get_course_progress. The old 52-week roadmap below is kept for reference.', oldPlan: D.planStatus()?.title || null }; const p = D.planStatus(); return p ? { title: p.title, start: p.start, end: p.end, week: p.week, started: p.started, phase: p.phase, phaseProgress: `${p.phaseDone}/${p.phaseTotal}`, nextTopics: p.next.map(m => ({ id: m.id, title: m.title })), weeklyHoursTarget: p.weeklyHours, template: p.template, minimumDay: p.minimumDay } : { plan: null, hint: 'No plan loaded. The user can load the ML Engineer roadmap from the Study tab.' }; },
  },
  // ----- Course -----
  {
    name: 'get_course_today',
    description: 'The course plan for a day: week, phase, consolidation flag, each slot with time, track, lesson id, title, minutes and status; review cards due; pace per track; teaching deadlines. Call first for anything about today\'s studying.',
    input_schema: obj({ date }),
    run: async ({ date: k = today() }) => {
      await C.init();
      const d = C.day(k);
      return {
        date: k, week: d.week, phase: d.phaseName, consolidation: d.consolidation, courseActive: C.active(),
        slots: (d.slots || []).filter(s => s.type !== 'info').map(s => ({ slot: s.id, start: s.start, end: s.end, minutes: s.minutes, track: s.track || undefined, lessonId: s.lesson?.id, title: C.slotTitle(s), status: s.status, ahead: s.ahead || undefined, urgent: s.urgent || undefined, prepareWeek: s.prepare || undefined })),
        cardsDue: C.dueCount(),
        pace: Object.values(C.pace()).map(t => ({ track: t.name, status: t.label })),
        deadlines: C.deadlines(14),
      };
    },
  },
  {
    name: 'get_lesson',
    description: 'A full course lesson (objectives, resources, steps with explanations, practice tasks with hints and solutions, exit ticket, cards) plus the user\'s progress on it. Use it to tutor; keep solutions hidden until he has attempted and asks.',
    input_schema: obj({ lessonId: { type: 'string' } }, ['lessonId']),
    run: async ({ lessonId }) => { await C.init(); const l = C.lesson(lessonId); if (!l) throw new Error('No lesson with that id'); return { lesson: l, progress: C.progress(lessonId), teachBy: l.track === 'robo' ? C.teachBy(l) : undefined }; },
  },
  {
    name: 'complete_lesson',
    description: 'Complete a course lesson: logs the minutes as study, schedules its review cards, applies the 80% mastery rule (score is the exit-ticket fraction 0–1; below 0.8 the lesson is flagged and comes back). Returns the next lesson in that track.',
    input_schema: obj({ lessonId: { type: 'string' }, minutes: { type: 'number' }, score: { type: 'number', description: 'Exit-ticket score 0–1' }, notes: { type: 'string' } }, ['lessonId']),
    run: async i => { await C.init(); return C.completeLesson(i); },
  },
  {
    name: 'get_review_cards',
    description: 'Review cards due now (spaced repetition), interleaved across tracks.',
    input_schema: obj({ limit: { type: 'number' }, track: { type: 'string', enum: ['python', 'cpp', 'algo', 'math', 'ai', 'robo', 'build', 'tools'] } }),
    run: async ({ limit = 10, track }) => { await C.init(); return { due: C.dueCount(), cards: C.dueCards({ limit, track }).map(c => ({ id: c.id, track: c.track, front: c.front, back: c.back, box: c.box })) }; },
  },
  {
    name: 'grade_card',
    description: 'Grade a review card after the user answered it: again (forgot), hard, good, easy. Moves its next due date.',
    input_schema: obj({ cardId: { type: 'string' }, grade: { type: 'string', enum: ['again', 'hard', 'good', 'easy'] } }, ['cardId', 'grade']),
    run: async ({ cardId, grade }) => { await C.init(); const c = await C.gradeCard(cardId, grade); return { cardId, box: c.box, due: c.due }; },
  },
  {
    name: 'get_course_progress',
    description: 'Course progress per track: done/total, pace (on plan / behind / ahead), mastery rate, flagged lessons, weekly test scores, consolidation weeks, teaching deadlines, diagnostic scores.',
    input_schema: obj({}),
    run: async () => { await C.init(); return C.progressSummary(); },
  },
  {
    name: 'record_test_result',
    description: 'Store the Sunday weekly test result per track. Tracks under 70% get that week\'s lessons flagged and their cards due Monday.',
    input_schema: obj({ week: { type: 'number' }, scores: { type: 'array', items: { type: 'object', properties: { track: { type: 'string' }, right: { type: 'number' }, total: { type: 'number' } }, required: ['track', 'right', 'total'] } } }, ['week', 'scores']),
    run: async i => { await C.init(); return C.recordTest(i); },
  },
  {
    name: 'save_week_lessons',
    description: 'Save AI-written day-level lessons for a course week (16 or later). Validates them against the lesson rules and the rotation\'s session counts; returns precise errors to fix and retry (at most 3 attempts, then tell the user).',
    input_schema: obj({ week: { type: 'number' }, lessons: { type: 'array', items: LESSON_SCHEMA } }, ['week', 'lessons']),
    run: async ({ week, lessons }) => {
      await C.init();
      attempts[week] = (attempts[week] || 0) + 1;
      const r = await C.saveWeekLessons(week, lessons);
      if (!r.saved && attempts[week] >= 3) return { ...r, stop: 'Third failed attempt: stop retrying and tell the user plainly which problems remain.' };
      if (r.saved) attempts[week] = 0;
      return r;
    },
  },
  // ----- Places -----
  {
    name: 'find_places',
    description: `Find real places near the user with OpenStreetMap. Use category for "a pharmacy near me" style asks (${Object.keys(Places.CATEGORIES).join(', ')}), or query for a named place or address. Returns name, distance, opening hours and an Apple Maps directions link.`,
    input_schema: obj({ category: { type: 'string', enum: Object.keys(Places.CATEGORIES) }, query: { type: 'string' }, radius_m: { type: 'number' } }),
    run: async ({ category, query, radius_m }) => {
      let near = Places.lastLocation();
      if (!near) { try { near = await Places.locate(); } catch (e) { throw new Error(e.message); } }
      const list = category ? await Places.nearby(category, near, Math.min(radius_m || 2000, 10000)) : await Places.search(query || '', near);
      return list.slice(0, 8).map(p => ({ name: p.name, distance: p.km != null ? Places.fmtDist(p.km) : undefined, address: p.address || undefined, hours: p.hours || undefined, directions: Places.directionsUrl(p) }));
    },
  },
  // ----- Body (v56) -----
  {
    name: 'body_status',
    description: 'The user\'s body: weight, height, estimated body fat, lean mass, FFMI, energy burned a day, the athletic target weight and the plan to it (calories, protein, months), what today, the last 7 and 30 days of eating did (fat and muscle in grams), and a projection for the next month and 3 months if eating continues like the last 14 days. All estimates.',
    input_schema: obj({}),
    run: () => B.forAI(),
  },
  {
    name: 'log_weight',
    description: 'Log a weigh-in: weight in kg, and optionally waist at the navel in cm or a measured body fat %.',
    input_schema: obj({ kg: { type: 'number' }, date: { type: 'string', description: 'YYYY-MM-DD, default today' }, waist_cm: { type: 'number' }, body_fat_pct: { type: 'number' } }, ['kg']),
    run: async ({ kg, date, waist_cm, body_fat_pct }) => { await B.logWeight({ kg, date: date || today(), waist: waist_cm, fat: body_fat_pct }); return { ok: true, now: B.forAI().profile || null }; },
  },
  {
    name: 'log_workout',
    description: 'Mark a training session done (or undo it) on a day. With no session, the plan\'s session for that day. Sessions: ' + Object.keys(TR.SESSIONS).join(', ') + '.',
    input_schema: obj({ date: { type: 'string', description: 'YYYY-MM-DD, default today' }, session: { type: 'string', enum: Object.keys(TR.SESSIONS) } }),
    run: async ({ date, session }) => { const r = await TR.markDone(date || today(), session || TR.sessionOn(date || today())?.key || 'fullA'); return r ? { ok: true, done: r.name } : { ok: true, undone: true }; },
  },
  // ----- Diet -----
  {
    name: 'log_meal',
    description: 'Record food the user ate. Estimate calories and macros (grams) yourself from the description or photo if the user does not give them, and say they are estimates.',
    input_schema: obj({ name: { type: 'string' }, meal: { type: 'string', enum: D.MEAL_TYPES }, calories: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' }, fiber: { type: 'number' }, sugar: { type: 'number' }, sodium_mg: { type: 'number' }, date, time: { type: 'string', description: 'When it was eaten, HH:MM 24-hour local time. Defaults to now for today; ask or infer ("last night", "an hour ago") when they log later.' } }, ['name', 'meal', 'calories']),
    run: async ({ sodium_mg, ...i }) => { await D.logMeal({ ...i, sodium: sodium_mg }); const d = D.dietDay(i.date || today()); return { logged: true, dayCalories: d.calories, calorieGoal: d.goals.dailyCalories, dayProtein: d.protein }; },
  },
  {
    name: 'log_feeling',
    description: 'Record how the user feels on a day (good, ok or bad) with an optional short note, e.g. when they say they feel awful this morning. One check-in per day; it is compared with meal timing and food in diet_history.',
    input_schema: obj({ feel: { type: 'string', enum: ['good', 'ok', 'bad'] }, note: { type: 'string' }, date }, ['feel']),
    run: async ({ feel, note, date: k = today() }) => { await L.setFeel(k, feel, note ?? ''); return { ok: true, date: k, feel }; },
  },
  {
    name: 'get_diet_day',
    description: 'Meals, calories and macros for a day, with the user\'s goals.',
    input_schema: obj({ date }),
    run: ({ date: k = today() }) => { const d = D.dietDay(k); return { ...d, meals: d.meals.map(slim) }; },
  },
  {
    name: 'diet_history',
    description: 'The food diary over the last N days: average calories and protein against goals, fiber, sugar, sodium and vitamins and minerals against daily values, what is running low or over the limit, thin days, a line per logged day and every meal, plus today\'s gaps (fat quality included). Use it when the user feels weak, tired or unwell, asks how they have been eating, or asks what to eat to fill a gap.',
    input_schema: obj({ days: { type: 'number', description: 'How many days back, 1 to 180. Default 30.' } }),
    run: ({ days = 30 }) => ({ ...L.forAI(Math.max(1, Math.min(180, Math.round(days) || 30))), today_gaps: G.gaps().lines, last_suggestions: G.cached()?.items || [] }),
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
  // ----- Teams (dev team and students) -----
  {
    name: 'team_status',
    description: 'The dev team and the students: each person with when they were last met, the next planned meeting, their meeting target and whether a meeting is overdue, plus recent team activities (what, where, who). Meetings count from logged activities and from calendar events whose title names the person.',
    input_schema: obj({ team: { type: 'string', enum: ['student', 'dev'], description: 'Leave out for both teams.' } }),
    run: ({ team }) => T.summary(team),
  },
  {
    name: 'add_person',
    description: 'Add a person to the dev team or the students.',
    input_schema: obj({ name: { type: 'string' }, team: { type: 'string', enum: ['student', 'dev'] }, role: { type: 'string', description: 'Role or group, e.g. Backend or Group A' }, meet_every_days: { type: 'number', description: 'How often to meet them; 0 for no target. Default 14 for students, 0 for the dev team.' }, notes: { type: 'string' } }, ['name', 'team']),
    run: async ({ name, team, role, meet_every_days, notes }) => slim(await T.addPerson({ name, team, role, notes, meetEvery: meet_every_days })),
  },
  {
    name: 'log_team_activity',
    description: 'Log something a team did or a meeting with people: what, where, when and who came. Use kind "meeting" for a 1:1 or group meeting with students or the dev team. Unknown names are added to the team.',
    input_schema: obj({ title: { type: 'string' }, kind: { type: 'string', enum: ['meeting', 'activity', 'event'] }, team: { type: 'string', enum: ['student', 'dev', 'both'] }, date: { type: 'string', description: 'Local date and time like 2026-11-07T15:00. Defaults to now.' }, place: { type: 'string' }, people: { type: 'array', items: { type: 'string' }, description: 'Names of who took part' }, notes: { type: 'string' } }, ['title', 'team']),
    run: async i => { const { row, added } = await T.logActivity(i); return { ...slim(row), people: i.people || [], added_people: added }; },
  },
  {
    name: 'set_goal',
    description: 'Change one of the user\'s goals.',
    input_schema: obj({ goal: { type: 'string', enum: ['monthlyBudget', 'dailyStudyMin', 'dailyCalories', 'dailyProtein'] }, value: { type: 'number' } }, ['goal', 'value']),
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
export const WRITE_TOOLS = new Set(['log_feeling', 'log_weight', 'log_workout', 'add_person', 'log_team_activity', 'log_cetele', 'set_cetele_item', 'complete_lesson', 'grade_card', 'record_test_result', 'save_week_lessons', 'log_practice', 'add_roadmap_milestones', 'complete_milestone', 'add_expense', 'delete_expense', 'add_meeting', 'update_meeting', 'delete_meeting', 'log_study', 'log_meal', 'add_task', 'complete_task', 'set_goal']);

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
    case 'log_cetele': return `Çetele · ${input.item}${input.done !== undefined ? (input.done ? ' done' : ' cleared') : input.set !== undefined ? ` = ${input.set}` : ` +${input.add ?? 1}`}`;
    case 'set_cetele_item': return input.remove ? `Removed ${input.name} from çetele` : `Çetele · ${input.name}: ${input.target ?? ''} ${input.unit ?? ''} per ${input.per || 'day'}`.replace(/\s+/g, ' ');
    case 'log_workout': return `Training done${input.session ? ` · ${TR.SESSIONS[input.session]?.name || ''}` : ''}`;
    case 'log_feeling': return `Feeling ${input.feel}${input.note ? ` · ${input.note}` : ''}`;
    case 'log_weight': return `Weight ${input.kg} kg${input.waist_cm ? ` · waist ${input.waist_cm} cm` : ''}`;
    case 'add_person': return `${input.name} added to ${T.TEAMS[input.team] || 'Students'}`;
    case 'log_team_activity': return `Logged “${input.title}”${input.place ? ` at ${input.place}` : ''}${input.people?.length ? ` · ${input.people.length} people` : ''}`;
    case 'add_expense': return `Added ${input.amount} · ${input.category}${input.note ? ` · ${input.note}` : ''}`;
    case 'add_meeting': return `Scheduled “${input.title}” · ${String(input.start).replace('T', ' ')}`;
    case 'update_meeting': return 'Updated a meeting';
    case 'delete_meeting': return 'Removed a meeting';
    case 'delete_expense': return 'Removed an expense';
    case 'log_study': return `Logged ${input.minutes} min of ${input.subject}`;
    case 'log_meal': return `Logged ${input.name} · ${input.calories} kcal`;
    case 'add_task': return `Task: ${input.title}`;
    case 'complete_task': return 'Completed a task';
    case 'add_roadmap_milestones': return `Roadmap: +${input.milestones?.length || 0} milestones in ${input.subject}`;
    case 'complete_milestone': return input.done === false ? 'Milestone reopened' : 'Milestone done';
    case 'log_practice': return `Practice +${input.problems || 0} problems, +${input.anki_reviews || 0} card reviews`;
    case 'set_goal': return `Goal ${input.goal} = ${input.value}`;
    case 'complete_lesson': return `Lesson complete${input.score != null ? ` · ${Math.round((input.score > 1 ? input.score / 100 : input.score) * 100)}%` : ''}`;
    case 'grade_card': return `Card: ${input.grade}`;
    case 'record_test_result': return `Week ${input.week} test saved`;
    case 'save_week_lessons': return `Week ${input.week}: ${input.lessons?.length || 0} lessons saved`;
    default: return null;
  }
}


