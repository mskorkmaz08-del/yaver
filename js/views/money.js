import * as D from '../data.js';
import * as db from '../db.js';
import { html, raw, money, compact, today, addDays, fmtDay, monthKey, parseDay, sum } from '../util.js';
import { barList, columns, empty } from '../ui.js';
import { expenseForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';

let month = monthKey();

export function render(root) {
  const list = D.expensesInMonth(month).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const total = sum(list, e => e.amount);
  const budget = D.goals().monthlyBudget;
  const isNow = month === monthKey();
  const s = D.moneySummary();
  const label = parseDay(month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const k = addDays(today(), -i);
    last7.push({ label: parseDay(k).toLocaleDateString(undefined, { weekday: 'narrow' }), value: sum(D.expensesBetween(k, k), e => e.amount), highlight: i === 0 });
  }
  const byDay = {};
  for (const e of list) (byDay[e.date] ||= []).push(e);

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="eyebrow">Money</p><h1>${money(total)}</h1></div>
      <button class="icon-btn accent" data-add aria-label="Add expense">＋</button>
    </header>

    <div class="month-switch">
      <button data-m="-1" aria-label="Previous month">‹</button><span>${label}</span><button data-m="1" ${raw(isNow ? 'disabled' : '')} aria-label="Next month">›</button>
    </div>

    ${raw(budget ? html`
      <section class="card">
        <div class="card-head"><h3>Budget</h3><span class="muted small">${money(budget)} / month</span></div>
        <div class="budget-bar ${raw(total > budget ? 'over' : '')}"><div style="width:${raw(Math.min(100, (total / budget) * 100))}%"></div></div>
        <p class="small">${raw(total > budget ? `<span class="bad">${money(total - budget)} over budget</span>` : `${money(budget - total)} left`)}
          ${raw(isNow && s.dailyAllowance !== null ? ` · about <b>${money(s.dailyAllowance)}</b> a day for the rest of the month` : '')}</p>
      </section>` : html`
      <button class="card nudge" data-budget>🎯 Set a monthly budget to see how much you can spend each day.</button>`)}

    ${raw(isNow ? html`<section class="card"><div class="card-head"><h3>Last 7 days</h3><span class="muted small">${money(sum(last7, x => x.value))}</span></div>${raw(columns(last7, { fmt: compact }))}</section>` : '')}

    <section class="card">
      <div class="card-head"><h3>By category</h3></div>
      ${raw(barList(D.byCategory(list).map(([c, v]) => ({ label: `${D.CATEGORY_ICON[c] || ''} ${c}`, value: v, display: money(v) }))))}
    </section>

    <button class="card ai-row" data-ai>✨ Ask Yaver to analyse your spending</button>

    <section class="list">
      ${raw(list.length ? Object.entries(byDay).map(([k, items]) => html`
        <h4 class="list-day">${fmtDay(k)} <span>${money(sum(items, e => e.amount))}</span></h4>
        ${raw(items.map(e => html`
          <button class="row" data-id="${e.id}">
            <span class="row-icon">${D.CATEGORY_ICON[e.category] || '•'}</span>
            <span class="row-main"><b>${e.note || e.category}</b><small>${e.category}</small></span>
            <span class="row-amt">${money(e.amount)}</span>
          </button>`).join(''))}`).join('') : empty('🧾', 'No expenses this month. Tap ＋ or tell Yaver “I spent 85 on coffee”.'))}
    </section>`;

  root.querySelector('[data-add]').onclick = () => expenseForm();
  root.querySelectorAll('[data-m]').forEach(b => (b.onclick = () => {
    const d = parseDay(month + '-01');
    d.setMonth(d.getMonth() + Number(b.dataset.m));
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    render(root);
  }));
  root.querySelectorAll('[data-id]').forEach(b => (b.onclick = () => expenseForm(db.get('expenses', b.dataset.id))));
  root.querySelector('[data-ai]').onclick = () => openAssistant(`Analyse my spending for ${label}: where my money goes, anything unusual compared to before, and 2 concrete ways to save.`);
  root.querySelector('[data-budget]')?.addEventListener('click', async () => {
    const { sheet } = await import('../util.js');
    const v = await sheet({ title: 'Monthly budget', fields: [{ name: 'b', label: `Budget (${db.setting('currency', 'TRY')})`, type: 'number', required: true }] });
    if (v?.b) db.setSetting('monthlyBudget', v.b);
  });
}
