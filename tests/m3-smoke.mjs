// Yaver M III end to end: onboarding, building a study program in the four-step builder,
// the lessons and timetable it makes, adapting to results, the AI program tools, every
// screen on a phone, an iPad and a laptop in light and dark, and no console errors.
// Run with the site served on port 8765: node tests/m3-smoke.mjs  (SHOTS=1 saves screenshots)
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = 'http://localhost:8765/m3/';
const shots = process.env.SHOTS ? 'tests/shots/m3' : null;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };

async function open(device, { scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ ...device, serviceWorkers: 'block', colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/127\.0\.0\.1:8787|localhost:8787|ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text() + m.location().url)) errors.push('console: ' + m.text()); });
  return { ctx, page, errors };
}
const shot = async (page, name) => { if (shots) { await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/${name}.png` }); } };

// ---------- Phone: onboarding and the builder ----------
{
  const { ctx, page, errors } = await open(devices['iPhone 13']);
  await page.goto(base);
  await page.waitForSelector('.sheet h2');
  ok((await page.textContent('.sheet h2')).includes('Welcome'), 'onboarding sheet shows');
  await page.fill('input[name=userName]', 'Deniz');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.preset-grid');
  ok(await page.evaluate(() => location.hash) === '#program/new', 'onboarding opens the program builder');
  await shot(page, 'phone-builder-1');
  ok(await page.locator('.tabbar').isHidden(), 'tab bar hides while building');

  // step 1: a preset and a goal
  await page.click('[data-preset="language"]');
  await page.fill('input[name=goal]', 'Order food and chat in Spanish by summer');
  await page.fill('input[name=title]', 'Spanish');
  await page.click('[data-next]');
  await page.waitForSelector('.subj');
  ok(await page.locator('.subj').count() === 3, 'the language preset fills three subjects');
  // step 2: change a subject, add one
  const first = page.locator('.subj').first();
  await first.locator('[name="level-0"][value="some"]').check({ force: true });
  await first.locator('[name="prio-0"][value="3"]').check({ force: true });
  await page.click('[data-add-subj]');
  const last = page.locator('.subj').last();
  await last.locator('.subj-name').fill('Culture');
  await last.locator('textarea[data-f="topics"]').fill('Food and festivals\nFilms to watch\nSlang');
  await shot(page, 'phone-builder-2');
  await page.click('[data-next]');
  await page.waitForSelector('.day-pick');
  // step 3: Mon, Wed, Fri, Sat; two sessions of 25 minutes; a timetable
  // Tap the visible labels, as a person would: this also fails if anything covers them.
  const tap = sel => page.locator(`label:has(> ${sel})`).click();
  const want = [true, false, true, false, true, true, false];
  for (let d = 0; d < 7; d++) if ((await page.locator(`.day-pick [value="${d}"]`).isChecked()) !== want[d]) await tap(`[name=day][value="${d}"]`);
  await tap('[name=perDay][value="2"]');
  await page.waitForSelector('[name=time1]');
  await tap('[name=minutes][value="25"]');
  await tap('[name=pacing][value="schedule"]');
  ok(await page.locator('[name=pacing][value="schedule"]').isChecked() && await page.locator('[name=minutes][value="25"]').isChecked(), 'schedule choices take a tap');
  await page.waitForTimeout(100);
  await shot(page, 'phone-builder-3');
  await page.click('[data-next]');
  await page.waitForSelector('.summary-card');
  ok((await page.textContent('.summary-card')).includes('8 sessions a week of 25 min'), 'summary counts 8 sessions of 25 min');
  await shot(page, 'phone-builder-4');
  await page.click('[data-save]');
  await page.waitForFunction(() => location.hash === '#study');

  const prog = await page.evaluate(async () => { const P = await import('./js/program.js'); return P.get(); });
  ok(prog.title === 'Spanish' && prog.subjects.length === 4 && prog.perDay === 2 && prog.minutes === 25, 'program saved with 4 subjects, 2 × 25 min');
  ok(prog.days.join() === 'true,false,true,false,true,true,false', 'study days Mon Wed Fri Sat');
  ok(prog.subjects[0].level === 'some' && prog.subjects[0].priority === 3, 'level and priority saved');

  // the engine: lessons from topics, a rotation for the week, the day's slots
  const eng = await page.evaluate(async () => {
    const C = await import('./js/course.js');
    const P = await import('./js/program.js');
    const p = P.get();
    const rot = P.buildRotation(p);
    const placed = Object.values(rot).flat().filter(Boolean);
    const per = {}; for (const id of placed) per[id] = (per[id] || 0) + 1;
    const mon = C.weekStartKey(Math.max(1, C.weekOf()));
    const d = C.day(mon);
    return { total: C.totals().total, placed: placed.length, per, high: p.subjects[0].id, slots: d.slots.map(s => s.type), next: C.upNext(3).map(l => l.id), sat: C.day(P.mondayOf ? p.start : mon) && P.slotsForDay(5, p).map(s => s.type) };
  });
  ok(eng.total === 8 + 7 + 6 + 3, `one lesson per topic (${eng.total})`);
  ok(eng.placed === 8, 'every session of the week gets a subject');
  ok(Object.keys(eng.per).length === 4, 'every subject gets at least one session');
  ok(eng.per[eng.high] === Math.max(...Object.values(eng.per)), 'the high-priority subject gets the most sessions');
  ok(eng.slots.filter(t => t === 'lesson').length === 2 && eng.slots.includes('review'), 'Monday has two sessions and review cards');
  ok(eng.sat.includes('test'), 'the weekly test is on the last study day');

  // Study screen: the timetable today card, then the program screen
  await page.waitForSelector('.today-card');
  await shot(page, 'phone-study');
  await page.click('[data-course]');
  await page.waitForSelector('.track-grid');
  ok(await page.locator('.track-tile').count() === 4, 'program screen shows four subjects');
  ok(await page.locator('.lesson-list .row').count() === 8, 'lesson list shows the first subject\'s 8 lessons');
  await shot(page, 'phone-program');

  // a starter lesson works without AI: steps, feel, complete with a low score
  await page.locator('.lesson-list .row').first().click();
  await page.waitForSelector('.lesson-main');
  ok(await page.locator('[data-write]').count() === 1, 'a starter lesson offers "Write this lesson with Yaver"');
  ok(await page.locator('.lesson-main [data-stepcard]').count() >= 4, 'the starter lesson has its steps');
  await shot(page, 'phone-lesson');
  const lessonId = await page.evaluate(() => decodeURIComponent(location.hash.split('/')[1]));
  const adapted = await page.evaluate(async id => {
    const C = await import('./js/course.js');
    const P = await import('./js/program.js');
    const sid = C.lesson(id).track;
    const before = P.weights()[sid].weight;
    await C.completeLesson({ lessonId: id, minutes: 25, score: 0.4, feel: 'hard' });
    const after = P.weights()[sid].weight;
    return { before, after, status: C.status(id), notes: P.adaptNotes().map(n => n.text), first: C.upNext(2).map(l => l.id) };
  }, lessonId);
  ok(adapted.status === 'flagged', 'a 40% exit ticket flags the lesson for another go');
  ok(adapted.after > adapted.before, `the subject gets more of the week after a weak, hard lesson (${adapted.before} → ${adapted.after.toFixed(2)})`);
  ok(adapted.notes.some(t => /more time/.test(t)), 'the program explains how it adapts');
  ok(adapted.first.includes(lessonId), 'the flagged lesson comes back up next');

  // the AI tools: read the program, change it, save a full lesson
  const tools = await page.evaluate(async id => {
    const T = await import('./js/ai/tools.js');
    const names = T.toolDefinitions.map(t => t.name);
    const read = await T.runTool('get_study_program', {});
    const set = await T.runTool('set_study_program', { subjects: [{ name: 'Culture', add_topics: ['Music'] }, { name: 'Vocabulary', topics: ['Greetings and introductions', 'Colours'] }], minutes: 45 });
    const C = await import('./js/course.js');
    const bad = await T.runTool('save_lessons', { lessons: [{ id, title: 'x', objectives: [], steps: [], cards: [] }] });
    const steps = [['warmup', 5], ['learn', 15], ['practice', 18], ['exit', 7]].map(([kind, minutes]) => ({ kind, minutes, title: kind, body: 'Body', ...(kind === 'exit' ? { questions: [1, 2, 3].map(n => ({ q: `Q${n}`, a: `A${n}` })) } : {}), ...(kind === 'practice' ? { tasks: [1, 2].map(n => ({ prompt: `Do ${n}`, check: 'ok' })) } : {}) }));
    const good = await T.runTool('save_lessons', { lessons: [{ id, title: 'Greetings, written', objectives: ['Greet', 'Introduce'], steps, cards: [1, 2, 3].map(n => ({ front: `F${n}`, back: `B${n}` })) }] });
    return { names, read: !!read.subjects, culture: C.laneLessons(read.subjects.find(s => s.name === 'Culture').id).length, vocab: set.program.subjects.find(s => s.name === 'Vocabulary').topics, vocabLessons: C.laneLessons(set.program.subjects.find(s => s.name === 'Vocabulary').id).length, minutes: set.program.minutesPerSession, bad: bad.saved, badErrors: bad.errors?.length, good: good.saved, written: !C.lesson(id).starter, title: C.lesson(id).title };
  }, lessonId);
  ok(['get_study_program', 'set_study_program', 'save_lessons'].every(n => tools.names.includes(n)) && !tools.names.includes('save_week_lessons') && !tools.names.includes('get_study_plan'), 'AI has the program tools, not M1\'s course tools');
  ok(tools.read && tools.culture === 4 && tools.minutes === 45, 'set_study_program adds a topic and changes the session length');
  ok(tools.vocab.join() === 'Greetings and introductions,Colours' && tools.vocabLessons === 2, 'set_study_program replaces a topic list');
  ok(tools.bad === false && tools.badErrors > 2, 'save_lessons rejects a broken lesson with errors to fix');
  ok(tools.good && tools.written && tools.title === 'Greetings, written', 'save_lessons stores a full lesson that replaces the starter');

  // nothing of M1's personal program is left
  const personal = await page.evaluate(async () => {
    const { STATIC_SYSTEM } = await import('./js/ai/claude.js');
    const CT = await import('./js/cetele.js');
    return { prompt: /Mustafa|AQL|robotics course he teaches|ML Engineer/.test(STATIC_SYSTEM), habits: CT.items().length, roadmap: await fetch('../data/ml-roadmap.json').then(() => 'reachable', () => 'none') };
  });
  ok(!personal.prompt, 'the assistant prompt has no personal details');
  ok(personal.habits === 0, 'habits start empty (the çetele set is offered, not forced)');

  // every screen draws
  for (const v of ['home', 'calendar', 'money', 'diet', 'cetele', 'body', 'teams', 'skills', 'settings', 'lesson/review', 'lesson/test', `lesson/mixed-${new Date().toISOString().slice(0, 10)}`, 'lesson/prepare-1']) {
    await page.evaluate(h => { location.hash = h; }, v);
    await page.waitForTimeout(250);
    const empty = await page.evaluate(() => document.querySelector('#view').children.length === 0);
    ok(!empty, `${v} draws`);
    if (['home', 'cetele', 'settings'].includes(v)) await shot(page, `phone-${v}`);
  }
  // More sheet
  await page.evaluate(() => { location.hash = 'home'; });
  await page.waitForTimeout(200);
  await page.click('.tabbar [data-more]');
  await page.waitForSelector('.more-grid');
  ok(await page.locator('.more-grid button').count() === 8, 'More holds the other eight sections');
  await shot(page, 'phone-more');
  await page.click('.more-grid [data-go="money"]');
  await page.waitForFunction(() => location.hash === '#money');
  ok(await page.locator('.tabbar [data-more].active').count() === 1, 'More stays lit on a section it holds');
  // habits preset
  await page.evaluate(() => { location.hash = 'cetele'; });
  await page.waitForSelector('[data-preset="health"]');
  await page.click('[data-preset="health"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(async () => (await import('./js/cetele.js')).items().length) === 4, 'a habit set can be added');
  // dark theme from Settings
  await page.evaluate(async () => { const db = await import('./js/db.js'); await db.setSetting('theme', 'dark'); await db.setSetting('accent', 'violet'); });
  await page.evaluate(() => { location.hash = 'home'; });
  await page.waitForTimeout(300);
  const theme = await page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.accent, getComputedStyle(document.body).backgroundColor]);
  ok(theme[0] === 'dark' && theme[1] === 'violet' && theme[2] === 'rgb(11, 13, 18)', 'dark theme and accent apply');
  await shot(page, 'phone-home-dark');
  ok(!errors.length, `phone: no console errors${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
  await ctx.close();
}

// ---------- iPad and laptop: the rail and the sidebar ----------
for (const [name, device, scheme] of [['ipad', devices['iPad Pro 11'], 'light'], ['ipad-landscape', devices['iPad Pro 11 landscape'], 'dark'], ['laptop', { viewport: { width: 1440, height: 900 } }, 'light'], ['laptop-dark', { viewport: { width: 1440, height: 900 } }, 'dark']]) {
  const { ctx, page, errors } = await open(device, { scheme });
  await page.goto(base);
  await page.waitForSelector('.sheet h2');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.preset-grid');
  await page.click('[data-preset="code"]');
  await page.click('[data-next]'); await page.click('[data-next]'); await page.click('[data-next]');
  await page.click('[data-save]');
  await page.waitForFunction(() => location.hash === '#study');
  const nav = await page.evaluate(() => { const t = document.querySelector('.tabbar').getBoundingClientRect(); return { w: t.width, h: t.height, left: t.left, more: getComputedStyle(document.querySelector('[data-more]')).display, fab: getComputedStyle(document.querySelector('#fab')).display, tabs: [...document.querySelectorAll('.tabbar [data-tab]')].filter(b => b.offsetParent).length }; });
  const wide = (device.viewport?.width || 0) >= 1100;
  ok(nav.left === 0 && nav.h >= 600 && nav.w === (wide ? 248 : 88), `${name}: navigation is a ${wide ? 'sidebar' : 'rail'} (${nav.w}px)`);
  ok(nav.more === 'none' && nav.fab === 'none' && nav.tabs === 11, `${name}: every section in the ${wide ? 'sidebar' : 'rail'}, no More or floating button`);
  await shot(page, `${name}-study`);
  for (const v of ['home', 'course']) {
    await page.evaluate(h => { location.hash = h; }, v);
    await page.waitForTimeout(300);
    await shot(page, `${name}-${v}`);
  }
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('#view')).gridTemplateColumns.split(' ').length);
  ok(cols >= 2, `${name}: the program screen uses ${cols} columns`);
  await page.evaluate(() => { location.hash = 'lesson/' + document.querySelector('[data-lesson]').dataset.lesson; });
  await page.waitForSelector('.lesson-main');
  await shot(page, `${name}-lesson`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `${name}: no sideways scrolling`);
  ok(!errors.length, `${name}: no console errors${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
  await ctx.close();
}

// ---------- Phone: no sideways scrolling on any screen ----------
{
  const { ctx, page } = await open(devices['iPhone SE']);
  await page.goto(base);
  await page.waitForSelector('.sheet h2');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.preset-grid');
  await page.click('[data-preset="exam"]');
  for (let i = 0; i < 3; i++) await page.click('[data-next]');
  await page.click('[data-save]');
  await page.waitForFunction(() => location.hash === '#study');
  const wide = [];
  for (const v of ['home', 'study', 'course', 'calendar', 'money', 'diet', 'cetele', 'body', 'teams', 'skills', 'settings', 'program/edit']) {
    await page.evaluate(h => { location.hash = h; }, v);
    await page.waitForTimeout(250);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 1) wide.push(`${v} (+${o}px)`);
  }
  ok(!wide.length, `small phone: no screen scrolls sideways${wide.length ? `: ${wide.join(', ')}` : ''}`);
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
