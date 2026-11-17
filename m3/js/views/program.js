// Build or change the study program (Yaver M III): four short steps. 1 what you want
// to learn (a starting point and a goal), 2 subjects with their topics, level and priority,
// 3 when you study, 4 how it adapts. Nothing is saved until the last step.
import * as P from '../program.js';
import { html, raw, toast, haptic, confirmSheet, today } from '../util.js';
import { icon } from '../icons.js';
import { openAssistant } from '../ai/assistant.js';

let draft = null;   // the program being edited
let step = 0;
let editing = false;
const STEPS = ['Goal', 'Subjects', 'Schedule', 'Adapt'];

export function cleanup() { draft = null; }

export function render(root, go, arg) {
  if (!draft) {
    const cur = P.get();
    editing = !!cur && arg !== 'new';
    draft = structuredClone(editing ? cur : P.normalize({ subjects: [] }));
    step = arg === 'schedule' ? 2 : editing ? 1 : 0;
  }
  const body = [goalStep, subjectsStep, scheduleStep, adaptStep][step]();
  root.innerHTML = html`
    <header class="page-head wiz-head">
      <div><p class="path">Study <b>·</b> ${editing ? 'edit program' : 'new program'}</p><h1>${['What do you want to learn?', 'Subjects and topics', 'When do you study?', 'How should it adapt?'][step]}</h1></div>
      <button class="icon-btn" data-close aria-label="Close">${raw(icon('close'))}</button>
    </header>
    <ol class="wiz-steps" aria-label="Steps">${raw(STEPS.map((s, i) => `<li class="${i === step ? 'on' : i < step ? 'done' : ''}"><button data-jump="${i}" ${i > step && !draft.subjects.length ? 'disabled' : ''}><i>${i < step ? '✓' : i + 1}</i><span>${s}</span></button></li>`).join(''))}</ol>
    ${raw(body)}
    <div class="wiz-bar">
      ${raw(step ? html`<button class="btn ghost" data-prev>${raw(icon('chevronLeft'))} Back</button>` : '<span></span>')}
      ${raw(step < 3 ? html`<button class="btn primary" data-next>Next ${raw(icon('chevronRight'))}</button>` : html`<button class="btn primary" data-save>${raw(icon('check'))} ${editing ? 'Save changes' : 'Create my program'}</button>`)}
    </div>`;

  const keep = () => collect(root);
  root.querySelector('[data-close]').onclick = () => { draft = null; go('study'); };
  root.querySelectorAll('[data-jump]').forEach(b => (b.onclick = () => { keep(); if (Number(b.dataset.jump) > 0 && !valid(1)) return; step = Number(b.dataset.jump); render(root, go); }));
  root.querySelector('[data-prev]')?.addEventListener('click', () => { keep(); step--; render(root, go); scrollTo(0, 0); });
  root.querySelector('[data-next]')?.addEventListener('click', () => { keep(); if (!valid(step + 1)) return; step++; haptic(); render(root, go); scrollTo(0, 0); });
  root.querySelector('[data-save]')?.addEventListener('click', async () => {
    keep();
    if (!valid(4)) return;
    await P.save(draft);
    haptic('success');
    toast(editing ? 'Program updated' : 'Your program is ready', 2600);
    draft = null;
    go('study');
  });
  bindStep(root, go);
}

function valid(target) {
  if (target >= 1 && !String(draft.title || '').trim() && !String(draft.goal || '').trim()) draft.title = 'My study program';
  if (target >= 2) {
    if (!draft.subjects.length) { toast('Add at least one subject.', 3000); return false; }
    const empty = draft.subjects.find(s => !s.topics.length);
    if (empty) { toast(`Add a topic or two to ${empty.name || 'each subject'}: one lesson is made for each.`, 3500); return false; }
  }
  if (target >= 3 && !draft.days.some(Boolean)) { toast('Pick at least one day.', 3000); return false; }
  return true;
}

// ---------- Step 1: goal ----------
function goalStep() {
  return html`
    <p class="lead">Pick a starting point. Everything in it can be changed in the next step, and Yaver builds the lessons, the week and the reviews from what you choose.</p>
    <div class="preset-grid" role="list">
      ${raw(P.PRESETS.map(p => html`<button class="preset ${raw(draft.preset === p.id ? 'on' : '')}" data-preset="${p.id}" role="listitem" aria-pressed="${raw(String(draft.preset === p.id))}">
        <span class="preset-ic">${raw(icon(p.icon))}</span><b>${p.name}</b><small>${p.subjects.length ? p.subjects.map(s => s[0]).join(' · ') : p.id === 'school' ? 'Add your own courses' : 'Start from a blank page'}</small></button>`).join(''))}
    </div>
    <section class="card">
      <label class="field"><span>Your goal</span><input name="goal" value="${draft.goal}" placeholder="e.g. Get a junior developer job by summer" autocomplete="off"></label>
      <label class="field"><span>Program name</span><input name="title" value="${draft.title === 'My study program' && !editing ? '' : draft.title}" placeholder="My study program" autocomplete="off"></label>
    </section>`;
}

// ---------- Step 2: subjects ----------
function subjectsStep() {
  const topics = draft.subjects.reduce((a, s) => a + s.topics.length, 0);
  return html`
    <p class="lead">One lesson is made for each topic, in the order you list them. Set how well you know each subject (it decides how much explaining a lesson does) and how much it matters (it decides its share of the week).</p>
    <div class="subj-list">
      ${raw(draft.subjects.map((s, i) => html`
      <section class="card subj" data-i="${i}">
        <div class="subj-top">
          <button class="swatch" data-color="${i}" style="background:${s.color}" aria-label="Change colour"></button>
          <input class="subj-name" data-f="name" value="${s.name}" placeholder="Subject name" aria-label="Subject name" autocomplete="off">
          <button class="icon-btn" data-del="${i}" aria-label="Remove ${s.name || 'subject'}">${raw(icon('trash'))}</button>
        </div>
        <div class="seg-row"><span class="seg-k">Level</span>${raw(seg(`level-${i}`, P.LEVELS, s.level))}</div>
        <div class="seg-row"><span class="seg-k">Priority</span>${raw(seg(`prio-${i}`, P.PRIORITIES, s.priority))}</div>
        <label class="field"><span>Topics · one per line, in order <em class="count">${s.topics.length}</em></span><textarea data-f="topics" rows="${Math.min(10, Math.max(4, s.topics.length + 1))}" placeholder="Variables and types&#10;Conditions and loops&#10;Functions">${s.topics.map(t => t.t).join('\n')}</textarea></label>
        <details class="more"><summary>Resources and options</summary>
          <label class="field"><span>Resources · one link per line (optional "Title | https://…")</span><textarea data-f="resources" rows="3" placeholder="Official tutorial | https://…">${s.resources.map(r => (r.title && r.title !== r.url ? `${r.title} | ${r.url}` : r.url)).join('\n')}</textarea></label>
          <label class="field check"><span>Pause this subject (keeps progress, takes it out of the week)</span><input type="checkbox" data-f="paused" ${raw(s.paused ? 'checked' : '')}></label>
        </details>
      </section>`).join(''))}
    </div>
    <div class="btn-row">
      <button class="btn ghost" data-add-subj>${raw(icon('plus'))} Add subject</button>
      <button class="btn ghost" data-ai-draft>${raw(icon('sparkle'))} Draft topics with Yaver</button>
    </div>
    <p class="small muted">${draft.subjects.length} subject${draft.subjects.length === 1 ? '' : 's'} · ${topics} topic${topics === 1 ? '' : 's'}</p>`;
}

const seg = (name, opts, val) => `<div class="seg" role="radiogroup">${opts.map(([v, label]) => `<label><input type="radio" name="${name}" value="${v}" ${String(v) === String(val) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>`;

// ---------- Step 3: schedule ----------
function scheduleStep() {
  return html`
    <section class="card">
      <p class="label">Days</p>
      <div class="day-pick">${raw(P.DAY_NAMES.map((d, i) => `<label><input type="checkbox" name="day" value="${i}" ${draft.days[i] ? 'checked' : ''}><span>${d}</span></label>`).join(''))}</div>
      <div class="seg-row"><span class="seg-k">Sessions a day</span>${raw(seg('perDay', [[1, 'One'], [2, 'Two'], [3, 'Three']], draft.perDay))}</div>
      <div class="seg-row"><span class="seg-k">Session length</span>${raw(seg('minutes', P.LENGTHS.map(m => [m, `${m} min`]), draft.minutes))}</div>
      <div class="time-row">${raw(timeFields())}</div>
      <p class="small muted" data-sched-sum aria-live="polite">${schedSummary()}</p>
    </section>
    <section class="card">
      <p class="label">Pace</p>
      ${raw(seg('pacing', [['self', 'Whenever I\'m ready'], ['schedule', 'A fixed timetable']], draft.pacing))}
      <p class="small muted" data-pace-note aria-live="polite">${paceNote()}</p>
      <label class="field"><span>Start</span><input type="date" name="start" value="${draft.start}"></label>
    </section>`;
}

const timeFields = () => draft.times.slice(0, draft.perDay).map((t, i) => `<label class="field"><span>${draft.perDay > 1 ? `Session ${i + 1}` : 'Usual time'}</span><input type="time" name="time${i}" value="${t}"></label>`).join('');
function schedSummary() {
  const sessions = draft.days.filter(Boolean).length * draft.perDay;
  const hours = (sessions * draft.minutes) / 60;
  return `${sessions} session${sessions === 1 ? '' : 's'} a week, about ${hours % 1 ? hours.toFixed(1) : hours} hours, plus a few minutes of review cards.`;
}
const paceNote = () => (draft.pacing === 'self' ? 'No clock and nothing to fall behind on: open Study any day and take the next lesson. The order still adapts to your results.' : 'Each session has a day and a time, the week is planned for you, and pace per subject shows if you are behind or ahead.');

// ---------- Step 4: adapt ----------
function adaptStep() {
  const per = P.baseSessions(draft);
  const weeks = Math.max(...draft.subjects.filter(s => !s.paused).map(s => P.weekForIndex(Math.max(0, s.topics.length - 1), per[s.id], draft)), 1);
  return html`
    <section class="card">
      <label class="field check"><span><b>Adapt to my results</b><small>Subjects with weak scores, lessons to redo or "too hard" ratings get more of the week; ones you find easy get less, and Yaver suggests a level change.</small></span><input type="checkbox" name="adaptive" ${raw(draft.adaptive ? 'checked' : '')}></label>
      <label class="field check"><span><b>Weekly test</b><small>A short mixed test on the last study day of the week. Under 70% in a subject sends its lessons back for another go.</small></span><input type="checkbox" name="weeklyTest" ${raw(draft.weeklyTest ? 'checked' : '')}></label>
      <div class="seg-row"><span class="seg-k">Review week</span>${raw(seg('reviewEvery', [[0, 'Never'], [4, 'Every 4th'], [6, 'Every 6th'], [8, 'Every 8th']], draft.reviewEvery))}</div>
      <div class="seg-row"><span class="seg-k">Lessons</span>${raw(seg('style', [['do', 'Learn by doing'], ['full', 'Full explanations']], draft.style))}</div>
    </section>
    <section class="card summary-card">
      <p class="label">Your program</p>
      <h3>${draft.title}</h3>
      ${raw(draft.goal ? html`<p class="small muted">${draft.goal}</p>` : '')}
      <div class="summary-subjects">${raw(draft.subjects.map(s => html`<span class="chip-tag" style="--c:${s.color}"><i></i>${s.name} · ${s.topics.length}${s.paused ? ' · paused' : ''}</span>`).join(''))}</div>
      <p class="small">${draft.subjects.reduce((a, s) => a + s.topics.length, 0)} lessons · ${draft.days.filter(Boolean).length * draft.perDay} sessions a week of ${draft.minutes} min · about ${weeks} week${weeks === 1 ? '' : 's'}${draft.reviewEvery ? ' with review weeks' : ''}</p>
      <p class="small muted">Lessons start as a simple plan (learn, do it yourself, exit ticket) that works offline. With an AI key, tap <b>Write this lesson</b> on any lesson, or <b>Write the week</b>, for full lessons with examples, checked tasks and review cards.</p>
    </section>
    ${raw(editing ? html`<button class="btn danger" data-remove>${raw(icon('trash'))} Delete this program</button>` : '')}`;
}

// ---------- Reading the form back into the draft ----------
function collect(root) {
  const val = n => root.querySelector(`[name="${n}"]`);
  if (step === 0) {
    if (val('goal')) draft.goal = val('goal').value.trim();
    if (val('title')) draft.title = val('title').value.trim() || draft.title;
  }
  if (step === 1) {
    root.querySelectorAll('.subj').forEach(card => {
      const s = draft.subjects[Number(card.dataset.i)];
      if (!s) return;
      s.name = card.querySelector('[data-f="name"]').value.trim();
      const byText = new Map(s.topics.map(t => [t.t.toLowerCase(), t]));
      s.topics = card.querySelector('[data-f="topics"]').value.split('\n').map(x => x.trim().replace(/^[-*•\d.)\s]+(?=\S)/, '')).filter(Boolean).map(x => byText.get(x.toLowerCase()) || { id: P.newId(), t: x });
      s.resources = card.querySelector('[data-f="resources"]').value.split('\n').map(x => x.trim()).filter(Boolean).map(x => { const [a, b] = x.includes('|') ? x.split('|').map(y => y.trim()) : [x, x]; return { title: a, url: b }; }).filter(r => /^https:\/\//.test(r.url));
      s.paused = card.querySelector('[data-f="paused"]').checked;
      const lv = card.querySelector(`[name="level-${card.dataset.i}"]:checked`); if (lv) s.level = lv.value;
      const pr = card.querySelector(`[name="prio-${card.dataset.i}"]:checked`); if (pr) s.priority = Number(pr.value);
    });
    draft.subjects = draft.subjects.filter(s => s.name || s.topics.length).map(s => ({ ...s, name: s.name || 'Untitled subject' }));
  }
  if (step === 2) {
    draft.days = P.DAY_NAMES.map((_, i) => !!root.querySelector(`[name="day"][value="${i}"]`)?.checked);
    const r = n => root.querySelector(`[name="${n}"]:checked`)?.value;
    draft.perDay = Number(r('perDay')) || draft.perDay;
    draft.minutes = Number(r('minutes')) || draft.minutes;
    draft.pacing = r('pacing') || draft.pacing;
    for (let i = 0; i < 3; i++) if (val(`time${i}`)?.value) draft.times[i] = val(`time${i}`).value;
    if (val('start')?.value) draft.start = P.mondayOf(val('start').value);
  }
  if (step === 3) {
    draft.adaptive = val('adaptive').checked;
    draft.weeklyTest = val('weeklyTest').checked;
    draft.reviewEvery = Number(root.querySelector('[name="reviewEvery"]:checked')?.value) || 0;
    draft.style = root.querySelector('[name="style"]:checked')?.value || 'do';
  }
}

function bindStep(root, go) {
  root.querySelectorAll('[data-preset]').forEach(b => (b.onclick = async () => {
    collect(root);
    const had = draft.subjects.length && draft.preset !== b.dataset.preset;
    if (had && !(await confirmSheet('Start from this instead?', 'The subjects and topics you have so far are replaced.', 'Replace'))) return;
    const fresh = P.fromPreset(b.dataset.preset);
    draft = { ...draft, preset: fresh.preset, subjects: fresh.subjects, goal: draft.goal && had === false && draft.preset === 'custom' ? draft.goal : fresh.goal, title: fresh.title || draft.title };
    haptic();
    render(root, go);
  }));
  root.querySelector('[data-add-subj]')?.addEventListener('click', () => {
    collect(root);
    draft.subjects.push({ id: `s${P.newId()}`, name: '', color: P.PALETTE[draft.subjects.length % P.PALETTE.length], level: 'new', priority: 2, topics: [], resources: [], paused: false });
    render(root, go);
    const last = [...root.querySelectorAll('.subj-name')].at(-1);
    last?.focus();
    last?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  root.querySelectorAll('[data-del]').forEach(b => (b.onclick = () => {
    collect(root);
    const i = Number(b.dataset.del), gone = draft.subjects[i];
    draft.subjects.splice(i, 1);
    render(root, go);
    toast(`Removed ${gone.name || 'subject'}`, { action: { label: 'Undo', run: () => { draft.subjects.splice(i, 0, gone); render(root, go); } } });
  }));
  root.querySelectorAll('[data-color]').forEach(b => (b.onclick = () => {
    collect(root);
    const s = draft.subjects[Number(b.dataset.color)];
    s.color = P.PALETTE[(P.PALETTE.indexOf(s.color) + 1) % P.PALETTE.length];
    b.style.background = s.color;
  }));
  root.querySelectorAll('textarea[data-f="topics"]').forEach(t => (t.oninput = () => { const n = t.value.split('\n').filter(x => x.trim()).length; t.closest('.field').querySelector('.count').textContent = n; }));
  // Schedule choices patch the few lines that depend on them instead of redrawing the step,
  // so the scroll position, focus and the control being tapped all stay put.
  root.querySelectorAll('[name="perDay"], [name="minutes"], [name="pacing"], [name="day"]').forEach(x => (x.onchange = () => {
    const per = draft.perDay;
    collect(root);
    if (draft.perDay !== per) {
      // keep the sessions in the order of the day, so Session 1 is the earliest
      draft.times = [...draft.times.slice(0, draft.perDay).sort(), ...draft.times.slice(draft.perDay)];
      root.querySelector('.time-row').innerHTML = timeFields();
    }
    root.querySelector('[data-sched-sum]').textContent = schedSummary();
    root.querySelector('[data-pace-note]').textContent = paceNote();
  }));
  root.querySelector('[data-ai-draft]')?.addEventListener('click', () => {
    collect(root);
    go('study');
    openAssistant(`Help me build my study program. My goal: ${draft.goal || '(ask me)'}. Subjects so far: ${draft.subjects.map(s => `${s.name} (${s.level}, ${s.topics.length} topics)`).join('; ') || 'none'}.
Ask me at most two short questions if you need to (my current level, deadline). Then propose subjects, each with 6 to 15 topics in a sensible learning order (each topic is one ${draft.minutes}-minute lesson), and once I agree call set_study_program with them (title, goal, subjects with name, level, priority and topics). Keep my schedule as it is.`);
  });
  root.querySelector('[data-remove]')?.addEventListener('click', async () => {
    if (!(await confirmSheet('Delete this program?', 'The timetable and lesson list go. Your progress, cards and logged study time stay, and come back if you add the same subjects again.', 'Delete'))) return;
    await P.remove();
    draft = null;
    toast('Program deleted');
    go('study');
  });
  root.querySelectorAll('.subj input, .subj textarea').forEach(x => x.addEventListener('change', () => collect(root)));
}

export const openBuilder = (go, mode = 'new') => { draft = null; go(`program/${mode}`); };
export { today };
