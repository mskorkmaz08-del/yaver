// Body (v67): one section, bottom right of the tab bar, with three parts:
// Body (this screen), Training (views/training.js) and Diet (views/diet.js).
// This screen: the morning readiness check, weight and composition with their
// trend, the athletic goal and the food plan for it, tape measurements,
// performance tests, what the data says, and every body record. The numbers
// come from js/body.js; every estimate says so.
import * as db from '../db.js';
import * as B from '../body.js';
import * as IN from '../insights.js';
import { html, raw, fmtDay, toast, haptic, today, sheet } from '../util.js';
import { icon } from '../icons.js';
import { openAssistant } from '../ai/assistant.js';

const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en');
const n0 = n => Math.round(n).toLocaleString('en');
const short = d => new Date(d + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// The Body · Training · Diet switch at the top of all three screens.
export function bodyTabs(active) {
  return html`<nav class="body-tabs" aria-label="Body sections">${raw([['body', 'Body'], ['training', 'Training'], ['diet', 'Diet']].map(([k, l]) => html`<button data-btab="${k}" class="${raw(k === active ? 'on' : '')}" ${raw(k === active ? 'aria-current="page"' : '')}>${l}</button>`).join(''))}</nav>`;
}
export function wireBodyTabs(root, go) {
  root.querySelectorAll('[data-btab]').forEach(b => (b.onclick = () => { if (!b.classList.contains('on')) go(b.dataset.btab); }));
}

export function render(root, go) {
  const s = B.status();
  if (!s) { setup(root, go); return; }
  const { profile: p, target: t } = s;
  const a = B.analysis();
  const r = a.readiness;
  const tr = a.trend, comp = a.composition;
  const prev = B.weighins().at(-2);
  const finds = IN.all().filter(f => ['Body', 'Training', 'Recovery'].includes(f.area));
  const meas = B.measurements();
  const tests = B.tests(p.male);
  const anyTest = tests.some(x => x.value != null);
  const recs = B.records().slice().reverse();

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Yaver <b>·</b> body</p><h1><span class="num">${p.kg}</span> kg</h1></div>
      <div class="head-btns"><button class="icon-btn" data-profile aria-label="Edit profile">${raw(icon('edit'))}</button></div>
    </header>
    ${raw(bodyTabs('body'))}

    <div class="log-row">
      <button data-log="weight">${raw(icon('scale'))}<span>Weight</span></button>
      <button data-log="ready">${raw(icon('sun'))}<span>Morning</span></button>
      <button data-log="measure">${raw(icon('ruler'))}<span>Measure</span></button>
      <button data-log="test">${raw(icon('bolt'))}<span>Test</span></button>
    </div>

    <div class="bcols"><div class="bcol">
    <section class="card ready ${raw(r ? 'r-' + r.call : '')}">
      <div class="card-head"><p class="label">readiness today</p>${raw(r ? html`<button class="link-btn" data-log="ready">Edit</button>` : '')}</div>
      ${raw(r ? html`
        <div class="ready-top"><b class="mono">${r.score}</b><span><strong>${{ ready: 'Ready to push', normal: 'Normal day', easy: 'Take it easy' }[r.call]}</strong><small>${r.advice}</small></span></div>
        <p class="small muted ready-facts">${[r.sleep ? `Sleep ${r.sleep} h` : '', r.rhr ? `pulse ${r.rhr}${r.base ? ` (usual ${r.base})` : ''}` : '', ...Object.entries(B.LEVELS).filter(([k]) => r.entry[k]).map(([k, [label, opts]]) => `${label.toLowerCase()} ${opts.find(o => o[0] === r.entry[k])?.[1].toLowerCase()}`)].filter(Boolean).join(' · ')}</p>`
      : html`<p class="small">Thirty seconds after waking: sleep, resting pulse, soreness, energy and stress. Coaches use this to decide when to push and when to back off.</p>
        <button class="btn primary wide" data-log="ready">${raw(icon('sun'))} Morning check</button>`)}
    </section>

    <section class="card bstats">
      <div class="card-head"><p class="label">body now</p><span class="small muted">${fmtDay(p.weighedOn)}</span></div>
      <div class="stat4">
        <div><small>Weight</small><b class="mono">${p.kg}<i>kg</i></b>${raw(prev ? html`<em class="mono">${sign(Math.round((p.kg - prev.kg) * 10) / 10)}</em>` : '')}</div>
        <div><small>Body fat</small><b class="mono">${p.bodyFat}<i>%</i></b><em>${{ measured: 'measured', tape: 'tape', waist: 'waist', BMI: 'rough' }[p.fatFrom]}</em></div>
        <div><small>Lean mass</small><b class="mono">${p.lean}<i>kg</i></b><em class="mono">FFMI ${p.ffmi}</em></div>
        <div><small>Waist / height</small><b class="mono">${a.waistHeight ?? '—'}</b><em>${a.waistHeight ? (a.waistHeight <= 0.45 ? 'athletic' : a.waistHeight < 0.5 ? 'healthy' : 'over 0.5') : 'add waist'}</em></div>
      </div>
      ${raw(chart(B.series(90)))}
      <p class="small trend-line">${raw(tr ? html`<b class="mono">${sign(tr.kgWeek)} kg</b> a week (${sign(tr.pctWeek)}%): ${a.pace}.` : '<span class="muted">Weigh in 2-3 times a week, in the morning after the toilet, before eating. The trend appears after 10 days.</span>')}</p>
      ${raw(comp ? html`<p class="small">Since ${short(comp.from)}: fat <b class="mono ${raw(comp.fat > 0 ? 'up' : 'good')}">${sign(comp.fat)} kg</b>, lean <b class="mono ${raw(comp.lean >= 0 ? 'good' : 'up')}">${sign(comp.lean)} kg</b>.</p>` : '')}
      ${raw(p.fatFrom === 'BMI' || p.fatFrom === 'waist' ? html`<p class="small muted">Body fat is ${p.fatFrom === 'BMI' ? 'a rough guess from height and weight' : 'from the waist alone'}. Measure neck and waist${p.male ? '' : ' and hips'} for the tape formula coaches use.</p>` : '')}
    </section>

    <section class="card goal">
      <div class="card-head"><p class="label">athletic goal</p><span class="chip-tag">${t.mode === 'cut' ? 'Phase 1: lose fat' : 'Lean gain'}</span></div>
      <p class="goal-line"><b class="mono">${p.kg}</b><span class="arrow">→</span><b class="mono lume">${t.kg}</b><span class="unit">kg at ${t.bodyFat}% fat</span></p>
      <p class="small">${[t.fatToLose ? `Lose about ${t.fatToLose} kg of fat` : '', t.muscle ? `${t.fatToLose ? 'gain' : 'Gain'} about ${t.muscle} kg of muscle` : ''].filter(Boolean).join(', then ')}${t.months ? `. Roughly ${t.months} month${t.months === 1 ? '' : 's'}.` : ''}</p>
      ${raw(compBar('Now', p.kg - p.fatKg, p.fatKg, Math.max(p.kg, t.kg)))}
      ${raw(compBar('Target', t.lean, t.kg - t.lean, Math.max(p.kg, t.kg)))}
      <div class="macro-grid">
        <div><small>kcal a day</small><b class="mono">${n0(t.calories)}</b></div><div><small>Protein</small><b class="mono">${t.protein} g</b></div>
        <div><small>Carbs</small><b class="mono">${t.carbs} g</b></div><div><small>Fat</small><b class="mono">${t.fat} g</b></div>
      </div>
      <p class="small muted">${t.mode === 'cut' ? 'About 450 kcal under your burn' : 'About 10% over your burn'} (≈ ${n0(p.tdee)} kcal). The lean, strong look of gymnasts and fighters: FFMI ${t.ffmi}, lots of muscle for the weight.</p>
      <div class="btn-row"><button class="btn ghost" data-goals>${raw(icon('target'))} Use as my diet goals</button></div>
    </section>

    </div><div class="bcol">
    <section class="card meas">
      <div class="card-head"><p class="label">measurements</p><button class="link-btn" data-log="measure">Measure</button></div>
      <table class="btable"><thead><tr><th></th><th>cm</th><th>change</th></tr></thead><tbody>
        ${raw(meas.map(m => html`<tr class="${raw(m.value == null ? 'none' : '')}"><td>${m.label}</td><td class="mono">${m.value ?? '—'}</td><td class="mono ${raw(m.change == null ? 'muted' : (m.key === 'waist' || m.key === 'hips' ? m.change > 0 : m.change < 0) ? 'up' : m.change ? 'good' : 'muted')}">${m.change == null ? '' : sign(m.change)}</td></tr>`).join(''))}
      </tbody></table>
      <p class="small muted">Every 2-4 weeks, in the morning, relaxed. Waist down and arms, chest and thighs steady or up is fat off and muscle kept.</p>
    </section>

    <section class="card tests">
      <div class="card-head"><p class="label">performance tests</p><button class="link-btn" data-log="test">Test</button></div>
      ${raw(anyTest ? '' : '<p class="small muted">The basics gymnastics, lifting and fight coaches test: pull-ups, push-ups, dips, dead hang, jumps, a 20 m sprint, core holds and reach. Test every 4-6 weeks, fresh, after a warm-up. Do the ones you can.</p>')}
      <ul class="tlist">${raw(tests.map(x => html`<li class="${raw(x.value == null ? 'none' : x.met ? 'met' : '')}">
        <span class="t-name">${x.label}<small>${x.group}</small></span>
        <span class="t-bar"><i style="width:${raw((x.of * 100).toFixed(0))}%"></i></span>
        <b class="mono">${x.value == null ? '—' : x.value}<small> / ${x.target} ${x.unit}</small></b>
        <em class="mono ${raw(x.better == null ? '' : x.better ? 'good' : 'up')}">${x.change == null ? '' : sign(x.change)}</em></li>`).join(''))}</ul>
    </section>

    <section class="card finds">
      <div class="card-head"><p class="label">what the data says</p></div>
      ${raw(finds.length ? html`<ul class="find-list">${raw(finds.map(f => html`<li class="lv${f.level}"><span>${f.text}</span>${raw(f.ask ? html`<button class="link-btn" data-ask="${f.id}">Ask</button>` : '')}</li>`).join(''))}</ul>`
        : '<p class="small muted">Nothing stands out. Findings show here when your weigh-ins, measurements, tests, mornings and training show a pattern.</p>')}
      <div class="btn-row"><button class="btn ghost" data-ai>${raw(icon('sparkle'))} Review my body with Yaver</button></div>
    </section>

    </div></div>
    <section class="list records">
      <h4 class="list-day">Records <span>${recs.length}</span></h4>
      ${raw(recs.slice(0, 8).map(w => html`<button class="row" data-w="${w.id}"><span class="row-main"><b>${fmtDay(w.date)}</b><small>${summary(w)}</small></span><span class="row-amt">${w.kg ? `${w.kg} kg` : ''}</span></button>`).join(''))}
    </section>
    <p class="small muted body-note">${p.height} cm · ${p.age} years · ${p.male ? 'male' : 'female'}. Estimates from standard formulas and studies, not a medical measurement.</p>`;

  wireBodyTabs(root, go);
  root.querySelector('[data-profile]').onclick = () => profileForm();
  root.querySelectorAll('[data-log]').forEach(b => (b.onclick = () => ({ weight: () => weighForm(), ready: () => readyForm(), measure: () => measureForm(), test: () => testForm() })[b.dataset.log]()));
  root.querySelectorAll('[data-w]').forEach(b => (b.onclick = () => recordForm(db.get('weighins', b.dataset.w))));
  root.querySelectorAll('[data-ask]').forEach(b => (b.onclick = () => openAssistant(finds.find(f => f.id === b.dataset.ask)?.ask)));
  root.querySelector('[data-goals]').onclick = async () => {
    await db.setSetting('dailyCalories', t.calories); await db.setSetting('dailyProtein', t.protein);
    haptic(); toast(`Diet goals: ${n0(t.calories)} kcal, ${t.protein} g protein`);
  };
  root.querySelector('[data-ai]').onclick = () => openAssistant('Review my body data (body_status): weight trend and pace, body fat and lean mass change, measurements, performance tests against the targets, morning readiness and training load. My goal is the body of a gymnast or fighter: muscular, strong, fast and flexible. Tell me plainly what is going well, what is off, and the one or two changes to make next. Say what is an estimate.');
}

function summary(w) {
  const parts = [];
  const m = B.SITES.filter(([k]) => w[k] != null).length;
  const t = B.TESTS.filter(([k]) => w[k] != null).length;
  if (w.fat) parts.push(`${w.fat}% fat`);
  if (m) parts.push(m === 1 ? `${B.SITES.find(([k]) => w[k] != null)[1].toLowerCase()} ${w[B.SITES.find(([k]) => w[k] != null)[0]]} cm` : `${m} measurements`);
  if (t) parts.push(`${t} test${t === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

// Weight over 90 days: each weigh-in as a dot, the 7-day average as the line.
function chart(list) {
  if (list.length < 2) return '';
  const W = 320, H = 110, pad = 6;
  const t0 = new Date(list[0].date + 'T12:00').getTime(), t1 = new Date(list.at(-1).date + 'T12:00').getTime();
  const vals = list.flatMap(x => [x.kg, x.avg]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
  const X = d => pad + ((new Date(d + 'T12:00').getTime() - t0) / Math.max(1, t1 - t0)) * (W - pad * 2 - 30);
  const Y = v => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2 - 14);
  const line = list.map((x, i) => `${i ? 'L' : 'M'}${X(x.date).toFixed(1)} ${Y(x.avg).toFixed(1)}`).join(' ');
  return `<svg class="wchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight over the last 90 days">
    <line x1="${pad}" x2="${W - 30}" y1="${Y(hi).toFixed(1)}" y2="${Y(hi).toFixed(1)}" class="grid"/><line x1="${pad}" x2="${W - 30}" y1="${Y(lo).toFixed(1)}" y2="${Y(lo).toFixed(1)}" class="grid"/>
    <text x="${W - 26}" y="${(Y(hi) + 4).toFixed(1)}">${hi.toFixed(1)}</text><text x="${W - 26}" y="${(Y(lo) + 4).toFixed(1)}">${lo.toFixed(1)}</text>
    ${list.map(x => `<circle cx="${X(x.date).toFixed(1)}" cy="${Y(x.kg).toFixed(1)}" r="2.2"/>`).join('')}
    <path d="${line}"/>
    <text x="${pad}" y="${H - 2}">${short(list[0].date)}</text><text x="${W - 30}" y="${H - 2}" text-anchor="end">${short(list.at(-1).date)}</text></svg>`;
}

function compBar(label, lean, fat, max) {
  const w = v => ((v / max) * 100).toFixed(1);
  return html`<div class="comp"><span>${label}</span><div class="comp-bar"><i class="lean" style="width:${raw(w(lean))}%"></i><i class="fat" style="width:${raw(w(fat))}%"></i></div><small class="mono">${Math.round(lean)} lean · ${Math.round(fat)} fat</small></div>`;
}

// ---------- First run ----------
function setup(root, go) {
  root.innerHTML = html`
    <header class="page-head"><div><p class="path">Yaver <b>·</b> body</p><h1>Your body</h1></div></header>
    ${raw(bodyTabs('body'))}
    <section class="card body-setup">
      <p>Height and weight are all it needs to start. From them Yaver sets an athletic target, the food and training plan for it, and tracks what changes. Measurements, tests and a morning check make it sharper later.</p>
      <button class="btn primary" data-setup>Start</button>
    </section>`;
  wireBodyTabs(root, go);
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

// ---------- Forms ----------
export async function profileForm() {
  const v = await sheet({
    title: 'Your body',
    body: '<p class="small muted">Only height is needed; the rest makes the estimates closer.</p>',
    fields: [
      { name: 'height', label: 'Height (cm)', type: 'number', value: db.setting('bodyHeight', '') || '', step: '0.5', required: true },
      { name: 'birth', label: 'Year of birth', type: 'number', value: db.setting('bodyBirth', '') || '', placeholder: 'Age 30 is assumed' },
      { name: 'sex', label: 'Sex (for the formulas)', type: 'select', value: db.setting('bodySex', 'm'), options: [['m', 'Male'], ['f', 'Female']] },
      { name: 'activity', label: 'Day to day, training included', type: 'select', value: db.setting('bodyActivity', 'moderate'), options: B.ACTIVITY.map(a => [a[0], a[1]]) },
      { name: 'experience', label: 'Lifting experience', type: 'select', value: db.setting('bodyExperience', 'new'), options: B.EXPERIENCE.map(e => [e[0], e[1]]) },
    ],
  });
  if (!v) return;
  if (!(v.height > 120 && v.height < 230)) { toast('Height should be in centimetres, like 178.'); return; }
  await db.setSetting('bodyHeight', v.height);
  if (v.birth) await db.setSetting('bodyBirth', v.birth);
  await db.setSetting('bodySex', v.sex);
  await db.setSetting('bodyActivity', v.activity);
  await db.setSetting('bodyExperience', v.experience);
  haptic(); toast('Saved');
}

const dateField = (value = today()) => ({ name: 'date', label: 'Date', type: 'date', value });

export async function weighForm() {
  const v = await sheet({
    title: 'Weight',
    body: '<p class="small muted">Morning, after the toilet, before food or drink. 2-3 times a week is enough; the trend matters, not one day.</p>',
    fields: [
      { name: 'kg', label: 'Weight (kg)', type: 'number', value: B.latest()?.kg ?? '', step: '0.1', required: true },
      { name: 'fat', label: 'Body fat % if measured by a scan or calipers (optional)', type: 'number', step: '0.1' },
      dateField(),
    ],
  });
  if (!v) return;
  try { await B.logBody({ kg: v.kg, fat: v.fat ?? '' }, v.date || today()); haptic(); toast(`${v.kg} kg logged`); } catch (e) { toast(e.message); }
}

export async function measureForm(date = today()) {
  const have = db.all('weighins').find(w => w.date === date) || {};
  const v = await sheet({
    title: 'Measurements',
    body: '<p class="small muted">Centimetres, tape level and snug, not tight. Fill only what you measured; leave the rest empty.</p>',
    fields: [...B.SITES.map(([k, label, how]) => ({ name: k, label: `${label}: ${how.toLowerCase()}`, type: 'number', step: '0.5', value: have[k] ?? '', placeholder: String(B.lastTwo(k).now?.[k] ?? '') })), dateField(date)],
  });
  if (!v) return;
  const { date: d, ...rest } = v;
  if (!(await B.logBody(Object.fromEntries(Object.entries(rest).map(([k, x]) => [k, x ?? ''])), d || today()))) return;
  haptic(); toast('Measurements saved');
}

export async function testForm(date = today()) {
  const have = db.all('weighins').find(w => w.date === date) || {};
  const male = db.setting('bodySex', 'm') !== 'f';
  const v = await sheet({
    title: 'Performance tests',
    body: '<p class="small muted">Warm up first, rest fully between tries, and log the best. Fill only the tests you did.</p>',
    fields: [...B.TESTS.map(([k, label, unit, , tm, tf, , how]) => ({ name: k, label: `${label} (${unit}, target ${male ? tm : tf}): ${how}`, type: 'number', step: unit === 's' && k === 'sprint20' ? '0.01' : unit === 'cm' ? '1' : '1', value: have[k] ?? '', placeholder: String(B.lastTwo(k).now?.[k] ?? '') })), dateField(date)],
  });
  if (!v) return;
  const { date: d, ...rest } = v;
  if (!(await B.logBody(Object.fromEntries(Object.entries(rest).map(([k, x]) => [k, x ?? ''])), d || today()))) return;
  haptic(); toast('Tests saved');
}

export async function readyForm(date = today()) {
  const c = B.readinessOn(date) || {};
  const v = await sheet({
    title: 'Morning check',
    body: '<p class="small muted">Right after waking. Resting pulse: sitting still, count 30 seconds and double it, or read it from a watch.</p>',
    fields: [
      { name: 'sleep', label: 'Hours slept', type: 'number', step: '0.25', value: c.sleep ?? '', placeholder: '7.5' },
      { name: 'rhr', label: 'Resting pulse (beats a minute, optional)', type: 'number', step: '1', value: c.rhr ?? '' },
      ...Object.entries(B.LEVELS).map(([k, [label, opts]]) => ({ name: k, label, type: 'select', value: c[k] || opts[1][0], options: opts })),
    ],
  });
  if (!v) return;
  await B.logReadiness(v, date);
  const r = B.readiness(date);
  haptic(); toast(r ? `Readiness ${r.score}: ${{ ready: 'ready to push', normal: 'a normal day', easy: 'take it easy' }[r.call]}` : 'Saved');
}

// A past record: edit any of its parts, or delete it.
async function recordForm(existing) {
  if (!existing) return;
  const v = await sheet({
    title: fmtDay(existing.date),
    danger: 'Delete',
    body: html`<p class="small muted">${summary(existing) || 'Weight only'}</p>`,
    fields: [{ name: 'kg', label: 'Weight (kg)', type: 'number', step: '0.1', value: existing.kg ?? '' }, { name: 'fat', label: 'Body fat % (measured)', type: 'number', step: '0.1', value: existing.fat ?? '' }],
    submit: 'Save',
  });
  if (!v) return;
  if (v.__danger) { await db.remove('weighins', existing.id); toast('Record deleted', { action: { label: 'Undo', run: () => db.put('weighins', existing) } }); return; }
  try { await B.logBody({ kg: v.kg ?? null, fat: v.fat ?? null }, existing.date); haptic(); toast('Saved'); } catch (e) { toast(e.message); }
  // Measurements and tests of that day open in their own forms.
  if (B.SITES.some(([k]) => existing[k] != null)) await measureForm(existing.date);
  if (B.TESTS.some(([k]) => existing[k] != null)) await testForm(existing.date);
}
