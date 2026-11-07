import * as D from '../data.js';
import * as db from '../db.js';
import { html, raw, today, addDays, fmtDay, shrinkImage, toast, haptic } from '../util.js';
import * as F from '../foodscan.js';
import * as L from '../dietlog.js';
import * as G from '../foodgaps.js';
import * as B from '../body.js';
import { ring } from '../ui.js';
import { icon } from '../icons.js';
import { mealForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';

let day = today();
let span = 7;

export function render(root, go) {
  const d = D.dietDay(day);
  const g = d.goals;
  const macro = (label, v, goal, color) => html`
    <div><div class="macro-top"><span>${label}</span><b>${Math.round(v)}g<small> / ${goal}g</small></b></div>
    <div class="bar"><div style="width:${raw(goal ? Math.min(100, (v / goal) * 100) : 0)}%;background:${raw(color)}"></div></div></div>`;
  const carbsGoal = Math.round((g.dailyCalories * 0.45) / 4);
  const fatGoal = Math.round((g.dailyCalories * 0.3) / 9);

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Yaver <b>·</b> diet</p><h1><span class="num">${Math.max(0, g.dailyCalories - Math.round(d.calories))}</span> kcal left</h1></div>
      <div class="head-btns"><button class="icon-btn" data-body aria-label="Body">${raw(icon('body'))}</button><button class="icon-btn primary" data-add aria-label="Log meal">${raw(icon('plus'))}</button></div>
    </header>
    <div class="switch"><button data-d="-1" aria-label="Previous day">${raw(icon('chevronLeft'))}</button><span>${fmtDay(day).toLowerCase()}</span><button data-d="1" ${raw(day === today() ? 'disabled' : '')} aria-label="Next day">${raw(icon('chevronRight'))}</button></div>

    <section class="card diet-top">
      ${raw(ring(d.calories, g.dailyCalories, { size: 112, stroke: 7, color: d.calories > g.dailyCalories ? 'var(--red)' : 'var(--accent)', label: String(Math.round(d.calories)), sub: `/ ${g.dailyCalories}` }))}
      <div class="macros">
        ${raw(macro('Protein', d.protein, g.dailyProtein, 'var(--accent)'))}
        ${raw(macro('Carbs', d.carbs, carbsGoal, 'var(--blue)'))}
        ${raw(macro('Fat', d.fat, fatGoal, 'var(--amber)'))}
      </div>
    </section>

    ${raw(day === today() ? bodyLine() : '')}

    <div class="btn-row">
      <button class="btn ghost" data-snap>${raw(icon('camera'))} Photo a meal</button>
      <button class="btn ghost" data-type-meal>${raw(icon('edit'))} Type a meal</button>
      <button class="btn ghost" data-ai>${raw(icon('sparkle'))} What next?</button>
    </div>

    ${raw(D.MEAL_TYPES.map(type => {
      // Any spelling of the meal type counts (the assistant may write "lunch"); unknown types land in Snack.
      const kind = m => D.MEAL_TYPES.find(t => t.toLowerCase() === String(m.meal || '').trim().toLowerCase()) || 'Snack';
      const items = d.meals.filter(m => kind(m) === type);
      return html`<section class="list">
        <h4 class="list-day">${type} <span>${items.reduce((a, m) => a + m.calories, 0)} kcal</span></h4>
        ${raw(items.map(m => html`<button class="row" data-id="${m.id}"><span class="row-main"><b>${m.name}</b><small class="mono">P${m.protein} C${m.carbs} F${m.fat}${m.source === 'photo' ? ' · photo' : m.source === 'typed' ? ' · typed' : ''}</small></span><span class="row-amt">${m.calories}</span></button>`).join('') || `<button class="row add-row" data-type="${type}">+ ${type.toLowerCase()}</button>`)}
      </section>`;
    }).join(''))}

    ${raw(day === today() ? tipsCard() : '')}

    ${raw(nutrients(d))}

    ${raw(diary())}`;

  root.querySelector('[data-add]').onclick = () => mealForm(null, day);
  root.querySelectorAll('[data-body]').forEach(b => (b.onclick = () => go('body')));
  root.querySelectorAll('[data-type]').forEach(b => (b.onclick = () => mealForm(null, day, { meal: b.dataset.type })));
  root.querySelectorAll('[data-id]').forEach(b => (b.onclick = () => mealForm(db.get('meals', b.dataset.id))));
  root.querySelectorAll('[data-d]').forEach(b => (b.onclick = () => { day = addDays(day, Number(b.dataset.d)); render(root); }));
  root.querySelector('[data-snap]').onclick = () => pickPhoto(day);
  root.querySelector('[data-type-meal]').onclick = () => photoSheet(null, day);
  root.querySelectorAll('[data-span]').forEach(b => (b.onclick = () => { span = Number(b.dataset.span); render(root); }));
  root.querySelector('[data-weak]')?.addEventListener('click', () => openAssistant(`I feel weak or unwell. Look at what I have eaten and drunk over the last ${span} days (diet_history) and tell me plainly: am I eating enough, which vitamins or minerals look low, which days were thin, and what simple foods would close the gaps. Say what the data can't show, and when I should see a doctor instead.`));
  root.querySelector('[data-csv]')?.addEventListener('click', exportDiary);
  root.querySelector('[data-tips]')?.addEventListener('click', async () => {
    tipsBusy = true; tipsError = ''; render(root);
    try { await G.suggest({ onStatus: t => { const el = root.querySelector('.tips-status'); if (el) el.textContent = t; } }); }
    catch (e) { tipsError = e.message; }
    tipsBusy = false;
    if (root.isConnected) render(root);
  });
  root.querySelector('[data-ai]').onclick = () => openAssistant('Given what I ate today and my goals, suggest 3 simple options for my next meal with rough calories and protein.');
}

// What today's eating does to the body (v56), one line that opens the Body screen.
function bodyLine() {
  const s = B.status();
  if (!s) return html`<button class="card body-line" data-body><span class="label">body</span><span class="small">Add your height and weight: athletic target, and what each day does to fat and muscle.</span></button>`;
  const t = s.today, r = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`;
  return html`<button class="card body-line" data-body><span class="label">body · ${s.profile.kg} kg → ${s.target.kg} kg</span>
    <span class="small">${raw(t.counted ? html`Today ${r(t.balance)} kcal: fat <b class="mono">${r(t.fat)} g</b>, muscle <b class="mono">${r(t.muscle)} g</b>` : 'Log today\'s meals to see what they do to fat and muscle.')}</span></button>`;
}

// ---------- Fill the gaps (v55): foods for the rest of today or tomorrow ----------
let tipsBusy = false, tipsError = '';
function tipsCard() {
  const c = G.cached();
  const stale = c && c.key !== G.gaps().key;
  return html`<section class="card tips">
    <div class="card-head"><p class="label">fill the gaps${c ? ` · ${c.for === 'tomorrow' ? 'for tomorrow' : 'rest of today'}` : ''}</p>
      <button class="btn ghost small" data-tips ${raw(tipsBusy ? 'disabled' : '')}>${raw(icon('sparkle'))} ${tipsBusy ? 'Thinking…' : c ? (stale ? 'Update' : 'Again') : 'Suggest foods'}</button></div>
    ${raw(tipsBusy ? '<p class="small muted tips-status">Looking at today and the last week…</p>' : '')}
    ${raw(tipsError ? html`<p class="small warn-text">${tipsError}</p>` : '')}
    ${raw(c ? html`<p class="small">${c.summary}</p>
      <div class="tips-list">${raw(c.items.map(i => html`<div class="tip"><b>${i.food}</b><span class="mono small">${i.amount}${i.when ? ` · ${i.when}` : ''}</span><small class="muted">${i.why}</small></div>`).join(''))}</div>
      ${raw(c.ease ? html`<p class="small"><span class="muted">Less of:</span> ${c.ease}</p>` : '')}
      ${raw(stale ? '<p class="small muted">You have logged more since this; tap Update.</p>' : '')}`
      : !tipsBusy ? '<p class="small muted">Foods and drinks that cover what today and the last week are missing: protein, vitamins, minerals and the right kind of fat.</p>' : '')}
  </section>`;
}

// Fiber, sugar and sodium for the day, and vitamins and minerals from photo-logged meals.
function nutrients(d) {
  if (!d.fiber && !d.sugar && !d.sodium && !d.detailed) return '';
  const bar = (label, v, ref, unit, limit) => {
    const pct = ref ? (v / ref) * 100 : 0;
    return html`<div class="nut"><span>${label}</span><div class="bar"><div class="${raw(limit && pct > 100 ? 'over' : '')}" style="width:${raw(Math.min(100, pct).toFixed(1))}%"></div></div><b class="mono">${fmt(v)}${unit} <small>${Math.round(pct)}%</small></b></div>`;
  };
  const shown = F.MICROS.filter(([k]) => d.micros[k] > 0);
  return html`<section class="card nutrients">
    <div class="card-head"><p class="label">nutrients</p><span class="small muted">% of daily value</span></div>
    ${raw(bar('Fiber', d.fiber, F.DAILY.fiber, 'g'))}
    ${raw(bar('Sugar', d.sugar, F.DAILY.sugar, 'g', true))}
    ${raw(bar('Sodium', d.sodium, F.DAILY.sodium, 'mg', true))}
    ${raw(fatMix(d))}
    ${raw(shown.map(([k, label, unit, ref]) => bar(label, d.micros[k], ref, unit, k === 'caffeine')).join(''))}
    ${raw(d.detailed ? html`<p class="small muted">Vitamins and minerals from ${d.detailed} photo-logged meal${d.detailed > 1 ? 's' : ''}. All estimates.</p>` : '')}
  </section>`;
}
// Which kind of fat (v55): saturated against its limit, omega-3 against its target,
// and the mono / poly / saturated split so a day heavy on seed oils shows up.
function fatMix(d) {
  const m = d.micros, kinds = (m.satFat || 0) + (m.monoFat || 0) + (m.polyFat || 0);
  if (kinds < 1) return '';
  const share = k => Math.round(((m[k] || 0) / kinds) * 100);
  return html`<div class="fat-mix"><span>Fat</span><div class="fat-split" aria-label="Fat split">
      <i class="sat" style="width:${raw(share('satFat'))}%"></i><i class="mono-f" style="width:${raw(share('monoFat'))}%"></i><i class="poly" style="width:${raw(share('polyFat'))}%"></i></div>
    <small>saturated ${share('satFat')}% · mono ${share('monoFat')}% · poly ${share('polyFat')}%</small></div>
  <div class="nut"><span>Saturated fat</span><div class="bar"><div class="${raw((m.satFat || 0) > F.DAILY.satFat ? 'over' : '')}" style="width:${raw(Math.min(100, ((m.satFat || 0) / F.DAILY.satFat) * 100).toFixed(1))}%"></div></div><b class="mono">${fmt(m.satFat || 0)}g <small>${Math.round(((m.satFat || 0) / F.DAILY.satFat) * 100)}%</small></b></div>
  <div class="nut"><span>Omega-3</span><div class="bar"><div style="width:${raw(Math.min(100, ((m.omega3 || 0) / F.DAILY.omega3) * 100).toFixed(1))}%"></div></div><b class="mono">${fmt(m.omega3 || 0)}g <small>${Math.round(((m.omega3 || 0) / F.DAILY.omega3) * 100)}%</small></b></div>`;
}
const fmt = v => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('en');

// ---------- Food photo or typed meal: photo (+ note) or words → Gemini estimate → check → log ----------
function pickPhoto(day) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try { photoSheet(await shrinkImage(file, 1024), day); } catch { toast('Could not open that photo.'); }
  };
  input.click();
}

export function photoSheet(image, day = today()) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  let result = null, items = [], busy = false, ctrl = null;
  const hour = new Date().getHours();
  let meal = hour < 11 ? 'Breakfast' : hour < 16 ? 'Lunch' : hour < 21 ? 'Dinner' : 'Snack';
  let note = '', dish = '';

  const close = () => { ctrl?.abort(); wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 250); };
  const draw = () => {
    const t = F.totals(items);
    wrap.innerHTML = html`<div class="sheet tall food-sheet" role="dialog" aria-label="${image ? 'Food photo' : 'Type a meal'}">
      <div class="grabber"></div>
      <h2>${result ? 'Check and log' : image ? 'Food photo' : 'What did you eat or drink?'}</h2>
      ${raw(image ? html`<img class="food-img" src="${image.url}" alt="">` : '')}
      ${raw(!result ? html`
        ${raw(image ? html`<label class="field"><span>Anything the photo doesn't show? (optional)</span><input name="note" value="${note}" placeholder="fried in butter, 2 sugars, ate half…" autocomplete="off"></label>`
          : html`<label class="field"><span>Write it the way you'd say it, with amounts if you know them</span><textarea name="note" rows="3" placeholder="2 eggs, a slice of bread with butter, black tea with 1 sugar">${note}</textarea></label>`)}
        <p class="small muted food-status">${busy ? 'Looking things up…' : image ? 'Gemini reads labels, measures each item against the plate, cup or cutlery, and looks up brands and local recipes before adding up the nutrients.' : 'Gemini looks up each item (brand, local recipe, spoon and cup sizes), then works out its amount and nutrients; you check them before logging.'}</p>
        <div class="sheet-actions"><button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-go ${raw(busy ? 'disabled' : '')}>${busy ? 'Estimating…' : 'Estimate'}</button></div>` : html`
        <label class="field"><span>Name</span><input name="dish" value="${dish}"></label>
        <div class="food-items">
          ${raw(items.length ? items.map((it, i) => html`<div class="food-item">
            <span class="fi-name">${it.name}<small class="mono">${Math.round(it.calories)} kcal · P${Math.round(it.protein)}</small>${raw(it.basis || it.source ? html`<small class="fi-basis">${[it.basis, it.source].filter(Boolean).join(' · ')}</small>` : '')}</span>
            <label class="fi-g"><input type="number" inputmode="decimal" min="0" data-g="${i}" value="${Math.round(it.grams)}"><span>g</span></label>
            <button class="icon-btn" data-x="${i}" aria-label="Remove ${it.name}">${raw(icon('close'))}</button>
          </div>`).join('') : '<p class="small muted">No food found in this photo.</p>')}
        </div>
        <div class="food-total">
          <b class="mono">${Math.round(t.calories)} kcal</b>
          <span class="mono">P ${Math.round(t.protein)}g · C ${Math.round(t.carbs)}g · F ${Math.round(t.fat)}g</span>
          <span class="mono small muted">Fiber ${fmt(t.fiber)}g · Sugar ${fmt(t.sugar)}g · Sodium ${Math.round(t.sodium)}mg</span>
          ${raw(t.fat >= 1 ? html`<span class="mono small muted">Fat: saturated ${fmt(t.satFat)}g · mono ${fmt(t.monoFat)}g · poly ${fmt(t.polyFat)}g · omega-3 ${fmt(t.omega3)}g</span>` : '')}
          <span class="small muted">${F.MICROS.filter(([k]) => t[k] >= 0.05).map(([k, label, unit, ref]) => `${label} ${Math.round((t[k] / ref) * 100)}%`).join(' · ')}</span>
        </div>
        <p class="small muted">${result.confidence === 'low' ? 'Low confidence. ' : ''}${result.note || 'Change a weight if it looks off; everything else follows.'}</p>
        ${raw(result.sources?.length ? html`<p class="small muted food-sources">Looked up: ${raw(result.sources.map(s => html`<a href="${s.uri}" target="_blank" rel="noopener">${s.title}</a>`).join(', '))}</p>` : result.researched === false ? '<p class="small muted food-sources">Search was busy, so this is a direct estimate without looking things up.</p>' : '')}
        <label class="field"><span>Meal</span><select name="meal">${raw(D.MEAL_TYPES.map(m => `<option ${m === meal ? 'selected' : ''}>${m}</option>`).join(''))}</select></label>
        <div class="sheet-actions"><button class="btn ghost" data-again>Try again</button><button class="btn primary" data-log ${raw(items.length ? '' : 'disabled')}>Log ${Math.round(t.calories)} kcal</button></div>`)}
    </div>`;
    wrap.querySelector('[data-cancel]')?.addEventListener('click', close);
    const n = wrap.querySelector('[name=note]'); if (n) n.oninput = () => (note = n.value);
    if (n && !image && !busy && !note) setTimeout(() => n.focus(), 300);
    const dn = wrap.querySelector('[name=dish]'); if (dn) dn.oninput = () => (dish = dn.value);
    const ms = wrap.querySelector('[name=meal]'); if (ms) ms.onchange = () => (meal = ms.value);
    wrap.querySelector('[data-go]')?.addEventListener('click', run);
    wrap.querySelector('[data-again]')?.addEventListener('click', () => { result = null; items = []; draw(); });
    wrap.querySelectorAll('[data-g]').forEach(inp => (inp.onchange = () => { const i = Number(inp.dataset.g); items[i] = F.scaleItem(result.items[i], Math.max(0, Number(inp.value) || 0)); setTimeout(draw); })); // redraw after the field's blur finishes
    wrap.querySelectorAll('[data-x]').forEach(b => (b.onclick = () => { items.splice(Number(b.dataset.x), 1); result.items.splice(Number(b.dataset.x), 1); draw(); }));
    wrap.querySelector('[data-log]')?.addEventListener('click', async () => {
      await D.logMeal(F.mealRow({ dish: dish.trim() || result.dish, items, meal, date: day, confidence: result.confidence, source: image ? 'photo' : 'typed', sources: result.sources }));
      haptic(); close();
      toast(`Logged ${Math.round(F.totals(items).calories)} kcal · ${Math.round(F.totals(items).protein)}g protein`);
    });
  };
  async function run() {
    if (!image && !note.trim()) { toast('Write what you ate or drank first.'); return; }
    busy = true; draw();
    ctrl = new AbortController();
    try {
      result = await F.scanFood(image, note, { signal: ctrl.signal, onStatus: t => { const el = wrap.querySelector('.food-status'); if (el) el.textContent = t; } });
      items = result.items.map(i => ({ ...i }));
      dish = result.dish;
      if (D.MEAL_TYPES.includes(result.meal)) meal = result.meal;
    } catch (e) {
      if (e.name === 'AbortError') return;
      toast(e.message, 5000);
    }
    busy = false;
    if (wrap.isConnected) draw();
  }
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  draw();
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
}

// ---------- Food diary: the last 7 or 30 days, what's running low, and an export ----------
function diary() {
  if (!db.all('meals').length) return '';
  const r = L.report(span);
  const get = k => r.nutrients.find(x => x.key === k);
  const kc = get('calories'), pr = get('protein');
  return html`<section class="card diary">
    <div class="card-head"><p class="label">food diary</p>
      <div class="chips">${raw([7, 30].map(n => `<button class="chip ${n === span ? 'on' : ''}" data-span="${n}">${n} days</button>`).join(''))}</div></div>
    <p class="small">${r.loggedDays} of ${r.days} days logged${raw(r.loggedDays ? html` · average <b class="mono">${Math.round(kc.avg)}</b> kcal (${kc.pct}%) and <b class="mono">${Math.round(pr.avg)}g</b> protein (${pr.pct}%)` : '')}.</p>
    ${raw(r.low.length ? html`<p class="small"><span class="muted">Running low:</span> ${r.low.slice(0, 6).map(x => `${x.label} ${x.pct}%`).join(' · ')}</p>` : r.detailedDays ? '<p class="small muted">Nothing running low on the days with vitamin data.</p>' : '')}
    ${raw(r.high.length ? html`<p class="small"><span class="muted">Above the limit:</span> ${r.high.map(x => `${x.label} ${x.pct}%`).join(' · ')}</p>` : '')}
    ${raw(r.lowCalorieDays.length ? html`<p class="small muted">Thin days (under 70% of your calories): ${r.lowCalorieDays.length}</p>` : '')}
    <p class="small muted">Vitamins and minerals come from photo and typed meals (${r.detailedDays} of the logged days). Every meal is kept.</p>
    <div class="btn-row"><button class="btn ghost" data-weak>${raw(icon('sparkle'))} I feel weak: check my diet</button><button class="btn ghost" data-csv>${raw(icon('share'))} Download diary</button></div>
  </section>`;
}

async function exportDiary() {
  const blob = new Blob([L.csv()], { type: 'text/csv' });
  const file = new File([blob], `yaver-food-diary-${today()}.csv`, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
  document.body.append(a); a.click(); a.remove();
}
