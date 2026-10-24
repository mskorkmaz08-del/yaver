// Course smoke test: phone (iPhone 13) and desktop (1440×900) with a faked clock.
// Run: serve the repo on :8765 (npx http-server -p 8765 -c-1 .), then `node tests/course-smoke.mjs`
// from a folder where `playwright` resolves. Exits 1 on any failed check.
import { chromium, devices } from 'playwright';

const base = process.env.YAVER_URL || 'http://localhost:8765/';
const shots = process.env.SHOTS || 'tests/shots';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
let failed = 0;
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ` · ${extra}` : ''}`); if (!ok) failed++; };

const sse = evs => evs.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const msgStart = { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } };
const toolTurn = (id, name, input) => [msgStart,
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }, { type: 'message_stop' }];
const textTurn = text => [msgStart,
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }, { type: 'message_stop' }];

async function newPage(opts, at) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block', timezoneId: 'Asia/Almaty', locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.location().url.includes('127.0.0.1:8787')) errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date(at) });
  await page.route('https://tile.openstreetmap.org/**', r => r.fulfill({ status: 204 }));
  return { ctx, page, errors };
}
const ready = page => page.waitForFunction(() => document.body.classList.contains('ready'));
const setTime = async (page, at) => { await page.clock.setSystemTime(new Date(at)); await page.reload(); await ready(page); await page.waitForTimeout(500); };
const ev = (page, fn, arg) => page.evaluate(fn, arg);

// ================= Phone =================
{
  const { page, errors } = await newPage(devices['iPhone 13'], '2026-10-15T09:00:00+05:00');
  // Claude: get_course_today, then complete_lesson on the first lesson slot it returned.
  const claudeCalls = [];
  await page.route('https://api.anthropic.com/**', async route => {
    const body = route.request().postDataJSON();
    const last = body.messages.at(-1);
    const result = Array.isArray(last.content) && last.content.find(b => b.type === 'tool_result');
    let evs;
    if (!result) evs = toolTurn('toolu_a', 'get_course_today', {});
    else if (claudeCalls.length === 1) {
      const out = JSON.parse(typeof result.content === 'string' ? result.content : result.content[0].text);
      const slot = out.slots.find(s => s.lessonId);
      evs = toolTurn('toolu_b', 'complete_lesson', { lessonId: slot.lessonId, minutes: 90, score: 0.8 });
    } else evs = textTurn('Done: lesson completed, cards scheduled for tomorrow.');
    claudeCalls.push(result ? 'result' : 'ask');
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(evs) });
  });
  const gemCalls = [];
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    const url = route.request().url();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET,POST' } });
    if (url.includes('/models?')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
    const body = route.request().postDataJSON();
    gemCalls.push(body);
    const isResult = body.contents.at(-1).parts.some(p => p.functionResponse);
    const chunk = isResult
      ? { candidates: [{ content: { role: 'model', parts: [{ text: 'Today is a setup day.' }] }, finishReason: 'STOP' }] }
      : { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_course_today', args: {} } }] }, finishReason: 'STOP' }] };
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify(chunk)}\r\n\r\n` });
  });

  await page.goto(base);
  await ready(page);
  await ev(page, async () => { const db = await import('./js/db.js'); await db.setSetting('onboarded', true); await db.setSetting('userName', 'Mustafa'); });
  await page.goto(base + '#study');
  await page.reload();
  await ready(page);
  await page.waitForSelector('[data-start-course]');
  await page.click('[data-start-course]');
  await page.waitForTimeout(500);
  let s = await ev(page, async () => { const C = await import('./js/course.js'); const d = C.day(); return { active: C.active(), week: d.week, slots: d.slots.map(x => x.lesson?.id || x.id) }; });
  check(s.active && s.week === 0, 'Oct 15 is Week 0 and the course is active', JSON.stringify(s.slots));
  check(await page.isVisible('.today-card'), 'Study shows the Today card');
  await page.screenshot({ path: `${shots}/c1-phone-week0.png`, fullPage: true });

  // Gemini: the assistant can call a course tool
  await ev(page, async () => { const db = await import('./js/db.js'); await db.setSetting('geminiKey', 'AIzaSyTest00000000000000000000000000000'); await db.setSetting('provider', 'gemini'); });
  await page.click('#fab');
  await page.fill('[data-input]', 'what is on today?');
  await page.click('[data-send]');
  await page.waitForFunction(() => document.querySelector('.chat-wrap:not(.busy)') && /setup day/.test(document.querySelector('.msg.bot:last-child')?.textContent || ''), null, { timeout: 10000 });
  const gTools = gemCalls[0].tools[0].functionDeclarations.map(f => f.name);
  check(['get_course_today', 'get_lesson', 'complete_lesson', 'get_review_cards', 'grade_card', 'get_course_progress', 'record_test_result', 'save_week_lessons'].every(n => gTools.includes(n)), 'Gemini gets all 8 course tools');
  check(gemCalls[1]?.contents.at(-1).parts[0].functionResponse?.response && JSON.stringify(gemCalls[1].contents.at(-1).parts[0].functionResponse.response).includes('"week":0'), 'Gemini get_course_today returns Week 0');
  await page.click('[data-new]');
  await page.click('[data-close]').catch(() => page.keyboard.press('Escape'));

  // Tuesday of Week 1, 06:00
  await setTime(page, '2026-10-20T06:00:00+05:00');
  s = await ev(page, async () => { const C = await import('./js/course.js'); const d = C.day(); return { week: d.week, phase: d.phase, slots: d.slots.filter(x => x.type !== 'info').map(x => `${x.start} ${x.id} ${x.lesson?.id || x.special || x.type}`) }; });
  console.log('     Tue 2026-10-20:', s.slots.join(' | '));
  check(s.week === 1 && s.phase === 'A', 'Tue Oct 20 is Week 1, phase A');
  const lessonSlots = await ev(page, async () => { const C = await import('./js/course.js'); return C.day().slots.filter(x => x.lesson).map(x => x.lesson.id); });
  check(lessonSlots.length >= 3, 'Tuesday has at least three lesson slots', lessonSlots.join(', '));
  await page.screenshot({ path: `${shots}/c2-phone-tuesday.png`, fullPage: true });

  // Open the first lesson from the Today card, start the timer
  await page.click('.today-card .slot[data-open]');
  await page.waitForSelector('.lesson-grid');
  check((await page.$$('.step')).length >= 4, 'Lesson runner shows the steps');
  await page.click('[data-start]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/c3-phone-lesson.png`, fullPage: true });

  // Mastery: 4/5 is done; 2/5 flags the lesson and it lands in Friday's buffer
  const m = await ev(page, async ids => {
    const C = await import('./js/course.js');
    const a = await C.completeLesson({ lessonId: ids[0], minutes: 90, score: 0.8 });
    const b = await C.completeLesson({ lessonId: ids[1], minutes: 90, score: 0.4 });
    const fri = C.day('2026-10-23').slots.find(x => x.special === 'buffer');
    return { a: C.status(ids[0]), b: C.status(ids[1]), aMastered: a.mastered, buffer: fri?.lesson?.id, flaggedId: ids[1] };
  }, lessonSlots);
  check(m.a === 'done' && m.aMastered, '4/5 on the exit ticket is mastered');
  check(m.b === 'flagged', '2/5 flags the lesson');
  check(m.buffer === m.flaggedId, 'Flagged lesson takes Friday\'s buffer slot', `${m.buffer}`);

  // Cards: due tomorrow; grading moves the due date
  const c = await ev(page, async () => {
    const C = await import('./js/course.js'); const db = await import('./js/db.js');
    const card = db.all('cards')[0];
    const before = card.due;
    const g = await C.gradeCard(card.id, 'good');
    const again = await C.gradeCard(card.id, 'again');
    return { n: db.all('cards').length, before, good: g.due, box: g.box, againDue: again.due, againBox: again.box };
  });
  check(c.n >= 3 && c.before === '2026-10-21', 'Completed lessons add review cards due tomorrow', `${c.n} cards`);
  check(c.good > c.before && c.box === 1, 'Good moves the card to box 1 and later', c.good);
  check(c.againBox === 0 && c.againDue === '2026-10-21', 'Again sends it back to tomorrow');

  // Consolidation week 6, Sunday test and ship
  const w = await ev(page, async () => {
    const C = await import('./js/course.js');
    const mon6 = C.weekStartKey(6);
    const d6 = C.day(mon6);
    const sun = C.day('2026-10-25');
    return { cons: d6.consolidation, diag: d6.slots.some(x => x.diagnostic), sun: sun.slots.map(x => x.special || x.type) };
  });
  check(w.cons && w.diag, 'Week 6 is a consolidation week with the diagnostic retake');
  check(w.sun.includes('test') && w.sun.includes('ship'), 'Sunday shows the weekly test and ship', w.sun.join(','));

  // Sleep is protected
  const bad = await ev(page, async () => { const C = await import('./js/course.js'); return C.checkSlotTimes('weekday', { deep1: { start: '05:00', end: '06:30' } }); });
  check(!!bad, 'Slot times inside 22:30–05:30 are refused', bad);

  // Screens render
  for (const h of ['course', 'lesson/review', 'lesson/test', 'lesson/ship', 'home']) {
    await page.goto(base + '#' + h);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/c4-phone-${h.replace('/', '-')}.png`, fullPage: true });
    const wide = await ev(page, () => document.documentElement.scrollWidth > innerWidth + 1);
    check(!wide, `#${h} has no horizontal scroll on the phone`);
  }

  // Claude: get_course_today → complete_lesson
  await ev(page, async () => { const db = await import('./js/db.js'); await db.setSetting('apiKey', 'sk-ant-test'); await db.setSetting('provider', 'anthropic'); });
  await page.click('#fab');
  await page.fill('[data-input]', 'I finished my first lesson today, score 4 out of 5');
  await page.click('[data-send]');
  await page.waitForFunction(() => document.querySelector('.chat-wrap:not(.busy)') && /cards scheduled/.test(document.querySelector('.msg.bot:last-child')?.textContent || ''), null, { timeout: 10000 });
  check(claudeCalls.length === 3, 'Claude ran get_course_today then complete_lesson', claudeCalls.join(','));
  check(errors.length === 0, 'No console errors on the phone', errors.join(' | '));
}

// ================= Desktop 1440×900 =================
{
  const { page, errors } = await newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false }, '2026-10-20T06:00:00+05:00');
  await page.route('https://api.anthropic.com/**', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(textTurn('Let\'s start with the warm-up.')) }));
  await page.goto(base);
  await ready(page);
  await ev(page, async () => {
    const db = await import('./js/db.js'); const C = await import('./js/course.js');
    await db.setSetting('onboarded', true); await db.setSetting('apiKey', 'sk-ant-test'); await db.setSetting('provider', 'anthropic');
    await C.init(); await C.activate();
  });
  await page.reload();
  await ready(page);
  await page.waitForTimeout(500);
  const side = await ev(page, () => ({ w: document.querySelector('.tabbar').getBoundingClientRect().width, fab: getComputedStyle(document.querySelector('#fab')).display, ask: getComputedStyle(document.querySelector('.tabbar [data-ask]')).display }));
  check(side.w > 150 && side.w < 300 && side.fab === 'none' && side.ask !== 'none', 'Sidebar replaces the tab bar; Ask Yaver is a sidebar item', JSON.stringify(side));
  for (const h of ['home', 'study', 'course', 'calendar', 'money', 'diet', 'map', 'settings', 'lesson/review']) {
    await page.goto(base + '#' + h);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/d-${h.replace('/', '-')}.png`, fullPage: true });
    check(!(await ev(page, () => document.documentElement.scrollWidth > innerWidth + 1)), `#${h} has no horizontal scroll at 1440`);
  }
  // Lesson runner: two columns
  await page.goto(base + '#study');
  await page.waitForTimeout(400);
  await page.click('.today-card .slot[data-open]');
  await page.waitForSelector('.lesson-grid');
  const cols = await ev(page, () => getComputedStyle(document.querySelector('.lesson-grid')).gridTemplateColumns.split(' ').length);
  check(cols === 2, 'Lesson runner has two columns');
  // Keyboard: s starts the timer, ? opens the overlay
  await page.keyboard.press('s');
  await page.waitForTimeout(200);
  check(await ev(page, async () => !!(await import('./js/db.js')).setting('lessonTimer', null)), '"s" starts the lesson timer');
  await page.keyboard.press('Shift+Slash');
  check(await page.isVisible('.keys-wrap'), '"?" shows the shortcuts');
  await page.keyboard.press('Escape');
  check(!(await page.isVisible('.keys-wrap')) && (await ev(page, () => location.hash)).startsWith('#lesson/'), 'Esc closes the overlay and stays on the lesson');
  // Tutor me docks the chat as a third column
  await page.click('[data-tutor]');
  await page.waitForTimeout(600);
  const dock = await ev(page, () => ({ docked: document.body.classList.contains('lesson-docked') && document.body.classList.contains('chat-open'), mr: parseFloat(getComputedStyle(document.querySelector('.view')).marginRight), chatW: document.querySelector('.chat').getBoundingClientRect().width }));
  check(dock.docked && dock.mr >= 440 && dock.chatW < 500, 'Tutor me docks beside the lesson at 1440', JSON.stringify(dock));
  await page.screenshot({ path: `${shots}/d-lesson-docked.png` });
  await page.click('[data-close]').catch(() => {});
  // Review by keyboard
  await ev(page, async () => { const C = await import('./js/course.js'); const l = C.lesson(C.day().slots.find(s => s.lesson).lesson.id); await C.addCards(l, '2026-10-19'); });
  await page.goto(base + '#lesson/review');
  await page.waitForTimeout(400);
  const before = await ev(page, async () => (await import('./js/course.js')).dueCards().length);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  check(await page.isVisible('.flash .answer'), 'Space reveals the card');
  await page.keyboard.press('3');
  await page.waitForTimeout(300);
  const after = await ev(page, async () => (await import('./js/course.js')).dueCards().length);
  check(after === before - 1, '"3" grades the card Good', `${before} → ${after}`);
  await page.screenshot({ path: `${shots}/d-review.png` });
  check(errors.length === 0, 'No console errors on the desktop', errors.join(' | '));
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
