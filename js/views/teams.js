// Teams: the dev team and the students. Who needs a meeting (no contact within
// their target and nothing planned), everyone's last and next meeting, and the
// activities each team had, with where they happened.
import * as db from '../db.js';
import * as T from '../teams.js';
import { html, raw, fmtDay, dayKey, timeHM } from '../util.js';
import { empty } from '../ui.js';
import { icon } from '../icons.js';
import { personForm, activityForm, meetingForm } from '../forms.js';
import { openAssistant } from '../ai/assistant.js';

let team = 'student';

const when = iso => `${fmtDay(dayKey(new Date(iso)))} ${timeHM(iso)}`;
const nameOf = id => db.get('people', id)?.name;

export function render(root, go, param) {
  if (T.TEAMS[param]) team = param;
  const list = T.people(team).map(p => ({ p, s: T.status(p) }));
  const need = list.filter(x => x.s.overdue).sort((a, b) => (b.s.days ?? 1e9) - (a.s.days ?? 1e9));
  const acts = T.activities(team).slice(0, 20);
  const byDay = {};
  for (const a of acts) (byDay[dayKey(new Date(a.date))] ||= []).push(a);
  const label = T.TEAMS[team];

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Yaver <b>·</b> teams</p><h1>${label}</h1></div>
      <button class="icon-btn primary" data-log aria-label="Log activity">${raw(icon('plus'))}</button>
    </header>

    <div class="chips team-pick">
      ${raw(Object.entries(T.TEAMS).map(([k, v]) => html`<button class="chip ${raw(k === team ? 'on' : '')}" data-team="${k}">${v} <span class="muted">${T.people(k).length}</span></button>`).join(''))}
    </div>

    ${raw(need.length ? html`<section class="card need">
      <div class="card-head"><p class="label">not met lately</p><span class="small muted">${need.length}</span></div>
      ${raw(need.map(({ p, s }) => html`<div class="need-row">
        <span class="row-main"><b>${p.name}</b><small>${T.ago(s.days)} · target every ${s.every} days</small></span>
        <button class="btn ghost small-btn" data-plan="${p.id}">Plan</button>
      </div>`).join(''))}
    </section>` : '')}

    <h4 class="list-day">People <button class="link" data-person>${raw(icon('plus'))} Add</button></h4>
    <section class="list">
      ${raw(list.length ? list.map(({ p, s }) => html`
        <button class="row" data-p="${p.id}">
          <span class="dot ${raw(s.overdue ? 'warn' : s.next ? 'ok' : '')}"></span>
          <span class="row-main"><b>${p.name}</b><small>${p.role ? p.role + ' · ' : ''}${T.ago(s.days)}</small></span>
          <span class="row-side small">${s.next ? `next ${when(s.next.at)}` : s.every ? `every ${s.every}d` : ''}</span>
        </button>`).join('') : empty(team === 'dev' ? 'No one in the dev team yet.' : 'No students yet.', team === 'dev' ? 'add Emre to the dev team as backend' : 'add student Ayşe, meet every 2 weeks'))}
    </section>

    <h4 class="list-day">Activities <button class="link" data-log2>${raw(icon('plus'))} Log</button></h4>
    <section class="list">
      ${raw(acts.length ? Object.entries(byDay).map(([k, items]) => html`
        <h4 class="list-day sub">${fmtDay(k, { weekday: 'short', day: 'numeric', month: 'short' })}</h4>
        ${raw(items.map(a => html`
          <button class="row" data-a="${a.id}">
            <span class="row-time mono small">${timeHM(a.date)}</span>
            <span class="row-main"><b>${a.title}</b><small>${[T.KINDS[a.kind], a.place, (a.people || []).map(nameOf).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</small></span>
          </button>`).join(''))}`).join('') : empty('No activities logged yet.', 'workshop with the students at the lab today, Ali and Ayşe came'))}
    </section>

    <button class="btn ghost" data-ai>${raw(icon('sparkle'))} Who should I meet this week?</button>`;

  root.querySelectorAll('[data-team]').forEach(b => (b.onclick = () => go(`teams/${b.dataset.team}`)));
  root.querySelector('[data-log]').onclick = root.querySelector('[data-log2]').onclick = () => activityForm(null, team);
  root.querySelector('[data-person]').onclick = () => personForm(null, team);
  root.querySelectorAll('[data-p]').forEach(b => (b.onclick = () => personForm(db.get('people', b.dataset.p))));
  root.querySelectorAll('[data-a]').forEach(b => (b.onclick = () => activityForm(db.get('activities', b.dataset.a))));
  root.querySelectorAll('[data-plan]').forEach(b => (b.onclick = () => { const p = db.get('people', b.dataset.plan); meetingForm(null, undefined, { title: `Meeting with ${p.name}`, remind: 15 }); }));
  root.querySelector('[data-ai]').onclick = () => openAssistant(`Look at my ${label.toLowerCase()} (team_status) and my calendar for the next 7 days. Who haven't I met lately, and when could I meet them? Suggest concrete slots.`);
}
