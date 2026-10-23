// One path, no guessing: recall only asks about finished lessons, the first example
// shows its result, every question offers "don't know yet", and algorithm lessons list
// optional LeetCode problems. Run with the repo served on :8765, from a folder where
// `playwright` resolves. Exits 1 on any failed check.
import { chromium, devices } from 'playwright';

const base = process.env.YAVER_URL || 'http://localhost:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
let failed = 0;
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ` · ${extra}` : ''}`); if (!ok) failed++; };

const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block', timezoneId: 'Asia/Almaty', locale: 'en-US' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.clock.install({ time: new Date('2026-10-20T09:00:00+05:00') });
const prompts = [];
await page.route('https://generativelanguage.googleapis.com/**', async route => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET,POST' } });
  if (route.request().url().includes('/models?')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) });
  const body = route.request().postDataJSON?.() || {};
  const last = body.contents?.at(-1)?.parts?.map(p => p.text || '').join('') || '';
  if (last) prompts.push(last);
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Here is how it works.' }] }, finishReason: 'STOP' }] })}\n\n` });
});
const ev = (fn, arg) => page.evaluate(fn, arg);
const open = async id => { await page.goto(base + '#lesson/' + id); await page.waitForSelector('.lesson-grid'); await page.waitForTimeout(300); };

await page.goto(base);
await page.waitForFunction(() => document.body.classList.contains('ready'));
await ev(async () => {
  const db = await import('./js/db.js');
  await db.setSetting('onboarded', true);
  await db.setSetting('geminiKey', 'AIzaSyTest00000000000000000000000000000');
  await db.setSetting('provider', 'gemini');
});
await page.reload(); // past the welcome sheet
await page.waitForFunction(() => document.body.classList.contains('ready'));
await ev(async () => (await import('./js/course.js')).init()); // all week files loaded

// python-w01-2's recall questions come from earlier lessons. Nothing finished yet: all skipped.
const sources = await ev(async () => {
  const C = await import('./js/course.js');
  return C.lesson('python-w01-2').steps.find(s => s.kind === 'warmup').questions.map(q => q.from);
});
check(sources.length > 0 && sources.every(Boolean), 'every recall question names the lesson it comes from', sources.join(', '));
await open('python-w01-2');
let warm = await page.textContent('[data-stepcard="1"]');
check(/skipped: (it comes|they come) from a lesson you haven't done yet/.test(warm), 'recall skips questions from unfinished lessons', warm.slice(0, 160));
check(/Nothing to recall yet/.test(warm), 'with nothing finished, recall says so instead of asking');

// Finish the source lessons: their questions appear, each labelled with its lesson.
await ev(async srcs => {
  const C = await import('./js/course.js');
  const db = await import('./js/db.js');
  for (const id of new Set(srcs)) await C.completeLesson({ lessonId: id, minutes: 90, score: 1 });
  for (const c of db.all('cards')) await db.put('cards', { ...c, due: '2030-01-01' }); // keep review cards out of the warm-up
}, sources);
await open('python-w01-2');
warm = await page.textContent('[data-stepcard="1"]');
const firstTitle = await ev(async id => (await import('./js/course.js')).lesson(id).title, sources[0]);
check(warm.includes(`from ${firstTitle}`) && !/skipped/.test(warm), 'finished lessons\' questions show, with "from <lesson>"', warm.slice(0, 160));

// "don't know yet" shows the answer and offers a lesson, no guess needed.
await page.click('[data-stepcard="1"] [data-unknown="0-0"]');
await page.waitForTimeout(200);
check(await page.isVisible('[data-stepcard="1"] .answer'), '"don\'t know yet" reveals the answer');
await page.click('[data-stepcard="1"] [data-teach="0-0"]');
await page.waitForTimeout(800);
check(await page.isVisible('.chat'), '"teach me this" opens the tutor');
check(prompts.some(p => /Teach it to me from the beginning/.test(p) && p.includes(firstTitle)), 'the tutor is asked to teach it from scratch', prompts.at(-1)?.slice(0, 120));
await page.click('[data-close]').catch(() => {});

// The first example shows its result and never asks for a guess.
const ex = await page.textContent('[data-stepcard="2"]');
check(/first example/i.test(ex) && /It prints|Result/.test(ex) && !/\bpredict\b/i.test(ex), 'the first example shows its result instead of asking to predict', ex.slice(0, 120));

// On the exit ticket, "don't know yet" counts as wrong.
const exitIdx = await ev(async () => (await import('./js/course.js')).lesson('python-w01-2').steps.findIndex(s => s.kind === 'exit'));
await page.click(`[data-unknown="${exitIdx}-0"]`);
await page.waitForTimeout(200);
const score = await page.textContent('[data-score]');
check(/0\/\d+ right · 1\/\d+ marked/.test(score), '"don\'t know yet" on the exit ticket marks it wrong', score);

// The tutor's rules forbid asking for guesses.
await page.click('[data-tutor]');
await page.waitForTimeout(800);
check(prompts.some(p => /Never ask me to predict or guess/.test(p)), 'Tutor me tells the AI never to ask for a guess');
await page.click('[data-close]').catch(() => {});

// Optional LeetCode problems on an algorithm lesson.
await open('algo-w01-1');
const lc = await page.$$eval('a[href^="https://leetcode.com/problems/"]', as => as.map(a => a.textContent.trim()));
check(lc.length === 2 && lc[0].includes('Binary Search'), 'algo-w01-1 lists its LeetCode problems', lc.join(' | '));
await page.click('[data-lc="binary-search"][data-v="solved"]');
await page.waitForTimeout(300);
const saved = await ev(async () => (await import('./js/db.js')).setting('leetcode', {}));
check(saved['binary-search']?.state === 'solved' && await page.isVisible('[data-lc="binary-search"][data-v="solved"].on'), 'marking solved is saved and shown', JSON.stringify(saved));
await page.click('[data-lc-explain="0"]');
await page.waitForTimeout(800);
check(prompts.some(p => /I solved it\. Go through it with me/.test(p) && p.includes('binary-search')), '"go through it with Yaver" sends a solved walk-through prompt');

check(errors.length === 0, 'no page errors', errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
