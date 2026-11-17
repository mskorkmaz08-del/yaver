// Body (v56, rebuilt in v57): the athletic goal (weight now → target, fat and lean
// mass), today's food and training side by side, a front and back muscle map lit
// by this week's training, the week and where eating like this leads, the plan
// (diet numbers and the weekly training split) and weigh-ins. Every number is an
// estimate (formulas in js/body.js, the plan in js/training.js).
import * as db from '../db.js';
import * as D from '../data.js';
import * as B from '../body.js';
import * as T from '../training.js';
import { ANATOMY } from '../anatomy.js';
import { html, raw, fmtDay, toast, haptic, today, sheet } from '../util.js';
import { icon } from '../icons.js';
import { openAssistant } from '../ai/assistant.js';

let picked = '';

const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en');
const grams = g => `${sign(Math.round(g))} g`;
const kgs = k => `${sign(Math.round(k * 10) / 10)} kg`;
const n0 = n => Math.round(n).toLocaleString('en');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function render(root, go) {
  const s = B.status();
  if (!s) { setup(root); return; }
  const { profile: p, target: t, projection: pr } = s;
  const d = D.dietDay(today());
  const session = T.sessionOn();
  const done = T.doneOn(today());
  const sets = T.setsThisWeek();
  const todays = T.musclesOf(session);
  const wk = T.week();
  const balance = new Map(s.week.list.map(x => [x.date, x]));

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Yaver <b>·</b> body</p><h1><span class="num">${p.kg}</span> kg</h1></div>
      <div class="head-btns"><button class="icon-btn" data-profile aria-label="Edit profile">${raw(icon('edit'))}</button><button class="icon-btn primary" data-weigh aria-label="Log weight">${raw(icon('plus'))}</button></div>
    </header>

    <section class="card goal">
      <div class="card-head"><p class="label">athletic goal</p><span class="chip-tag">${t.mode === 'cut' ? 'Phase 1: lose fat' : 'Lean gain'}</span></div>
      <p class="goal-line"><b class="mono">${p.kg}</b><span class="arrow">→</span><b class="mono lume">${t.kg}</b><span class="unit">kg</span></p>
      <p class="small">${[t.fatToLose ? `Lose about ${t.fatToLose} kg of fat` : '', t.muscle ? `${t.fatToLose ? 'gain' : 'Gain'} about ${t.muscle} kg of muscle` : ''].filter(Boolean).join(', then ')}${t.months ? `. Roughly ${t.months} month${t.months === 1 ? '' : 's'}.` : ''}</p>
      ${raw(comp('Now', p.kg - p.fatKg, p.fatKg, Math.max(p.kg, t.kg)))}
      ${raw(comp('Target', t.lean, t.kg - t.lean, Math.max(p.kg, t.kg)))}
      <p class="small muted">Muscular, strong, fast and flexible: ${t.bodyFat}% body fat with the lean mass of a trained athlete your height (FFMI ${t.ffmi}). Body fat now ${p.fatFrom === 'measured' ? 'as measured' : p.fatFrom === 'waist' ? 'from your waist' : 'estimated from height and weight; add your waist at the next weigh-in for a better number'}.</p>
    </section>

    <div class="today-grid">
      <section class="card eat">
        <div class="card-head"><p class="label">eat today</p><button class="link-btn" data-diet>Diet ›</button></div>
        ${raw(meter('Calories', d.calories, t.calories, 'kcal'))}
        ${raw(meter('Protein', d.protein, t.protein, 'g'))}
        ${raw(meter('Carbs', d.carbs, t.carbs, 'g'))}
        ${raw(meter('Fat', d.fat, t.fat, 'g'))}
        <p class="small effect-line">${raw(s.today.counted ? html`So far today: fat <b class="mono ${raw(s.today.fat > 0 ? 'up' : 'good')}">${grams(s.today.fat)}</b>, muscle <b class="mono ${raw(s.today.muscle > 0 ? 'good' : s.today.muscle < 0 ? 'up' : '')}">${grams(s.today.muscle)}</b>` : `<span class="muted">${s.today.logged ? 'Log the rest of today to see its effect on fat and muscle.' : 'Log what you eat to see its effect on fat and muscle.'}</span>`)}</p>
      </section>

      <section class="card train">
        <div class="card-head"><p class="label">train today</p><span class="small muted">${DAYS[new Date().getDay()]}</span></div>
        ${raw(session ? html`<p class="session">${session.name}</p>
          <ol class="ex-list">${raw(session.items.map(([ex, n, reps]) => html`<li><span>${T.EX[ex][0]}</span><b class="mono">${n} × ${reps}</b></li>`).join(''))}</ol>`
          : '<p class="session">Rest day</p><p class="small muted">Walk, and do the mobility block.</p>')}
        <p class="small muted">${T.MOBILITY}</p>
        ${raw(session ? html`<button class="btn ${raw(done ? 'ghost' : 'primary')} wide" data-done>${raw(icon('check'))} ${done ? 'Done today (undo)' : 'Mark session done'}</button>` : '')}
      </section>
    </div>

    <section class="card muscles">
      <div class="card-head"><p class="label">muscles this week</p><span class="small muted">hard sets, aim 10+</span></div>
      <div class="anatomy">${raw(map('front', sets, todays))}${raw(map('back', sets, todays))}</div>
      <div class="legend"><span><i class="m0"></i>0</span><span><i class="m1"></i>1-4</span><span><i class="m2"></i>5-9</span><span><i class="m3"></i>10+</span>${raw(session ? '<span><i class="tday"></i>today</span>' : '')}</div>
      <p class="small muscle-info">${raw(picked ? info(picked, sets, session) : '<span class="muted">Tap a muscle to see its sets and today\'s exercises for it.</span>')}</p>
    </section>

    <section class="card week">
      <div class="card-head"><p class="label">this week</p><span class="small muted">burn ≈ ${n0(p.tdee)} kcal a day</span></div>
      <div class="week-row">${raw(wk.map(x => day(x, balance.get(x.day))).join(''))}</div>
      <p class="small muted week-key"><i class="dot done"></i> trained <i class="dot planned"></i> planned <i class="dot missed"></i> missed · bars: <span class="up">over</span> or <span class="good">under</span> your burn</p>
      ${raw(pr ? html`<p class="small">If you keep eating like your last ${pr.from} full days (${n0(pr.kcal)} kcal, ${pr.protein} g protein, ${sign(pr.balance)} kcal a day):</p>
        <div class="proj">${raw([pr.month, pr.quarter].map(x => html`<div><small>${x.days === 30 ? 'In a month' : 'In 3 months'}</small><b class="mono">${x.kg} kg</b><span class="mono small">fat ${kgs(x.fat)} · muscle ${kgs(x.muscle)}</span></div>`).join(''))}</div>`
        : '<p class="small muted">After three fully logged days, this shows where eating like that leads in a month and in three.</p>')}
    </section>

    <section class="card plan">
      <div class="card-head"><p class="label">your plan</p></div>
      <h4>Food a day</h4>
      <div class="macro-grid">
        <div><small>Calories</small><b class="mono">${n0(t.calories)}</b></div><div><small>Protein</small><b class="mono">${t.protein} g</b></div>
        <div><small>Carbs</small><b class="mono">${t.carbs} g</b></div><div><small>Fat</small><b class="mono">${t.fat} g</b></div>
      </div>
      <p class="small muted">${t.mode === 'cut' ? 'About 450 kcal under your burn: fat comes off while the lifting and high protein keep the muscle.' : 'About 10% over your burn: enough to build muscle without much fat.'} Protein spread over 3-4 meals; carbs around training; fish twice a week for omega-3.</p>
      <div class="btn-row"><button class="btn ghost" data-goals>${raw(icon('target'))} Use as my diet goals</button></div>
      <h4>Training</h4>
      <div class="chips days-pick">${raw([3, 4, 5].map(n => `<button class="chip ${n === T.daysAWeek() ? 'on' : ''}" data-days="${n}">${n} days</button>`).join(''))}</div>
      <ul class="split">${raw(wk.map(x => html`<li class="${raw(x.day === today() ? 'now' : '')}"><span>${DAYS[new Date(x.day + 'T12:00').getDay()]}</span><b>${x.session ? x.session.name : 'Rest and mobility'}</b></li>`).join(''))}</ul>
      <p class="small muted">Every muscle twice a week and 10+ hard sets; jumps, throws and sprints first while fresh; 10 minutes of mobility every day; sleep 7-9 hours. Add weight or a rep when the last set feels easy.</p>
      <div class="btn-row"><button class="btn ghost" data-ai>${raw(icon('sparkle'))} Adjust with Yaver</button></div>
    </section>

    <section class="list weighins">
      <h4 class="list-day">Weigh-ins <span>${B.weighins().length}</span></h4>
      ${raw(B.weighins().slice(-6).reverse().map((w, i, a) => html`<button class="row" data-w="${w.id}"><span class="row-main"><b>${fmtDay(w.date)}</b><small class="mono">${[w.waist ? `waist ${w.waist} cm` : '', w.fat ? `${w.fat}% fat` : ''].filter(Boolean).join(' · ')}</small></span><span class="row-amt">${w.kg} kg${raw(a[i + 1] ? ` <small class="muted">${kgs(w.kg - a[i + 1].kg)}</small>` : '')}</span></button>`).join(''))}
    </section>
    <p class="small muted body-note">Estimates from standard formulas and studies, not a medical measurement. Weigh in once a week at the same time of day; the numbers improve as real weigh-ins come in.</p>`;

  root.querySelector('[data-weigh]').onclick = () => weighForm();
  root.querySelector('[data-profile]').onclick = () => profileForm();
  root.querySelector('[data-diet]').onclick = () => go('diet');
  root.querySelectorAll('[data-w]').forEach(b => (b.onclick = () => weighForm(db.get('weighins', b.dataset.w))));
  root.querySelector('[data-done]')?.addEventListener('click', async () => { const r = await T.markDone(); haptic(); if (r) toast('Session done'); });
  root.querySelectorAll('[data-days]').forEach(b => (b.onclick = () => db.setSetting('trainDays', Number(b.dataset.days))));
  root.querySelectorAll('.anatomy [data-m]').forEach(g => (g.onclick = () => { picked = picked === g.dataset.m ? '' : g.dataset.m; render(root, go); }));
  root.querySelector('[data-goals]').onclick = async () => {
    await db.setSetting('dailyCalories', t.calories); await db.setSetting('dailyProtein', t.protein);
    haptic(); toast(`Diet goals: ${n0(t.calories)} kcal, ${t.protein} g protein`);
  };
  root.querySelector('[data-ai]').onclick = () => openAssistant('Look at my body, goal, training plan and recent eating (body_status, diet_history). My goal is an athletic body: muscular, strong, fast and flexible. Check the plan against what I actually did this week and suggest plain adjustments for the next week: food (with foods easy to get in Kazakhstan) and training. Say what is an estimate.');
}

// A lean | fat bar, scaled to the heavier of now and target.
function comp(label, lean, fat, max) {
  const w = v => ((v / max) * 100).toFixed(1);
  return html`<div class="comp"><span>${label}</span><div class="comp-bar"><i class="lean" style="width:${raw(w(lean))}%"></i><i class="fat" style="width:${raw(w(fat))}%"></i></div><small class="mono">${Math.round(lean)} lean · ${Math.round(fat)} fat</small></div>`;
}
function meter(label, v, goal, unit) {
  const pct = goal ? Math.min(100, (v / goal) * 100) : 0;
  return html`<div class="meter"><div class="meter-top"><span>${label}</span><b class="mono">${n0(v)}<small> / ${n0(goal)} ${unit}</small></b></div><div class="bar"><div class="${raw(v > goal * 1.05 ? 'over' : '')}" style="width:${raw(pct.toFixed(1))}%"></div></div></div>`;
}
function day(x, b) {
  const dn = DAYS[new Date(x.day + 'T12:00').getDay()][0];
  const mark = x.done ? 'done' : x.session ? (x.day < today() ? 'missed' : 'planned') : 'rest';
  const h = b?.counted ? Math.min(22, Math.abs(b.balance) / 30) : 0;
  return `<div class="wd ${x.day === today() ? 'is-today' : ''}" title="${x.day}${b?.counted ? `: ${b.balance} kcal` : ''}">
    <small>${dn}</small><i class="dot ${mark}"></i>
    <span class="bal">${b?.counted ? `<i class="${b.balance >= 0 ? 'plus' : 'minus'}" style="height:${h.toFixed(1)}px"></i>` : ''}</span></div>`;
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

// ---------- Profile and weigh-ins ----------
function setup(root) {
  root.innerHTML = html`
    <header class="page-head"><div><p class="path">Yaver <b>·</b> body</p><h1>Your body</h1></div></header>
    <section class="card body-setup">
      <p>Your height and weight are all it needs. From them Yaver sets your athletic target weight, the food and training plan to reach it, and shows what each day of eating does to fat and muscle.</p>
      <button class="btn primary" data-setup>Start</button>
    </section>`;
  root.querySelector('[data-setup]').onclick = () => startForm();
}

async function startForm() {
  const v = await sheet({
    title: 'Your body',
    fields: [
      { name: 'height', label: 'Height (cm)', type: 'number', step: '0.5', required: true, placeholder: '178' },
      { name: 'kg', label: 'Weight (kg)', type: 'number', step: '0.1', required: true, placeholder: '74.5' },
    ],
    submit: 'Make my plan',
  });
  if (!v) return;
  if (!(v.height > 120 && v.height < 230)) { toast('Height should be in centimetres, like 178.'); return; }
  try { await B.logWeight({ kg: v.kg }); } catch (e) { toast(e.message); return; }
  await db.setSetting('bodyHeight', v.height);
  haptic();
}

export async function profileForm() {
  const v = await sheet({
    title: 'Your body',
    body: '<p class="small muted">Only height is needed; the rest makes the estimates closer.</p>',
    fields: [
      { name: 'height', label: 'Height (cm)', type: 'number', value: db.setting('bodyHeight', '') || '', step: '0.5', required: true },
      { name: 'birth', label: 'Year of birth', type: 'number', value: db.setting('bodyBirth', '') || '', placeholder: 'Age 30 is assumed' },
      { name: 'sex', label: 'Sex (for the formulas)', type: 'select', value: db.setting('bodySex', 'm'), options: [['m', 'Male'], ['f', 'Female']] },
      { name: 'activity', label: 'Day to day, training included', type: 'select', value: db.setting('bodyActivity', 'moderate'), options: B.ACTIVITY.map(a => [a[0], a[1]]) },
      { name: 'days', label: 'Training days a week', type: 'select', value: T.daysAWeek(), options: [[3, '3 (full body)'], [4, '4 (upper / lower)'], [5, '5 (upper / lower + speed)']] },
      { name: 'experience', label: 'Lifting experience', type: 'select', value: db.setting('bodyExperience', 'new'), options: B.EXPERIENCE.map(e => [e[0], e[1]]) },
    ],
  });
  if (!v) return;
  if (!(v.height > 120 && v.height < 230)) { toast('Height should be in centimetres, like 178.'); return; }
  await db.setSetting('bodyHeight', v.height);
  if (v.birth) await db.setSetting('bodyBirth', v.birth);
  await db.setSetting('bodySex', v.sex);
  await db.setSetting('bodyActivity', v.activity);
  await db.setSetting('trainDays', Number(v.days));
  await db.setSetting('bodyExperience', v.experience);
  haptic(); toast('Saved');
}

export async function weighForm(existing) {
  const v = await sheet({
    title: existing ? `Weigh-in, ${fmtDay(existing.date)}` : 'Log weight',
    danger: existing ? 'Delete' : null,
    fields: [
      { name: 'kg', label: 'Weight (kg)', type: 'number', value: existing?.kg ?? B.latest()?.kg ?? '', step: '0.1', required: true },
      { name: 'date', label: 'Date', type: 'date', value: existing?.date || today() },
      { name: 'waist', label: 'Waist at the navel, cm (optional, better body fat)', type: 'number', value: existing?.waist ?? '', step: '0.5' },
      { name: 'fat', label: 'Body fat % if measured (optional)', type: 'number', value: existing?.fat ?? '', step: '0.1' },
    ],
  });
  if (!v) return;
  if (v.__danger) { await db.remove('weighins', existing.id); toast('Weigh-in deleted', { action: { label: 'Undo', run: () => db.put('weighins', existing) } }); return; }
  try {
    if (existing && existing.date !== v.date) await db.remove('weighins', existing.id);
    await B.logWeight({ kg: v.kg, date: v.date || today(), waist: v.waist, fat: v.fat });
    haptic(); toast(`${v.kg} kg logged`);
  } catch (e) { toast(e.message); }
}
