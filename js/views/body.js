// Body (v56): a figure of the body now, in 30 days if eating carries on like
// this, and at the athletic target; what today, the week and the month of eating
// did (fat and muscle in grams); the projection; the plan to the target; weigh-ins.
// Every number is an estimate (see js/body.js for the formulas).
import * as db from '../db.js';
import * as B from '../body.js';
import { html, raw, fmtDay, toast, haptic, today, sheet } from '../util.js';
import { icon } from '../icons.js';
import { openAssistant } from '../ai/assistant.js';

let view = 'now';

const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en');
const grams = g => `${sign(Math.round(g))} g`;
const kgs = k => `${sign(Math.round(k * 10) / 10)} kg`;

export function render(root, go) {
  const s = B.status();
  if (!s) { setup(root, go); return; }
  const { profile: p, target: t, projection: pr } = s;
  const shapes = {
    now: { label: 'Now', ...B.shape(p) },
    month: pr ? { label: 'In 30 days', ...B.shape(p, { kg: pr.month.kg, bodyFat: ((p.fatKg + pr.month.fat) / pr.month.kg) * 100 }) } : null,
    target: { label: 'Target', ...B.shape(p, { kg: t.kg, bodyFat: t.bodyFat }) },
  };
  if (!shapes[view]) view = 'now';
  const shown = shapes[view];
  const today_ = s.today;

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Yaver <b>·</b> body</p><h1><span class="num">${p.kg}</span> kg</h1></div>
      <div class="head-btns"><button class="icon-btn" data-profile aria-label="Edit profile">${raw(icon('edit'))}</button><button class="icon-btn primary" data-weigh aria-label="Log weight">${raw(icon('plus'))}</button></div>
    </header>

    <section class="card body-fig">
      <div class="chips">${raw(Object.entries(shapes).filter(([, v]) => v).map(([k, v]) => `<button class="chip ${k === view ? 'on' : ''}" data-view="${k}">${v.label}</button>`).join(''))}</div>
      <div class="fig-row">
        ${raw(figure(shown, shapes.target, view !== 'target'))}
        <dl class="fig-stats">
          <div><dt>Weight</dt><dd class="mono">${view === 'now' ? p.kg : view === 'month' ? pr.month.kg : t.kg} kg</dd></div>
          <div><dt>Body fat</dt><dd class="mono">${Math.round(shown.bodyFat)}%</dd></div>
          <div><dt>Lean mass</dt><dd class="mono">${Math.round((view === 'now' ? p.kg : view === 'month' ? pr.month.kg : t.kg) * (1 - shown.bodyFat / 100))} kg</dd></div>
          <div><dt>FFMI</dt><dd class="mono">${shown.ffmi.toFixed(1)}</dd></div>
          <div><dt>BMI</dt><dd class="mono">${p.bmi}</dd></div>
        </dl>
      </div>
      <p class="small muted">${view === 'target' ? `Athletic: FFMI ${t.ffmi} at ${t.bodyFat}% body fat.` : 'Dashed outline: your athletic target.'} Body fat ${p.fatFrom === 'measured' ? 'as measured' : p.fatFrom === 'waist' ? 'estimated from your waist' : 'estimated from BMI and age (add your waist for a better guess)'}.</p>
    </section>

    <section class="card body-day">
      <div class="card-head"><p class="label">today's effect</p><span class="small muted">burn ≈ ${p.tdee.toLocaleString('en')} kcal</span></div>
      ${raw(today_.counted ? html`<p class="effect"><b class="mono">${sign(today_.balance)} kcal</b> <span>${today_.balance >= 0 ? 'over' : 'under'} what you burn</span></p>
        <div class="fm"><span>Fat</span><b class="mono ${raw(today_.fat > 0 ? 'up' : 'down')}">${grams(today_.fat)}</b><span>Muscle</span><b class="mono ${raw(today_.muscle > 0 ? 'good' : today_.muscle < 0 ? 'up' : '')}">${grams(today_.muscle)}</b></div>`
        : html`<p class="small muted">${today_.logged ? 'Log the rest of today to see its effect.' : 'Nothing logged today yet.'}</p>`)}
      <div class="week-bars" aria-label="Last 7 days">${raw(s.week.list.map(d => bar(d)).join(''))}</div>
      <div class="fm sums">
        <span>7 days</span><b class="mono">${s.week.days ? `fat ${grams(s.week.fat)} · muscle ${grams(s.week.muscle)}` : 'no full days'}</b>
        <span>30 days</span><b class="mono">${s.month.days ? `fat ${grams(s.month.fat)} · muscle ${grams(s.month.muscle)}` : 'no full days'}</b>
      </div>
      ${raw(p.training ? '' : '<p class="small muted">Muscle only grows with strength training: set your sessions a week in the profile.</p>')}
    </section>

    <section class="card body-proj">
      <div class="card-head"><p class="label">if you keep eating like this</p></div>
      ${raw(pr ? html`<p class="small">Average of ${pr.from} full days: <b class="mono">${pr.kcal.toLocaleString('en')}</b> kcal and <b class="mono">${pr.protein} g</b> protein (${sign(pr.balance)} kcal a day).</p>
        <div class="proj">${raw([pr.month, pr.quarter].map(x => html`<div><small>${x.days === 30 ? 'In a month' : 'In 3 months'}</small><b class="mono">${x.kg} kg</b><span class="mono small">fat ${kgs(x.fat)} · muscle ${kgs(x.muscle)}</span></div>`).join(''))}</div>`
        : '<p class="small muted">Log three full days of food to see where they lead.</p>')}
    </section>

    <section class="card body-plan">
      <div class="card-head"><p class="label">athletic target</p><span class="small muted">${t.low}–${t.high} kg</span></div>
      <p><b class="mono">${t.kg} kg</b> at ${t.bodyFat}% body fat${t.muscle || t.fatToLose ? ':' : '.'} ${[t.fatToLose ? `lose about ${t.fatToLose} kg of fat` : '', t.muscle ? `gain about ${t.muscle} kg of muscle` : ''].filter(Boolean).join(' and ')}${t.muscle || t.fatToLose ? '.' : ''}</p>
      <p class="small">${t.mode === 'cut' ? 'Lose fat first' : 'Lean gain'}: about <b class="mono">${t.calories.toLocaleString('en')} kcal</b> and <b class="mono">${t.protein} g</b> protein a day, strength training 3 or more times a week. Roughly ${t.months} month${t.months === 1 ? '' : 's'}.</p>
      <div class="btn-row"><button class="btn ghost" data-goals>${raw(icon('target'))} Use as my diet goals</button><button class="btn ghost" data-ai>${raw(icon('sparkle'))} Plan with Yaver</button></div>
    </section>

    <section class="list weighins">
      <h4 class="list-day">Weigh-ins <span>${B.weighins().length}</span></h4>
      ${raw(B.weighins().slice(-6).reverse().map((w, i, a) => html`<button class="row" data-w="${w.id}"><span class="row-main"><b>${fmtDay(w.date)}</b><small class="mono">${[w.waist ? `waist ${w.waist} cm` : '', w.fat ? `${w.fat}% fat` : ''].filter(Boolean).join(' · ')}</small></span><span class="row-amt">${w.kg} kg${raw(a[i + 1] ? ` <small class="muted">${kgs(w.kg - a[i + 1].kg)}</small>` : '')}</span></button>`).join(''))}
    </section>
    <p class="small muted body-note">Estimates from standard formulas, not a medical measurement. Weigh in once a week, same time of day, and the numbers get better.</p>`;

  root.querySelectorAll('[data-view]').forEach(b => (b.onclick = () => { view = b.dataset.view; render(root, go); }));
  root.querySelector('[data-weigh]').onclick = () => weighForm();
  root.querySelector('[data-profile]').onclick = () => profileForm();
  root.querySelectorAll('[data-w]').forEach(b => (b.onclick = () => weighForm(db.get('weighins', b.dataset.w))));
  root.querySelector('[data-goals]').onclick = async () => {
    await db.setSetting('dailyCalories', t.calories); await db.setSetting('dailyProtein', t.protein);
    haptic(); toast(`Diet goals: ${t.calories} kcal, ${t.protein} g protein`);
  };
  root.querySelector('[data-ai]').onclick = () => openAssistant('Look at my body profile, target and recent eating (body_status, diet_history). Make me a plain plan for the next 4 weeks to move toward the athletic target: daily calories and protein, what a typical day of food looks like here in Kazakhstan, and a simple strength-training schedule. Say what is an estimate.');
}

// One day in the week strip: a bar up for a surplus, down for a deficit.
function bar(d) {
  const h = d.counted ? Math.min(28, Math.abs(d.balance) / 25) : 0;
  const day = new Date(d.date + 'T12:00').toLocaleDateString('en-GB', { weekday: 'narrow' });
  return `<div class="wb ${d.counted ? (d.balance >= 0 ? 'plus' : 'minus') : 'none'}" title="${d.date}: ${d.counted ? `${d.balance} kcal` : 'not logged'}"><i style="height:${h.toFixed(1)}px"></i><small>${day}</small></div>`;
}

// ---------- The figure ----------
// A front silhouette built from a few widths: shoulders, arms and legs grow
// with lean mass (FFMI), the waist and hips with body fat.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function outline(sh) {
  const mu = clamp((sh.ffmi - 17) / 6, 0, 1), fa = clamp((sh.bodyFat - 8) / 24, 0, 1);
  const neck = 9 + 2.5 * mu, shoulder = 33 + 15 * mu + 3 * fa, chest = 28 + 10 * mu + 8 * fa, waist = 20 + 4 * mu + 22 * fa, hip = 26 + 4 * mu + 15 * fa;
  const knee = 24 + 3 * mu + 3 * fa, calf = 26 + 5 * mu + 3 * fa, ankle = 18, inner = clamp(6 - 9 * fa, 0.5, 6);
  const right = [[neck, 62], [neck + 6, 74], [shoulder, 86], [chest, 118], [waist + 2, 160], [waist, 176], [hip, 208], [hip - 1, 240], [knee + 1, 300], [calf, 330], [ankle, 378], [ankle + 5, 392],
    [7, 392], [8, 378], [8 + 2 * mu, 330], [7, 300], [inner + 1, 252], [0, 240]];
  const pts = [...right.map(([x, y]) => [100 + x, y]), ...right.slice(0, -1).reverse().map(([x, y]) => [100 - x, y])];
  const armW = 8 + 7 * mu + 5 * fa;
  const arm = s => {
    const a = [[shoulder - 2, 84], [shoulder + armW * 0.55, 98], [shoulder + armW * 0.6, 128], [shoulder + armW * 0.4 + 2, 166], [shoulder + armW * 0.3 + 2, 210], [shoulder + 2, 240], [shoulder - 2, 256],
      [shoulder - 9, 252], [shoulder - 8, 238], [shoulder - armW * 0.4 - 6, 198], [shoulder - armW * 0.5 - 6, 150], [chest - 2, 116]];
    // The arm hangs a little away from the body, more towards the hand.
    return smooth(a.map(([x, y]) => [100 + s * (x + clamp((y - 100) / 156, 0, 1) * 9), y]));
  };
  return { body: smooth(pts), arms: [arm(1), arm(-1)] };
}
// Catmull-Rom through the points, as a closed cubic Bézier path.
function smooth(p) {
  const n = p.length, f = v => v.toFixed(1);
  let d = `M${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p[(i - 1 + n) % n], p[i], p[(i + 1) % n], p[(i + 2) % n]];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + 'Z';
}
export function figure(sh, goal, showGoal) {
  const o = outline(sh), g = outline(goal);
  return `<svg class="figure" viewBox="20 6 160 392" role="img" aria-label="Body figure">
    ${o.arms.map(a => `<path class="f-arm" d="${a}"/>`).join('')}
    <path class="f-body" d="${o.body}"/>
    <circle class="f-body" cx="100" cy="38" r="19"/>
    ${showGoal ? `<g class="f-goal">${g.arms.map(a => `<path d="${a}"/>`).join('')}<path d="${g.body}"/></g>` : ''}
  </svg>`;
}

// ---------- Profile and weigh-ins ----------
function setup(root) {
  root.innerHTML = html`
    <header class="page-head"><div><p class="path">Yaver <b>·</b> body</p><h1>Your body</h1></div></header>
    <section class="card body-setup">
      <p>Add your height and weight to see your athletic target weight, what each day of eating does (fat and muscle), and where a month of eating like this leads.</p>
      <button class="btn primary" data-setup>Set up</button>
    </section>`;
  root.querySelector('[data-setup]').onclick = () => profileForm(true);
}

export async function profileForm(first = false) {
  const w = B.latest();
  const v = await sheet({
    title: 'Your body',
    fields: [
      { name: 'height', label: 'Height (cm)', type: 'number', value: db.setting('bodyHeight', '') || '', step: '0.5', required: true, placeholder: '178' },
      ...(first || !w ? [{ name: 'kg', label: 'Weight (kg)', type: 'number', value: w?.kg || '', step: '0.1', required: true, placeholder: '74.5' }] : []),
      { name: 'birth', label: 'Year of birth', type: 'number', value: db.setting('bodyBirth', '') || '', placeholder: '1996' },
      { name: 'sex', label: 'Sex (for the formulas)', type: 'select', value: db.setting('bodySex', 'm'), options: [['m', 'Male'], ['f', 'Female']] },
      { name: 'activity', label: 'Day to day', type: 'select', value: db.setting('bodyActivity', 'light'), options: B.ACTIVITY.map(a => [a[0], a[1]]) },
      { name: 'training', label: 'Strength sessions a week', type: 'number', value: db.setting('bodyTraining', 0), step: '1', placeholder: '3' },
      { name: 'experience', label: 'Lifting experience', type: 'select', value: db.setting('bodyExperience', 'new'), options: B.EXPERIENCE.map(e => [e[0], e[1]]) },
    ],
  });
  if (!v) return;
  if (!(v.height > 120 && v.height < 230)) { toast('Height should be in centimetres, like 178.'); return; }
  await db.setSetting('bodyHeight', v.height);
  if (v.birth) await db.setSetting('bodyBirth', v.birth);
  await db.setSetting('bodySex', v.sex);
  await db.setSetting('bodyActivity', v.activity);
  await db.setSetting('bodyTraining', Math.max(0, Math.min(14, Math.round(v.training || 0))));
  await db.setSetting('bodyExperience', v.experience);
  if (v.kg) { try { await B.logWeight({ kg: v.kg }); } catch (e) { toast(e.message); return; } }
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
