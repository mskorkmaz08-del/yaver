import * as D from '../data.js';
import * as db from '../db.js';
import { html, raw, money, compact, today, addDays, fmtDay, monthKey, parseDay, sum, sheet } from '../util.js';
import { barList, columns, empty } from '../ui.js';
import { icon } from '../icons.js';
import { expenseForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';

let month = monthKey();

export function render(root) {
  const list = D.expensesInMonth(month).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const total = sum(list, e => e.amount);
  const budget = D.goals().monthlyBudget;
  const isNow = month === monthKey();
  const s = D.moneySummary();
  const label = parseDay(month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const k = addDays(today(), -i);
    last7.push({ label: parseDay(k).toLocaleDateString('en-GB', { weekday: 'narrow' }), value: sum(D.expensesBetween(k, k), e => e.amount), highlight: i === 0 });
  }
  const byDay = {};
  for (const e of list) (byDay[e.date] ||= []).push(e);

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Yaver <b>·</b> money</p><h1 class="num">${money(total)}</h1></div>
      <button class="icon-btn primary" data-add aria-label="Add expense">${raw(icon('plus'))}</button>
    </header>

    <div class="switch">
      <button data-m="-1" aria-label="Previous month">${raw(icon('chevronLeft'))}</button><span>${label.toLowerCase()}</span><button data-m="1" ${raw(isNow ? 'disabled' : '')} aria-label="Next month">${raw(icon('chevronRight'))}</button>
    </div>

    ${raw(budget ? html`
      <section class="card">
        <div class="card-head"><p class="label">budget</p><span class="small muted mono">${money(budget)}</span></div>
        <div class="bar thick ${raw(total > budget ? 'over' : total / budget > .85 ? 'warn' : '')}"><div style="width:${raw(Math.min(100, (total / budget) * 100))}%"></div></div>
        <p class="small">${raw(total > budget ? `<span class="bad">${money(total - budget)} over</span>` : `<span class="mono">${money(budget - total)}</span> left`)}
          ${raw(isNow && s.dailyAllowance !== null && total <= budget ? ` · <span class="mono accent">${money(s.dailyAllowance)}</span>/day for the rest of the month` : '')}</p>
      </section>` : html`
      <button class="card" data-budget><p class="label">budget</p><p class="small muted">Set a monthly budget to get a daily allowance.</p></button>`)}

    ${raw(isNow ? html`<section class="card"><div class="card-head"><p class="label">last 7 days</p><span class="small muted mono">${money(sum(last7, x => x.value))}</span></div>${raw(columns(last7, { fmt: compact }))}</section>` : '')}

    <section class="card">
      <p class="label">by category</p>
      ${raw(barList(D.byCategory(list).map(([c, v]) => ({ label: raw(`<span class="dot" style="background:${D.CATEGORY_COLOR[c] || 'var(--dim)'}"></span>${c}`), value: v, display: money(v) }))))}
    </section>

    <button class="btn ghost" data-ai>${raw(icon('sparkle'))} Analyse this month</button>

    <section class="list">
      ${raw(list.length ? Object.entries(byDay).map(([k, items]) => html`
        <h4 class="list-day">${fmtDay(k)} <span>${money(sum(items, e => e.amount))}</span></h4>
        ${raw(items.map(e => html`
          <button class="row" data-id="${e.id}">
            <span class="dot" style="background:${D.CATEGORY_COLOR[e.category] || 'var(--dim)'}"></span>
            <span class="row-main"><b>${e.note || e.category}</b><small>${e.category}</small></span>
            <span class="row-amt">${money(e.amount)}</span>
          </button>`).join(''))}`).join('') : empty('No expenses this month.', 'spent 85 on coffee'))}
    </section>`;

  root.querySelector('[data-add]').onclick = () => expenseForm();
  root.querySelectorAll('[data-m]').forEach(b => (b.onclick = () => {
    const d = parseDay(month + '-01');
    d.setMonth(d.getMonth() + Number(b.dataset.m));
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    render(root);
  }));
  root.querySelectorAll('[data-id]').forEach(b => (b.onclick = () => expenseForm(db.get('expenses', b.dataset.id))));
  root.querySelector('[data-ai]').onclick = () => openAssistant(`Analyse my spending for ${label}: where the money goes, anything unusual versus earlier months, and 2 concrete ways to cut.`);
  root.querySelector('[data-budget]')?.addEventListener('click', async () => {
    const v = await sheet({ title: 'Monthly budget', fields: [{ name: 'b', label: `Budget (${db.setting('currency', 'TRY')})`, type: 'number', required: true }] });
    if (v?.b) db.setSetting('monthlyBudget', v.b);
  });
}
