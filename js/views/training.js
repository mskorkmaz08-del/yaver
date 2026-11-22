// Training (v67, part of the Body section): today's session from the plan, marked
// done with how hard it felt (RPE 1-10) and its minutes; the training load over
// four weeks with the acute:chronic ratio; the muscle map lit by this week's hard
// sets; the week; and the 3/4/5-day split. Plan and sets: js/training.js; load: js/body.js.
import * as db from '../db.js';
import * as B from '../body.js';
import * as T from '../training.js';
import { ANATOMY } from '../anatomy.js';
import { html, raw, toast, haptic, today, addDays, sheet } from '../util.js';
import { icon } from '../icons.js';
import { openAssistant } from '../ai/assistant.js';
import { bodyTabs, wireBodyTabs } from './body.js';

let picked = '';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const n0 = n => Math.round(n).toLocaleString('en');

export function render(root, go) {
  const session = T.sessionOn();
  const done = T.doneOn(today());
  const sets = T.setsThisWeek();
  const todays = T.musclesOf(session);
  const wk = T.week();
  const L = B.load();
  const r = B.readiness();
  const maxLoad = Math.max(1, ...L.weeks.map(w => w.load));
  const doneWeek = wk.filter(x => x.done).length, planned = wk.filter(x => x.session).length;

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Yaver <b>·</b> training</p><h1><span class="num">${doneWeek}</span> of ${planned} <small class="h-sub">this week</small></h1></div>
    </header>
    ${raw(bodyTabs('training'))}

    <div class="bcols"><div class="bcol">
    <section class="card train">
      <div class="card-head"><p class="label">today · ${DAYS[new Date().getDay()]}</p>${raw(r ? html`<span class="chip-tag r-${raw(r.call)}">readiness ${r.score}</span>` : '')}</div>
      ${raw(session ? html`<p class="session">${session.name}</p>
        ${raw(r && r.call === 'easy' ? html`<p class="small warn-text">Readiness is low: keep the weights lighter today, or swap for mobility and an easy walk.</p>` : '')}
        <ol class="ex-list">${raw(session.items.map(([ex, n, reps]) => html`<li><span>${T.EX[ex][0]}</span><b class="mono">${n} × ${reps}</b></li>`).join(''))}</ol>`
        : '<p class="session">Rest day</p><p class="small muted">Walk, and do the mobility block.</p>')}
      <p class="small muted">${T.MOBILITY}</p>
      ${raw(done ? html`<p class="small done-line">${raw(icon('check'))} Done${done.rpe ? html` · RPE <b class="mono">${done.rpe}</b>` : ''}${done.min ? html` · <b class="mono">${done.min}</b> min` : ''} <button class="link-btn" data-rate>Edit</button> <button class="link-btn" data-undo>Undo</button></p>`
        : html`<button class="btn primary wide" data-done>${raw(icon('check'))} ${session ? 'Mark session done' : 'Log a session'}</button>`)}
    </section>

    <section class="card load">
      <div class="card-head"><p class="label">training load</p><span class="small muted">RPE × minutes</span></div>
      <div class="load-bars">${raw(L.weeks.map((w, i) => html`<div class="${raw(i === 3 ? 'now' : '')}"><span style="height:${raw(((w.load / maxLoad) * 100).toFixed(0))}%"></span><b class="mono">${n0(w.load)}</b><small>${i === 3 ? 'this wk' : `${3 - i} wk ago`}</small></div>`).join(''))}</div>
      <p class="small">${raw(L.ratio != null ? html`This week is <b class="mono">${L.ratio}×</b> your 4-week average: ${{ spike: 'a spike. Big jumps in load are when injuries happen; ease off a little.', high: 'on the high side; fine for a week, not for several.', low: 'light. Fine for a recovery week; otherwise fitness drifts down.', steady: 'steady, the safe range (0.8-1.3).' }[L.zone]}` : '<span class="muted">After three weeks of logged sessions this compares each week with your usual load, the way coaches catch spikes before injuries.</span>')}</p>
      ${raw(L.rated < T.workouts().filter(w => w.date > addDays(today(), -28)).length ? '<p class="small muted">Sessions without a rating count as RPE 7 for 60 minutes.</p>' : '')}
    </section>

    <section class="card week">
      <div class="card-head"><p class="label">this week</p></div>
      <div class="week-row">${raw(wk.map(day).join(''))}</div>
      <p class="small muted week-key"><i class="dot done"></i> trained <i class="dot planned"></i> planned <i class="dot missed"></i> missed</p>
    </section>

    </div><div class="bcol">
    <section class="card muscles">
      <div class="card-head"><p class="label">muscles this week</p><span class="small muted">hard sets, aim 10+</span></div>
      <div class="anatomy">${raw(map('front', sets, todays))}${raw(map('back', sets, todays))}</div>
      <div class="legend"><span><i class="m0"></i>0</span><span><i class="m1"></i>1-4</span><span><i class="m2"></i>5-9</span><span><i class="m3"></i>10+</span>${raw(session ? '<span><i class="tday"></i>today</span>' : '')}</div>
      <p class="small muscle-info">${raw(picked ? info(picked, sets, session) : '<span class="muted">Tap a muscle to see its sets and today\'s exercises for it.</span>')}</p>
    </section>

    <section class="card plan">
      <div class="card-head"><p class="label">the plan</p></div>
      <div class="chips days-pick">${raw([3, 4, 5].map(n => `<button class="chip ${n === T.daysAWeek() ? 'on' : ''}" data-days="${n}">${n} days</button>`).join(''))}</div>
      <ul class="split">${raw(wk.map(x => html`<li class="${raw(x.day === today() ? 'now' : '')}"><span>${DAYS[new Date(x.day + 'T12:00').getDay()]}</span><b>${x.session ? x.session.name : 'Rest and mobility'}</b></li>`).join(''))}</ul>
      <p class="small muted">Every muscle twice a week and 10+ hard sets; jumps, throws and sprints first while fresh; 10 minutes of mobility every day; sleep 7-9 hours. Add weight or a rep when the last set feels easy.</p>
      <div class="btn-row"><button class="btn ghost" data-ai>${raw(icon('sparkle'))} Adjust with Yaver</button></div>
    </section>
    </div></div>`;

  wireBodyTabs(root, go);
  root.querySelector('[data-done]')?.addEventListener('click', async () => { const v = await rateForm(); if (!v) return; await T.markDone(today(), session?.key || 'fullA', v); haptic('success'); toast('Session done'); });
  root.querySelector('[data-rate]')?.addEventListener('click', async () => { const v = await rateForm(done); if (v) await T.rate(today(), v); });
  root.querySelector('[data-undo]')?.addEventListener('click', async () => { const had = done; await T.markDone(); toast('Session undone', { action: { label: 'Undo', run: () => db.put('workouts', had) } }); });
  root.querySelectorAll('[data-days]').forEach(b => (b.onclick = () => db.setSetting('trainDays', Number(b.dataset.days))));
  root.querySelectorAll('.anatomy [data-m]').forEach(g => (g.onclick = () => { picked = picked === g.dataset.m ? '' : g.dataset.m; render(root, go); }));
  root.querySelector('[data-ai]').onclick = () => openAssistant('Look at my training plan, what I actually did, my training load and morning readiness (body_status). My goal is the body of a gymnast or fighter: muscular, strong, fast and flexible. Check the plan against this week and suggest plain adjustments for next week. Say what is an estimate.');
}

function rateForm(have = {}) {
  return sheet({
    title: 'How was it?',
    body: '<p class="small muted">RPE: 10 is the hardest you could go, 7 is hard with a few reps left, 4 is easy. Coaches multiply it by minutes to track load.</p>',
    fields: [
      { name: 'rpe', label: 'How hard, 1-10', type: 'select', value: String(have.rpe || 7), options: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => [String(n), `${n}${{ 10: ' · max', 9: ' · very hard', 8: ' · hard', 7: ' · hard, reps left', 5: ' · moderate', 3: ' · easy' }[n] || ''}`]) },
      { name: 'min', label: 'Minutes', type: 'number', step: '5', value: have.min || 60 },
    ],
    submit: 'Save',
  });
}

function day(x) {
  const dn = DAYS[new Date(x.day + 'T12:00').getDay()][0];
  const mark = x.done ? 'done' : x.session ? (x.day < today() ? 'missed' : 'planned') : 'rest';
  return `<div class="wd ${x.day === today() ? 'is-today' : ''}" title="${x.day}"><small>${dn}</small><i class="dot ${mark}"></i></div>`;
}

// ---------- The muscle map ----------
const PARTS = new Set(['head', 'hair', 'hands', 'feet', 'ankles', 'knees']);
const level = n => (!n ? 0 : n < 5 ? 1 : n < 10 ? 2 : 3);
function map(side, sets, todays) {
  const vb = side === 'front' ? '0 0 724 1448' : '724 0 724 1448';
  const groups = Object.entries(ANATOMY[side]).map(([m, paths]) => {
    const part = PARTS.has(m);
    const cls = part ? 'part' : `mus m${level(sets[m])}${todays.has(m) ? ' tday' : ''}${picked === m ? ' picked' : ''}`;
    return `<g class="${cls}"${part ? '' : ` data-m="${m}" role="button" aria-label="${T.MUSCLE_NAMES[m] || m}"`}>${paths.map(d => `<path d="${d}"/>`).join('')}</g>`;
  }).join('');
  return `<figure><svg viewBox="${vb}" class="muscle-map">${groups}<path class="outline" d="${ANATOMY.outline[side]}"/></svg><figcaption>${side === 'front' ? 'Front' : 'Back'}</figcaption></figure>`;
}
function info(m, sets, session) {
  const n = Math.round((sets[m] || 0) * 10) / 10;
  const ex = T.exercisesFor(m, session);
  return html`<b>${T.MUSCLE_NAMES[m] || m}</b>: ${n} hard set${n === 1 ? '' : 's'} this week${n < 10 ? ' (aim 10+)' : ''}.${raw(ex.length ? html` Today: ${ex.join(', ')}.` : '')}`;
}
