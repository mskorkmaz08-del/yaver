// The lesson runner, plus the other course "sessions": evening review cards,
// the Sunday test and ship checklist, the diagnostic retake and Prepare week N.
// One timer per lesson, stored as a start time so closing the app loses nothing.
import * as C from '../course.js';
import * as db from '../db.js';
import { html, raw, mdDoc, toast, haptic, sheet, today, addDays, saveFile, mins, esc } from '../util.js';
import { icon } from '../icons.js';
import { openAssistant } from '../ai/assistant.js';
import { dotColor, exportWeek } from './course.js';
import { stepStrip, roman, stopwatch } from '../ui.js';
import { stepName } from './home.js';
import { simHTML, mountSim } from '../sims.js';
import * as sound from '../sound.js';
import { enterFocus, exitFocus, inFocus } from '../focus.js';

let tick;
let state = {}; // per-render UI state that isn't worth storing: revealed answers, marks
let keyHandler = null;

function stop() {
  clearInterval(tick);
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
}
// Leaving the lesson undocks the tutor; a redraw of the same lesson keeps it docked.
export function cleanup() {
  stop();
  document.body.classList.remove('lesson-docked');
}

export function render(root, go, arg) {
  stop();
  if (!C.ready()) { root.innerHTML = '<p class="muted small">Loading the course…</p>'; return; }
  if (state.arg !== arg) state = { arg, revealed: {}, marks: {}, hints: {}, answers: {}, unknown: {}, i: 0, flipped: false };
  if (arg === 'review') return review(root, go);
  if (arg === 'test') return weeklyTest(root, go);
  if (arg === 'ship') return ship(root, go);
  if (arg === 'flagged') return flaggedTasks(root, go);
  if (arg === 'diagnostic') { const l = C.laneLessons('setup').find(x => x.kind === 'diagnostic'); return l ? lessonView(root, go, l, { retake: C.status(l.id) === 'done' }) : go('course'); }
  if (arg?.startsWith('prepare-')) return prepare(root, go, Number(arg.slice(8)));
  const l = C.lesson(arg);
  if (!l) { root.innerHTML = html`<p class="muted">No lesson called ${arg}.</p><button class="btn ghost" data-back>Back</button>`; root.querySelector('[data-back]').onclick = () => go('study'); return; }
  lessonView(root, go, l);
}

const head = (path, title, sub = '') => html`
  <header class="page-head">
    <div><p class="path">Yaver <b>·</b> course <b>·</b> ${path}</p><h1 class="lesson-h1">${title}</h1>${raw(sub)}</div>
    <button class="icon-btn" data-back aria-label="Back">${raw(icon('close'))}</button>
  </header>`;

function onKeys(map) {
  keyHandler = e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (document.querySelector('.sheet-wrap') || document.body.classList.contains('chat-open') && !document.body.classList.contains('lesson-docked')) return;
    const fn = map[e.key] || map[e.key.toLowerCase()];
    if (fn) { e.preventDefault(); fn(); }
  };
  document.addEventListener('keydown', keyHandler);
}

// ---------- Lesson ----------
const timerFor = id => { const t = db.setting('lessonTimer', null); return t?.lessonId === id ? t : null; };

function stepMarks(l) {
  let at = 0;
  return (l.steps || []).map(s => { const r = { ...s, from: at, to: at + (s.minutes || 0) }; at += s.minutes || 0; return r; });
}

function lessonView(root, go, l, { retake = false } = {}) {
  const p = C.progress(l.id) || {};
  const t = timerFor(l.id);
  const steps = stepMarks(l);
  const doneSteps = new Set(p.stepsDone || []);
  const st = C.status(l.id);
  const diag = l.kind === 'diagnostic';
  const tb = l.track === 'robo' ? C.teachBy(l) : null;

  const side = html`
    <aside class="lesson-side">
      <section class="card timer ${raw(t ? 'running' : '')}">
        <div class="card-head"><p class="label">timer</p><span class="small mono muted">${l.minutes} min planned</span></div>
        ${raw(stopwatch(steps, l.minutes))}
        <div class="focus-sub" data-now>${t ? '' : st === 'done' ? 'completed' : 'not started'}</div>
        <div class="btn-row">${raw(t ? html`<button class="btn ghost" data-stop-timer>Pause</button>` : html`<button class="btn primary" data-start>${st === 'in progress' ? 'Resume' : 'Start'}</button>`)}<button class="btn ghost" data-focus>${raw(icon('target'))} Focus</button></div>
      </section>
      <section class="card desk-only">
        <p class="label">steps</p>
        ${raw(steps.map((s, i) => html`<label class="task ${raw(doneSteps.has(i) ? 'done' : '')}"><input type="checkbox" data-step="${i}" ${raw(doneSteps.has(i) ? 'checked' : '')}><span>${s.title}</span><small>${s.minutes}m</small></label>`).join(''))}
      </section>
      <section class="card">
        <p class="label">notes</p>
        <textarea data-notes rows="3" placeholder="What tripped you up, what to remember…">${p.notes || ''}</textarea>
      </section>
      <div class="btn-row wrap">
        <button class="btn ghost" data-tutor>${raw(icon('sparkle'))} Tutor me</button>
        <button class="btn primary" data-complete>${raw(icon('check'))} ${retake ? 'Save retake' : st === 'done' ? 'Complete again' : 'Complete'}</button>
      </div>
      <p class="small dim mono desk-only">keys: s timer · f focus · n next step · h hint · t tutor · esc back · ? all</p>
    </aside>`;

  // A running simulator survives redraws of the same lesson (a data change redraws the screen).
  const oldSim = root.querySelector(`.sim-card[data-lesson="${CSS.escape(l.id)}"]`);
  root.innerHTML = html`
    ${raw(head(`wk ${l.week ?? ''}`, l.title, html`<p class="small muted mono lesson-meta"><span class="dot" style="background:${raw(dotColor(l.track))}"></span>${l.track === 'mixed' ? 'mixed' : C.trackName(l.track)} · ${l.minutes} min · ${st}${raw(p.score != null ? ` · ${Math.round(p.score * 100)}%` : '')}${raw(tb ? ` · <span class="${C.deadlines(7).some(d => d.lessonId === l.id) ? 'bad' : ''}">teach by ${esc(tb)}</span>` : '')}</p>`))}
    <div class="lesson-bar ${raw(t ? 'running' : '')}">
      <span class="lb-clock"><svg viewBox="-12 -13 24 25" aria-hidden="true"><rect x="-2" y="-13" width="4" height="3" rx=".8"/><circle r="9.5"/><path d="M0 0V-6.5" data-hand2/></svg><b data-clock2>${t ? '' : '00:00'}</b><small>/ ${l.minutes} min</small></span>
      ${raw(t ? html`<button class="btn ghost" data-stop-timer>Pause</button>` : html`<button class="btn primary" data-start>${st === 'in progress' ? 'Resume' : 'Start'}</button>`)}
      <button class="btn ghost" data-focus aria-label="Focus mode">${raw(icon('target'))}</button>
    </div>
    <div class="lesson-grid">
      <article class="lesson-main">
        ${raw(steps.length ? stepStrip(steps.map(stepName), doneSteps, { current: steps.findIndex((_, i) => !doneSteps.has(i)), jump: true, names: true }) : '')}
        <section class="card">
          <p class="label">objectives</p>
          <ul class="objectives">${raw((l.objectives || []).map(o => html`<li>${o}</li>`).join(''))}</ul>
          ${raw(l.resources?.length ? html`<p class="label">resources</p><div class="resources">${raw(l.resources.map(r => html`<a href="${r.url}" target="_blank" rel="noopener" class="res">${raw(icon('external'))}<span><b>${r.title}</b>${raw(r.part ? html`<small>${r.part}</small>` : '')}</span></a>`).join(''))}</div>` : '')}
          ${raw(l.safety ? html`<p class="small safety">${raw(icon('bolt'))} ${l.safety}</p>` : '')}
        </section>
        ${raw(simHTML(l))}
        ${raw(steps.map((s, i) => stepHTML(l, s, i, doneSteps.has(i))).join(''))}
        ${raw(leetcodeHTML(l))}
        ${raw(l.deliverable ? html`<section class="card"><p class="label">deliverable</p><p class="small">${l.deliverable}</p></section>` : '')}
      </article>
      ${raw(side)}
    </div>`;

  // --- wiring ---
  const simCard = root.querySelector('.sim-card');
  if (simCard) {
    simCard.dataset.lesson = l.id;
    if (oldSim) simCard.replaceWith(oldSim); else mountSim(simCard, l);
  }
  root.querySelector('[data-back]').onclick = () => go('study');
  root.querySelectorAll('[data-jump]').forEach(b => (b.onclick = () => root.querySelector(`[data-stepcard="${b.dataset.jump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  const notes = root.querySelector('[data-notes]');
  notes.onchange = () => db.put('courseProgress', { ...(C.progress(l.id) || { id: l.id, lessonId: l.id, status: 'in progress' }), notes: notes.value });
  const startTimer = async () => { await C.startLesson(l.id); haptic(); askNotify(); };
  root.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', startTimer));
  root.querySelectorAll('[data-stop-timer]').forEach(b => b.addEventListener('click', () => db.setSetting('lessonTimer', null)));
  // Focus: only the lesson paper and a small timer stay on screen.
  const focus = async () => {
    if (!timerFor(l.id)) await startTimer();
    enterFocus({ mode: 'lesson', title: l.title, planned: l.minutes, start: () => timerFor(l.id)?.start ?? null });
    // open at the step you're on, not wherever the timer card was
    const i = Math.max(0, steps.findIndex((_, k) => !doneSteps.has(k)));
    requestAnimationFrame(() => document.querySelector(`[data-stepcard="${i + 1}"]`)?.scrollIntoView({ block: 'start' }));
  };
  root.querySelectorAll('[data-focus]').forEach(b => (b.onclick = focus));
  const markStep = async (i, on = true) => {
    const cur = C.progress(l.id) || { id: l.id, lessonId: l.id, status: 'in progress' };
    const set = new Set(cur.stepsDone || []);
    on ? set.add(i) : set.delete(i);
    haptic();
    await db.put('courseProgress', { ...cur, stepsDone: [...set] });
  };
  root.querySelectorAll('[data-step]').forEach(cb => (cb.onchange = () => markStep(Number(cb.dataset.step), cb.checked)));
  root.querySelectorAll('[data-step-done]').forEach(b => (b.onclick = () => markStep(Number(b.dataset.stepDone), !doneSteps.has(Number(b.dataset.stepDone)))));
  bindStepContent(root, l);
  const tutor = () => tutorMe(l, currentStep(l, steps));
  root.querySelector('[data-tutor]').onclick = tutor;
  root.querySelector('[data-complete]').onclick = () => complete(l, root, go, { retake, diag });

  onKeys({
    s: () => (timerFor(l.id) ? db.setSetting('lessonTimer', null) : startTimer()),
    n: () => { const i = steps.findIndex((_, k) => !doneSteps.has(k)); if (i >= 0) { markStep(i); setTimeout(() => document.querySelector(`[data-stepcard="${i + 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); } },
    h: () => root.querySelector('[data-hint]:not([disabled])')?.click(),
    t: tutor,
    f: focus,
    Escape: () => (inFocus() ? exitFocus() : go('study')),
  });

  if (t) {
    const clock = root.querySelector('[data-clock]');
    const now = root.querySelector('[data-now]');
    const hand = root.querySelector('[data-hand]'), fill = root.querySelector('[data-fill]');
    const clock2 = root.querySelector('[data-clock2]'), hand2 = root.querySelector('[data-hand2]');
    const update = () => {
      const sec = Math.floor((Date.now() - t.start) / 1000);
      clock.textContent = clock2.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      hand2?.setAttribute('transform', `rotate(${(sec % 60) * 6})`);
      const m = sec / 60;
      // the hand sweeps (its angle only grows, so the transition never spins backwards)
      hand.style.transform = `rotate(${sec * 6}deg)`;
      const C2 = 2 * Math.PI * 45;
      fill.setAttribute('stroke-dasharray', `${Math.min(1, m / l.minutes) * C2} ${C2}`);
      root.querySelectorAll('[data-seg]').forEach(g => g.classList.toggle('on', steps[g.dataset.seg] && m >= steps[g.dataset.seg].from && m < steps[g.dataset.seg].to));
      const cur = steps.find(s => m >= s.from && m < s.to);
      now.textContent = cur ? `${cur.title} · ${Math.ceil(cur.to - m)} min left in step` : `${l.minutes} min done · complete when ready`;
      if (Math.abs(sec - l.minutes * 60) < 1) notify(`${l.title}: ${l.minutes} minutes done.`);
    };
    update();
    tick = setInterval(update, 1000);
  }
}

function currentStep(l, steps) {
  const t = timerFor(l.id);
  const done = new Set(C.progress(l.id)?.stepsDone || []);
  if (t) { const m = (Date.now() - t.start) / 60000; const s = steps.find(x => m >= x.from && m < x.to); if (s) return s; }
  return steps.find((_, i) => !done.has(i)) || steps[0];
}

const STEP_ICON = { warmup: 'clock', example: 'target', learn: 'book', practice: 'terminal', exit: 'check', reflect: 'edit', read: 'book', summary: 'edit', cards: 'check', plan: 'target', build: 'terminal', test: 'check', log: 'edit', simulate: 'bolt', measure: 'bolt', teachnotes: 'edit', handout: 'edit' };

const STEP_LABEL = { warmup: 'recall', example: 'first example' };

function stepHTML(l, s, i, done) {
  let inner = '';
  if (s.body) inner += mdDoc(s.body);
  if (s.kind === 'warmup') inner += warmupHTML(l, s, i);
  else if (s.questions?.length) inner += questionsHTML(s, i, s.kind === 'exit');
  if (s.tasks?.length) inner += s.tasks.map((t, j) => taskHTML(l, t, `${i}-${j}`, l.kind === 'diagnostic')).join('');
  if (s.teachBack) inner += html`<div class="teachback"><p class="label">teach back</p><p class="small">${s.teachBack}</p><textarea rows="3" data-answer="${i}-tb" placeholder="Three sentences for a first-year student…">${state.answers[`${i}-tb`] || ''}</textarea></div>`;
  return html`
    <section class="card step ${raw(done ? 'done' : '')}" data-stepcard="${i + 1}">
      <div class="card-head">
        <p class="label">${raw(icon(STEP_ICON[s.kind] || 'book'))} ${roman(i + 1)} · ${STEP_LABEL[s.kind] || s.kind} · ${s.minutes} min</p>
        <button class="step-check ${raw(done ? 'on' : '')}" data-step-done="${i}" aria-label="Mark step done">${raw(icon('check'))}</button>
      </div>
      <h3 class="step-title">${s.title}</h3>
      ${raw(inner)}
    </section>`;
}

function warmupHTML(l, s, i) {
  const ids = s.cardIds || C.dueCards({ track: l.track, limit: 5 }).map(c => c.id);
  const cards = ids.map(id => db.get('cards', id)).filter(Boolean);
  if (cards.length) {
    return `<p class="small muted">${cards.length} due review card${cards.length > 1 ? 's' : ''} from ${l.track === 'mixed' ? 'all tracks' : C.trackName(l.track)}.</p>` + cards.map(c => html`
      <div class="qa" data-qa="card-${c.id}">
        <p><b>${c.front}</b></p>
        ${raw(state.revealed[`card-${c.id}`] ? html`<div class="answer">${raw(mdDoc(c.back))}</div><div class="grades">${raw(['again', 'hard', 'good', 'easy'].map(g => `<button class="chip" data-grade="${g}" data-card="${esc(c.id)}">${g}</button>`).join(''))}</div>` : html`<button class="chip" data-reveal="card-${c.id}">show answer</button>`)}
      </div>`).join('');
  }
  const { qs, skipped } = recallQuestions(l, s);
  const note = skipped ? `<p class="small dim">${skipped} question${skipped > 1 ? 's' : ''} skipped: ${skipped > 1 ? 'they come' : 'it comes'} from a lesson you haven't done yet.</p>` : '';
  if (!qs.length) return note + '<p class="small muted">Nothing to recall yet: everything today is new. Go straight to the first example.</p>';
  return note + questionsHTML({ ...s, questions: qs }, i, false);
}

// One path, no guessing: a warm-up only asks about lessons you have finished.
// Questions from a lesson you haven't done are skipped; exit questions from your
// most recently finished lessons fill in when fewer than two are left.
function recallQuestions(l, s) {
  const all = s.questions || [];
  const qs = all.filter(q => !q.from || C.finished(q.from));
  if (qs.length < 2) qs.push(...C.recallFromFinished(l.track, 2 - qs.length, new Set(qs.map(q => q.q))));
  return { qs, skipped: all.filter(q => q.from && !C.finished(q.from)).length };
}

// "Don't know yet" is always an answer: it shows the answer and offers a lesson on
// it, and on a scored question it counts as wrong. Nobody has to guess.
function questionsHTML(s, i, scored) {
  return s.questions.map((q, j) => {
    const k = `${i}-${j}`;
    const mark = state.marks[k];
    const src = q.from ? C.lesson(q.from) : null;
    return html`
      <div class="qa ${raw(mark === true ? 'right' : mark === false ? 'wrong' : '')}">
        <div class="q">${raw(mdDoc(q.q))}</div>
        ${raw(src ? html`<p class="small dim mono">from ${src.title}</p>` : '')}
        ${raw(scored && !state.unknown[k] ? html`<textarea rows="2" data-answer="${k}" placeholder="Your answer (or answer in your head)">${state.answers[k] || ''}</textarea>` : '')}
        ${raw(state.revealed[k] ? html`<div class="answer">${raw(mdDoc(q.a))}</div>${raw(scored && !state.unknown[k] ? html`<div class="grades"><button class="chip ${raw(mark === true ? 'on' : '')}" data-mark="${k}" data-v="1">right</button><button class="chip ${raw(mark === false ? 'on' : '')}" data-mark="${k}" data-v="0">wrong</button></div>` : '')}${raw(state.unknown[k] ? html`<div class="grades"><button class="chip" data-teach="${k}">${raw(icon('sparkle'))} teach me this</button></div>` : '')}` : html`<div class="grades"><button class="chip" data-reveal="${k}">show answer</button><button class="chip" data-unknown="${k}">don't know yet</button></div>`)}
      </div>`;
  }).join('') + (scored ? `<p class="small mono muted" data-score>${scoreText(s, i)}</p>` : '');
}

function teachPrompt(q, src) {
  return `I didn't know the answer to this${src ? ` (from my lesson "${src.title}")` : ''}:
${q.q}
The answer is: ${q.a}
Teach it to me from the beginning: assume I haven't learned it. Explain with one small concrete example, then ask me one easy question to check, and wait for my answer.`;
}

function scoreText(s, i) {
  const marks = s.questions.map((_, j) => state.marks[`${i}-${j}`]);
  const right = marks.filter(m => m === true).length, total = s.questions.length;
  const marked = marks.filter(m => m !== undefined).length;
  return `${right}/${total} right · ${marked}/${total} marked · mastery needs ${Math.ceil(total * 0.8)}`;
}

function taskHTML(l, t, k, diag) {
  const shown = state.hints[k] || 0;
  const hints = t.hints || [];
  const solShown = state.revealed[`sol-${k}`];
  return html`
    <div class="task-card">
      ${raw(mdDoc(t.prompt))}
      ${raw(t.from ? html`<p class="small dim mono">from ${t.fromTitle || t.from}</p>` : '')}
      ${raw(hints.slice(0, shown).map((h, n) => html`<p class="hint"><span class="mono">hint ${n + 1}</span> ${raw(mdDoc(h))}</p>`).join(''))}
      ${raw(t.check ? html`<details class="check"><summary class="small mono">how to check</summary>${raw(mdDoc(t.check))}</details>` : '')}
      <div class="btn-row wrap task-actions">
        ${raw(hints.length ? html`<button class="chip" data-hint="${k}" ${raw(shown >= hints.length ? 'disabled' : '')}>${shown >= hints.length ? 'no more hints' : `hint ${shown + 1}/${hints.length}`}</button>` : '')}
        ${raw(t.solution ? (solShown ? '' : html`<button class="chip" data-sol="${k}">I've tried; show it</button>`) : '')}
        ${raw(t.lang && t.tests ? html`<button class="chip" data-starter="${k}">${raw(icon('download'))} starter file</button>` : '')}
      </div>
      ${raw(diag ? html`<div class="grades">${raw(['solved', 'partly', 'stuck'].map(v => `<button class="chip ${state.marks[`d-${k}`] === v ? 'on' : ''}" data-diag="${k}" data-v="${v}">${v}</button>`).join(''))}</div>` : '')}
      ${raw(solShown ? html`<div class="answer solution">${raw(mdDoc(t.solution))}</div>` : '')}
    </div>`;
}

// ---------- LeetCode (optional) ----------
const lcSlug = p => p.url.split('/problems/')[1].replace(/\/$/, '');

function leetcodeHTML(l) {
  if (!l.leetcode?.length) return '';
  const done = db.setting('leetcode', {}) || {};
  return html`
    <section class="card">
      <p class="label">leetcode · optional</p>
      <p class="small muted">Extra practice on leetcode.com. Each problem needs only what you've learned so far, and says where. Try it there first, then go through it with Yaver.</p>
      ${raw(l.leetcode.map((p, j) => { const st = done[lcSlug(p)]?.state; return html`
        <div class="task-card">
          <a href="${p.url}" target="_blank" rel="noopener" class="res">${raw(icon('external'))}<span><b>${p.title}</b><small>${p.level} · uses ${p.uses}</small></span></a>
          <div class="btn-row wrap task-actions">
            <button class="chip ${raw(st === 'solved' ? 'on' : '')}" data-lc="${lcSlug(p)}" data-v="solved">solved</button>
            <button class="chip ${raw(st === 'stuck' ? 'on' : '')}" data-lc="${lcSlug(p)}" data-v="stuck">stuck</button>
            <button class="chip" data-lc-explain="${j}">${raw(icon('sparkle'))} go through it with Yaver</button>
          </div>
        </div>`; }).join(''))}
    </section>`;
}

function leetcodePrompt(p, st) {
  const head = `LeetCode problem "${p.title}" (${p.url}, ${p.level}). It uses ${p.uses}.`;
  if (st === 'solved') return `${head} I solved it. Go through it with me: first ask me to explain my approach in a few sentences and wait. Then show the cleanest Python solution, explain why it works step by step, give its time and space cost, and point out anything my approach missed.`;
  if (st === 'stuck') return `${head} I got stuck. Restate the problem simply with a small example. Then give me one hint at a time and wait for me after each. Show the full Python solution only when I ask, then explain it step by step with its time and space cost.`;
  return `${head} I'm about to try it. Make sure I understand the problem: restate it simply and walk through one small example input and its expected output. Don't give me the approach; tell me which idea from my lessons it uses, and wait.`;
}

function taskAt(l, k) {
  const [i, j] = k.split('-').map(Number);
  return l.steps[i].tasks[j];
}

function bindStepContent(root, l) {
  const rerender = () => { const y = window.scrollY; document.querySelector('#view') && root.dispatchEvent(new Event('rerender')); window.scrollTo(0, y); };
  root.addEventListener('rerender', () => { const y = window.scrollY; lessonViewRefresh(root, l); window.scrollTo(0, y); }, { once: true });
  root.querySelectorAll('[data-answer]').forEach(t => (t.oninput = () => { state.answers[t.dataset.answer] = t.value; }));
  root.querySelectorAll('[data-reveal]').forEach(b => (b.onclick = () => { state.revealed[b.dataset.reveal] = true; rerender(); }));
  root.querySelectorAll('[data-mark]').forEach(b => (b.onclick = () => { state.marks[b.dataset.mark] = b.dataset.v === '1'; haptic(); rerender(); }));
  root.querySelectorAll('[data-unknown]').forEach(b => (b.onclick = () => {
    const k = b.dataset.unknown, s = l.steps[Number(k.split('-')[0])];
    state.unknown[k] = state.revealed[k] = true;
    if (s.kind === 'exit') state.marks[k] = false; // scored: "don't know" counts as wrong
    rerender();
  }));
  root.querySelectorAll('[data-teach]').forEach(b => (b.onclick = () => {
    const [i, j] = b.dataset.teach.split('-').map(Number), s = l.steps[i];
    const q = (s.kind === 'warmup' ? recallQuestions(l, s).qs : s.questions)[j];
    if (q) openAssistant(teachPrompt(q, q.from ? C.lesson(q.from) : null));
  }));
  root.querySelectorAll('[data-lc]').forEach(b => (b.onclick = async () => {
    const all = { ...(db.setting('leetcode', {}) || {}) }, cur = all[b.dataset.lc]?.state;
    if (cur === b.dataset.v) delete all[b.dataset.lc]; else all[b.dataset.lc] = { state: b.dataset.v, at: new Date().toISOString(), lessonId: l.id };
    haptic(); await db.setSetting('leetcode', all); rerender();
  }));
  root.querySelectorAll('[data-lc-explain]').forEach(b => (b.onclick = () => {
    const p = l.leetcode[Number(b.dataset.lcExplain)];
    openAssistant(leetcodePrompt(p, (db.setting('leetcode', {}) || {})[lcSlug(p)]?.state));
  }));
  root.querySelectorAll('[data-diag]').forEach(b => (b.onclick = () => { state.marks[`d-${b.dataset.diag}`] = b.dataset.v; haptic(); rerender(); }));
  root.querySelectorAll('[data-hint]').forEach(b => (b.onclick = () => { state.hints[b.dataset.hint] = (state.hints[b.dataset.hint] || 0) + 1; state.hintsUsed = (state.hintsUsed || 0) + 1; rerender(); }));
  root.querySelectorAll('[data-sol]').forEach(b => (b.onclick = () => { state.revealed[`sol-${b.dataset.sol}`] = true; state.solutions = (state.solutions || 0) + 1; rerender(); }));
  root.querySelectorAll('[data-starter]').forEach(b => (b.onclick = () => { const t = taskAt(l, b.dataset.starter); saveFile(...starterFile(l, t, b.dataset.starter)); }));
  root.querySelectorAll('[data-grade]').forEach(b => (b.onclick = async () => { await C.gradeCard(b.dataset.card, b.dataset.grade); haptic(); }));
}
function lessonViewRefresh(root, l) {
  // Re-render with the same router args (state survives because state.arg is unchanged).
  render(root, (...a) => import('../app.js').then(m => m.go(...a)), state.arg);
}

// A .py or .cpp file with the task as a comment and its tests, ready for VS Code.
export function starterFile(l, t, k) {
  const base = `${l.id}-task${Number(k.split('-')[1]) + 1}`;
  const prompt = String(t.prompt).replace(/[*`]/g, '');
  if (t.lang === 'cpp') {
    const comment = prompt.split('\n').map(x => `// ${x}`).join('\n');
    return [`${base}.cpp`, `${comment}\n// Check: ${String(t.check || '').replace(/\n/g, ' ')}\n// Build and run: g++ -std=c++20 ${base}.cpp -o ${base} && ./${base}\n\n#include <cassert>\n#include <iostream>\n#include <string>\n#include <vector>\n\n// Your code here.\n\nint main() {\n${String(t.tests).split('\n').map(x => '    ' + x).join('\n')}\n    std::cout << "all tests passed\\n";\n    return 0;\n}\n`];
  }
  const comment = prompt.split('\n').map(x => `# ${x}`).join('\n');
  return [`${base.replace(/-/g, '_')}.py`, `${comment}\n# Check: ${String(t.check || '').replace(/\n/g, ' ')}\n# Run the tests: python3 -m pytest ${base.replace(/-/g, '_')}.py   (or just: python3 ${base.replace(/-/g, '_')}.py)\n\n\n# Your code here.\n\n\n# ---- tests ----\n${t.tests}\n\n\nif __name__ == "__main__":\n    for _name, _fn in list(globals().items()):\n        if _name.startswith("test_") and callable(_fn):\n            _fn()\n    print("all tests passed")\n`];
}

async function complete(l, root, go, { retake, diag }) {
  const t = timerFor(l.id);
  const p = C.progress(l.id) || {};
  const exitIdx = l.steps.findIndex(s => s.kind === 'exit' && s.questions?.length);
  let score = null;
  if (diag) {
    const tasks = l.steps.flatMap((s, i) => (s.tasks || []).map((_, j) => `${i}-${j}`));
    const v = tasks.map(k => state.marks[`d-${k}`]);
    if (v.some(x => !x)) { toast('Mark every problem solved, partly or stuck first.', 3500); return; }
    const pts = v.reduce((a, x) => a + (x === 'solved' ? 1 : x === 'partly' ? 0.5 : 0), 0);
    await C.recordDiagnostic({ score: pts, total: tasks.length, marks: v });
    const hist = C.diagnosticHistory();
    if (retake) { toast(hist.length > 1 ? `Diagnostic: ${hist[0].results.score}/7 then, ${pts}/7 now.` : `Diagnostic saved: ${pts}/7.`, 5000); go('course'); return; }
  } else if (exitIdx >= 0) {
    const qs = l.steps[exitIdx].questions;
    const marks = qs.map((_, j) => state.marks[`${exitIdx}-${j}`]);
    if (marks.some(m => m === undefined)) {
      const ok = await sheet({ title: 'Exit ticket not marked', body: '<p class="small muted">Mark each exit-ticket answer right or wrong first: that score decides mastery (80%). Or complete without a score.</p>', submit: 'Complete without score' });
      if (!ok) return;
    } else score = marks.filter(Boolean).length / qs.length;
  }
  let minutes = t ? Math.max(1, Math.round((Date.now() - t.start) / 60000)) : null;
  if (minutes == null) {
    const v = await sheet({ title: 'How long did it take?', fields: [{ name: 'm', label: 'Minutes', type: 'number', value: l.minutes, required: true }], submit: 'Complete' });
    if (!v) return;
    minutes = v.m;
  }
  if (minutes < l.minutes * 0.75 && !(await sheet({ title: 'Finish early?', body: html`<p class="small muted">Planned ${l.minutes} min, you did ${minutes}. Finish anyway?</p>`, submit: 'Finish anyway' }))) return;
  const notes = root.querySelector('[data-notes]')?.value || p.notes || '';
  const r = await C.completeLesson({ lessonId: l.id, minutes, score, notes, hintsUsed: state.hintsUsed || 0, solutionsRevealed: state.solutions || 0 });
  haptic();
  if (r.mastered) sound.done();
  toast(r.mastered ? `Done${score != null ? ` · ${Math.round(score * 100)}%` : ''}. ${mins(minutes)} logged.` : `Flagged at ${Math.round(score * 100)}%: cards come back tomorrow and it returns in the next buffer slot.`, 4500);
  go('study');
}

function tutorMe(l, step) {
  const content = step ? [step.body, ...(step.questions || []).map(q => `Q: ${q.q}`), ...(step.tasks || []).map(t => `Task: ${t.prompt}`)].filter(Boolean).join('\n\n').slice(0, 3500) : '';
  const prompt = `Tutor me through this lesson (id ${l.id}).
Lesson: ${l.title} (${l.track === 'mixed' ? 'mixed practice' : C.trackName(l.track)}, ${l.minutes} min)
Objectives: ${(l.objectives || []).join('; ')}
Current step: ${step ? `${step.kind}: ${step.title}` : 'start'}
${content ? `Step content:\n${content}\n` : ''}
Rules: (1) Start with the warm-up: one recall question at a time, only about lessons I have finished (each question names its lesson; skip any I haven't done), wait, correct briefly. (2) Never ask me to predict or guess something the lesson hasn't taught yet. Teach first: explain each idea with a small concrete example, then ask me to apply it. If I say I don't know, teach it from the start instead of hinting. (3) Keep to one path: today's lesson, in order, without detours into topics I haven't met. (4) In practice use a hint ladder: nudge, hint, partial solution; a full solution only if I ask after attempting. Review my code by pointing at the problem, not rewriting it. (5) At the end run the exit ticket one question at a time, then ask for the teach-back, then call complete_lesson with my score. Use get_lesson for the full lesson.`;
  if (matchMedia('(min-width: 1400px)').matches) document.body.classList.add('lesson-docked');
  openAssistant(prompt);
}

function askNotify() {
  // Desktop notifications are asked for from a button press, never on load.
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}
function notify(msg) {
  try { if (Notification.permission === 'granted') new Notification('Yaver', { body: msg, icon: 'icons/icon-192.png' }); } catch {}
  toast(msg, 4000);
}

// ---------- Review cards (evening slot) ----------
function review(root, go) {
  const due = C.dueCards({ limit: 200 });
  const card = due[0];
  const tomorrow = addDays(today(), 1);
  const log = C.dayLog() || {};
  root.innerHTML = html`
    ${raw(head('review', 'Review'))}
    <p class="small muted mono">${due.length} due · space reveals · 1 again · 2 hard · 3 good · 4 easy</p>
    ${raw(card ? html`
      <section class="card flash ${raw(state.flipped ? 'flipped' : '')}">
        <p class="small mono muted"><span class="dot" style="background:${raw(dotColor(card.track))}"></span> ${C.trackName(card.track)} · box ${card.box}</p>
        <div class="flash-front">${raw(mdDoc(card.front))}</div>
        ${raw(state.flipped ? html`<div class="answer">${raw(mdDoc(card.back))}</div>
          <div class="grade-row">${raw([['again', 1], ['hard', 2], ['good', 3], ['easy', 4]].map(([g, n]) => `<button class="btn ghost" data-g="${g}"><span class="mono dim">${n}</span> ${g}</button>`).join(''))}</div>` : html`<button class="btn primary" data-flip>Show answer</button>`)}
      </section>` : html`<section class="card"><p>No cards due. ${db.all('cards').length ? 'Next ones come back on their dates.' : 'Cards appear as you complete lessons.'}</p></section>`)}

    <section class="card">
      <p class="label">log the day</p>
      <label class="field"><span>What went well</span><input data-well value="${log.well || ''}"></label>
      <label class="field"><span>What to change</span><input data-change value="${log.change || ''}"></label>
      <p class="label">tomorrow</p>
      ${raw(C.planFor(tomorrow).map(x => html`<p class="small mono">${x}</p>`).join('') || '<p class="small muted">Nothing scheduled.</p>')}
      <button class="btn primary" data-confirm>${log.confirmedAt ? 'Confirmed ✓ (save again)' : 'Save log and confirm tomorrow'}</button>
    </section>`;
  root.querySelector('[data-back]').onclick = () => go('study');
  const flip = () => { if (card) { state.flipped = true; render(root, go, 'review'); } };
  const grade = async g => { if (!card || !state.flipped) return; state.flipped = false; await C.gradeCard(card.id, g); haptic(); };
  root.querySelector('[data-flip]')?.addEventListener('click', flip);
  root.querySelectorAll('[data-g]').forEach(b => (b.onclick = () => grade(b.dataset.g)));
  root.querySelector('[data-confirm]').onclick = async () => {
    await C.saveDayLog(today(), { well: root.querySelector('[data-well]').value, change: root.querySelector('[data-change]').value, confirmedAt: new Date().toISOString(), plan: C.planFor(tomorrow) });
    toast(`Tomorrow: ${C.planFor(tomorrow)[0] || 'free'}`);
  };
  onKeys({ ' ': flip, 1: () => grade('again'), 2: () => grade('hard'), 3: () => grade('good'), 4: () => grade('easy'), Escape: () => go('study') });
}

// ---------- Sunday: weekly test ----------
function weeklyTest(root, go) {
  const w = Math.max(1, C.weekOf());
  const qs = state.qs || (state.qs = C.testQuestions(w));
  const done = C.testResults().find(t => t.week === w);
  root.innerHTML = html`
    ${raw(head(`week ${w}`, 'Weekly test'))}
    <p class="small muted">${qs.length} questions from this week's exit tickets plus earlier cards, mixed across tracks. Answer from memory, then reveal and mark. Under 70% in a track flags that track's lessons for Monday.</p>
    ${raw(done ? html`<p class="small mono accent">saved: ${done.scores.map(x => `${C.trackName(x.track)} ${x.right}/${x.total}`).join(' · ')}</p>` : '')}
    ${raw(qs.length ? qs.map((q, j) => {
      const k = `t-${j}`, mark = state.marks[k];
      return html`<section class="card qa ${raw(mark === true ? 'right' : mark === false ? 'wrong' : '')}">
        <p class="small mono muted"><span class="dot" style="background:${raw(dotColor(q.track))}"></span> ${j + 1}. ${C.trackName(q.track)}</p>
        <div class="q">${raw(mdDoc(q.q))}</div>
        <textarea rows="2" data-answer="${k}" placeholder="Answer">${state.answers[k] || ''}</textarea>
        ${raw(state.revealed[k] ? html`<div class="answer">${raw(mdDoc(q.a))}</div>${raw(state.unknown[k] ? html`<div class="grades"><button class="chip" data-teach="${j}">${raw(icon('sparkle'))} teach me this</button></div>` : html`<div class="grades"><button class="chip ${raw(mark === true ? 'on' : '')}" data-mark="${k}" data-v="1">right</button><button class="chip ${raw(mark === false ? 'on' : '')}" data-mark="${k}" data-v="0">wrong</button></div>`)}` : html`<div class="grades"><button class="chip" data-reveal="${k}">show answer</button><button class="chip" data-unknown="${k}">don't know yet</button></div>`)}
      </section>`;
    }).join('') : '<section class="card"><p class="small muted">No lessons completed this week yet, so there is nothing to test. Clear your review cards instead.</p></section>')}
    <div class="btn-row wrap">
      <button class="btn ghost" data-grade-ai>${raw(icon('sparkle'))} Grade with Yaver</button>
      <button class="btn primary" data-save>Save scores</button>
    </div>`;
  root.querySelector('[data-back]').onclick = () => go('study');
  root.querySelectorAll('[data-answer]').forEach(t => (t.oninput = () => { state.answers[t.dataset.answer] = t.value; }));
  root.querySelectorAll('[data-reveal]').forEach(b => (b.onclick = () => { state.revealed[b.dataset.reveal] = true; render(root, go, 'test'); }));
  root.querySelectorAll('[data-mark]').forEach(b => (b.onclick = () => { state.marks[b.dataset.mark] = b.dataset.v === '1'; render(root, go, 'test'); }));
  root.querySelectorAll('[data-unknown]').forEach(b => (b.onclick = () => { const k = b.dataset.unknown; state.unknown[k] = state.revealed[k] = true; state.marks[k] = false; render(root, go, 'test'); }));
  root.querySelectorAll('[data-teach]').forEach(b => (b.onclick = () => openAssistant(teachPrompt(qs[Number(b.dataset.teach)]))));
  root.querySelector('[data-grade-ai]').onclick = () => openAssistant(`Grade my weekly test (week ${w}). For each question, say right or wrong with a one-line reason, then give per-track totals and call record_test_result with them.\n\n${qs.map((q, j) => `${j + 1}. [${q.track}] Q: ${q.q}\nExpected: ${q.a}\nMy answer: ${state.answers[`t-${j}`] || '(blank)'}`).join('\n\n')}`.slice(0, 12000));
  root.querySelector('[data-save]').onclick = async () => {
    if (!qs.length) return;
    if (qs.some((_, j) => state.marks[`t-${j}`] === undefined)) { toast('Mark every question first, or use Grade with Yaver.', 3500); return; }
    const by = {};
    qs.forEach((q, j) => { const s = (by[q.track] ||= { track: q.track, right: 0, total: 0 }); s.total++; if (state.marks[`t-${j}`]) s.right++; });
    const r = await C.recordTest({ week: w, scores: Object.values(by) });
    toast(r.weakTracks.length ? `Saved. Flagged for Monday: ${r.weakTracks.map(C.trackName).join(', ')}.` : 'Saved. Every track at 70% or more.', 4500);
  };
}

// ---------- Sunday: ship & weekly review ----------
function ship(root, go) {
  const w = Math.max(0, C.weekOf());
  const key = `courseShip:w${String(w).padStart(2, '0')}`;
  const v = db.setting(key, {});
  const pace = Object.values(C.pace());
  const next = w + 1;
  const needPrep = next >= 16 && !C.weekMeta(next)?.consolidation && !C.hasWeek(next);
  const items = [
    ['push', 'Push the week\'s project (README, tests passing, clean commit).'],
    ['log', 'Write the weekly log in learning-log: what you built, what was hard.'],
    ['pace', 'Review pace per track (below).'],
    ['teach', 'Confirm next week\'s teaching topics and dates.'],
    ['ics', 'Export next week to the Calendar.'],
  ];
  root.innerHTML = html`
    ${raw(head(`week ${w}`, 'Ship & weekly review'))}
    <section class="card">
      ${raw(items.map(([id, label]) => html`<label class="task ${raw(v[id] ? 'done' : '')}"><input type="checkbox" data-item="${id}" ${raw(v[id] ? 'checked' : '')}><span>${label}</span></label>`).join(''))}
      <label class="field"><span>One thing to change next week</span><input data-change value="${v.change || ''}" placeholder="e.g. start Deep 1 at 05:50 sharp, phone in the other room"></label>
    </section>
    <section class="card">
      <p class="label">pace</p>
      ${raw(pace.length ? pace.map(t => html`<div class="agenda-row"><span class="dot" style="background:${raw(C.track(t.track).color)}"></span><span class="what"><b>${t.name}</b><small>${t.done} done of ${t.expected} scheduled so far</small></span><span class="pill pace-${t.color}">${t.label}</span></div>`).join('') : '<p class="small muted">Pace starts counting in Week 1.</p>')}
      <p class="small muted">Behind: continue where you are, nothing is skipped; Friday's buffer goes to the most-behind track. Ahead: pull next week forward, never add a subject.</p>
    </section>
    <div class="btn-row wrap">
      <button class="btn ghost" data-ics>${raw(icon('calendar'))} Add week ${next} to Calendar</button>
      ${raw(needPrep ? html`<button class="btn primary" data-prepare>${raw(icon('sparkle'))} Prepare week ${next}</button>` : '')}
    </div>`;
  root.querySelector('[data-back]').onclick = () => go('study');
  root.querySelectorAll('[data-item]').forEach(cb => (cb.onchange = () => { haptic(); db.setSetting(key, { ...db.setting(key, {}), [cb.dataset.item]: cb.checked }); }));
  root.querySelector('[data-change]').onchange = e => db.setSetting(key, { ...db.setting(key, {}), change: e.target.value });
  root.querySelector('[data-ics]').onclick = async () => { await exportWeek(next); db.setSetting(key, { ...db.setting(key, {}), ics: true }); };
  root.querySelector('[data-prepare]')?.addEventListener('click', () => go(`lesson/prepare-${next}`));
}

// ---------- Consolidation: redo flagged practice ----------
function flaggedTasks(root, go) {
  const flagged = db.all('courseProgress').filter(p => p.status === 'flagged').map(p => C.lesson(p.lessonId)).filter(Boolean);
  root.innerHTML = html`${raw(head('consolidation', 'Redo flagged practice'))}
    ${raw(flagged.length ? flagged.map(l => html`<button class="row" data-open="${l.id}"><span class="dot" style="background:${raw(dotColor(l.track))}"></span><span class="row-main"><b>${l.title}</b><small>${C.trackName(l.track)} · week ${l.week}</small></span></button>`).join('') : '<section class="card"><p class="small muted">Nothing flagged. Use the time for review cards and your weakest track\'s practice tasks.</p></section>')}`;
  root.querySelector('[data-back]').onclick = () => go('study');
  root.querySelectorAll('[data-open]').forEach(b => (b.onclick = () => go(`lesson/${b.dataset.open}`)));
}

// ---------- Prepare week N (weeks 16+, written by the AI) ----------
function prepare(root, go, n) {
  const w = C.weekMeta(n);
  const has = C.hasWeek(n);
  root.innerHTML = html`${raw(head(`week ${n}`, `Prepare week ${n}`))}
    <section class="card">
      <p class="small">${w?.theme || ''}</p>
      <p class="small muted">Yaver's AI writes this week's day-level lessons from the outline, checks them against the lesson rules and the rotation, and saves them on this device (and to your other device through sync). It takes a few minutes; long weeks may need a Claude key or a quiet moment on Gemini's free limits.</p>
      ${raw(has ? '<p class="small accent mono">this week is ready</p>' : '')}
      <button class="btn primary" data-go-ai>${raw(icon('sparkle'))} ${has ? 'Regenerate' : 'Prepare'} week ${n}</button>
    </section>`;
  root.querySelector('[data-back]').onclick = () => go('course');
  root.querySelector('[data-go-ai]').onclick = () => {
    const brief = C.weekBrief(n);
    openAssistant(`Prepare week ${n} of my course. Here is the brief (outline, lanes with their sessions, the previous lesson in each lane, and the step templates):
${JSON.stringify(brief)}

Write every lesson for the week as JSON lesson objects: id "<track>-w${String(n).padStart(2, '0')}-<k>", track, lane, week ${n}, kind and minutes from the lane, title, 2–4 objectives, resources [{title, url (https, a resource home page you are sure of), part}], steps that follow the template exactly (warmup questions [{q, a, from}] where "from" is the id of an earlier lesson that taught it, so recall never asks about something new; the "example" step shows a worked example with its result, never asking to predict or guess; exit with 3–5 questions [{q, a}] answerable from this lesson; practice with 2–5 tasks {prompt, hints, check, solution}; other steps with a Markdown body), 3–6 cards [{front, back}], deliverable; robotics lessons also teachBy null and safety. Original explanations with worked examples, natural voice. Then call save_week_lessons with {week: ${n}, lessons}. If it returns errors, fix exactly those and call it again (at most 3 attempts), then tell me plainly what happened. Do not paste the lessons into the chat.`);
  };
}
