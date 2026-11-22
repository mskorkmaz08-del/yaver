import * as D from '../data.js';
import * as db from '../db.js';
import { html, raw, today, addDays, parseDay, timeHM, fmtDay, weekStart, toast } from '../util.js';
import { empty } from '../ui.js';
import { icon } from '../icons.js';
import { meetingForm, openEvent } from '../forms.js';
import { syncAppleCalendar, status as calStatus, enabled as calEnabled } from '../applecal.js';
import { openInCalendar } from '../ics.js';
import { openAssistant } from '../ai/assistant.js';

let selected = today();
let start = weekStart();

export function render(root, go) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
  const events = D.eventsOn(selected);
  const free = D.freeSlots(selected, 30);

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Yaver <b>·</b> meetings</p><h1>${parseDay(selected).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h1></div>
      <div class="head-btns"><button class="icon-btn" data-teams aria-label="Teams">${raw(icon('users'))}</button><button class="icon-btn primary" data-add aria-label="Add meeting">${raw(icon('plus'))}</button></div>
    </header>

    <div class="week-nav">
      <button data-w="-7" aria-label="Earlier">${raw(icon('chevronLeft'))}</button>
      <div class="days">
        ${raw(days.map(k => {
          const d = parseDay(k);
          const n = D.eventsOn(k).length;
          return html`<button class="day ${raw(k === selected ? 'sel' : '')} ${raw(k === today() ? 'now' : '')}" data-day="${k}">
            <small>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</small><b>${d.getDate()}</b><i class="${raw(n ? 'has' : '')}"></i></button>`;
        }).join(''))}
      </div>
      <button data-w="7" aria-label="Later">${raw(icon('chevronRight'))}</button>
    </div>

    <p class="label">${fmtDay(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <section class="timeline">
      ${raw(events.length ? events.map(e => html`
        <button class="event ${raw(D.isApple(e) ? 'apple' : '')}" data-id="${e.id}"${raw(e.color ? ` style="--evc:${e.color}"` : '')}>
          <span class="ev-time">${raw(e.allDay ? 'all<small>day</small>' : html`${timeHM(e.start)}<small>${timeHM(e.end)}</small>`)}</span>
          <span class="ev-body"><b>${e.title}</b>${raw(e.location ? html`<small>${e.location}</small>` : '')}${raw(e.notes && !D.isApple(e) ? html`<small>${e.notes}</small>` : '')}${raw(D.isApple(e) ? html`<small class="ev-src">Apple Calendar${e.calendar ? ' · ' + e.calendar : ''}</small>` : '')}</span>
        </button>`).join('') : empty('Nothing scheduled.', 'meeting with Ali tomorrow at 15:00'))}
    </section>

    ${raw(free.length ? html`<section class="card"><p class="label">free slots</p>
      <div class="chips">${raw(free.map(f => html`<button class="chip" data-slot="${f.start}">${timeHM(f.start)}–${timeHM(f.end)}</button>`).join(''))}</div></section>` : '')}

    ${raw(calEnabled() ? appleLine() : '')}

    <div class="btn-row">
      <button class="btn ghost" data-ai>${raw(icon('sparkle'))} Plan my week</button>
      <button class="btn ghost" data-export>${raw(icon('share'))} To iPhone Calendar</button>
    </div>`;

  root.querySelector('[data-add]').onclick = () => meetingForm(null, selected);
  root.querySelector('[data-teams]').onclick = () => go('teams');
  root.querySelectorAll('[data-day]').forEach(b => (b.onclick = () => { selected = b.dataset.day; render(root); }));
  root.querySelectorAll('[data-w]').forEach(b => (b.onclick = () => { start = addDays(start, Number(b.dataset.w)); selected = addDays(selected, Number(b.dataset.w)); render(root); }));
  root.querySelectorAll('[data-id]').forEach(b => (b.onclick = () => openEvent(b.dataset.id)));
  const sync = root.querySelector('[data-calsync]');
  if (sync) sync.onclick = async () => {
    sync.disabled = true; sync.textContent = 'Syncing…';
    const ok = await syncAppleCalendar({ force: true });
    const st = calStatus();
    toast(ok ? `Apple Calendar synced · ${st.count} events` : st?.error || 'Could not sync');
    render(root);
  };
  syncAppleCalendar(); // redraws through db.onChange when new events arrive
  root.querySelectorAll('[data-slot]').forEach(b => (b.onclick = () => meetingForm(null, selected, { start: b.dataset.slot, remind: 15 })));
  root.querySelector('[data-ai]').onclick = () => openAssistant('Look at my meetings for the next 7 days and my study goal. Flag clashes and busy days, and propose concrete study blocks in my free slots.');
  root.querySelector('[data-export]').onclick = () => {
    const up = D.upcomingEvents(80).filter(e => !D.isApple(e));
    if (!up.length) return toast('No upcoming meetings');
    openInCalendar(up, 'yaver-upcoming');
  };
}

// One quiet line: when Apple Calendar last synced, or what's in the way.
function appleLine() {
  const st = calStatus();
  const text = !st ? 'Apple Calendar · not synced yet'
    : st.ok ? `Apple Calendar · ${st.count} events · synced ${timeHM(st.at)}`
    : st.error;
  return html`<section class="cal-sync ${raw(st && !st.ok ? 'warn' : '')}">
    <span class="small">${text}</span>
    <button class="link" data-calsync>${raw(icon('refresh'))} Sync</button>
  </section>`;
}
