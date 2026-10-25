// Skills: the player card. The overall rating, the hexagon of six areas (now in gold, four weeks
// ago as a steel outline), each area's level and the XP to the next one, this week's form,
// streaks with their best, and the latest wins. Everything here only goes up; a quiet week
// shows as form, never as lost levels.
import { html, raw, fmtDay } from '../util.js';
import * as S from '../skills.js';
import { icon } from '../icons.js';

const FORM = { up: ['↑', 'better than last week'], down: ['↓', 'quieter than last week'], same: ['→', 'steady'] };

export function render(root) {
  const s = S.summary();
  const gain = s.overall - s.overallThen;
  const best = [...s.areas].sort((a, b) => b.rating - a.rating)[0];
  const rising = s.areas.filter(a => a.form === 'up').map(a => a.name);

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">Yaver <b>·</b> skills</p><h1>Level ${s.level}</h1></div>
    </header>

    <section class="plate sk-card">
      <div class="sk-ovr">
        <b class="sk-big">${s.overall}</b>
        <span class="sk-ovr-l">overall</span>
        <span class="sk-gain ${raw(gain > 0 ? 'up' : '')}">${gain > 0 ? `+${gain} in 4 weeks` : 'building'}</span>
        <span class="sk-xp mono">${s.totalXp.toLocaleString('en')} XP</span>
      </div>
      ${raw(S.radar(s, { size: 300 }))}
      <p class="sk-legend"><i class="now"></i>now <i class="then"></i>4 weeks ago</p>
    </section>

    <p class="sk-line">${rising.length ? `Rising this week: ${rising.join(', ')}.` : 'Every lesson, test, problem and Çetele count moves these up.'} Strongest: ${best.name}.</p>

    <section class="sk-areas">
      ${raw(s.areas.map(a => html`
        <div class="plate sk-area">
          <div class="sk-top"><b>${a.name}</b><span class="sk-rate">${a.rating}</span></div>
          <div class="bar"><div style="width:${raw((a.frac * 100).toFixed(1))}%"></div></div>
          <div class="sk-meta"><span>Level ${a.level} · ${a.toNext.toLocaleString('en')} XP to ${a.level + 1}</span><span class="sk-form ${a.form}" title="${FORM[a.form][1]}">${FORM[a.form][0]} ${a.week ? `+${a.week}` : '0'} this week</span></div>
        </div>`).join(''))}
    </section>

    <section class="plate card">
      <p class="eyebrow">Streaks</p>
      <div class="sk-streaks">${raw(s.streaks.map(st => html`
        <div><b class="mono">${st.current}</b><span>${st.name} · days</span><small>${st.current && st.current >= st.best ? 'your best yet' : st.best ? `best ${st.best}` : 'starts today'}</small></div>`).join(''))}</div>
      <p class="small muted">${s.streaks.some(st => !st.current && st.best) ? 'A missed day doesn\'t undo anything here: levels stay. Today is a fresh start.' : 'Keep the chain going; levels stay even on a day off.'}</p>
    </section>

    <section class="plate card">
      <p class="eyebrow">Latest wins</p>
      ${raw(s.recent.length ? s.recent.map(e => html`<div class="sk-win"><span class="sk-plus mono">+${e.xp}</span><span>${e.what}</span><small>${S.AREAS.find(a => a.id === e.area).short} · ${fmtDay(e.day)}</small></div>`).join('') : '<p class="small muted">Finish a lesson, solve a problem or log a Çetele count: it shows up here.</p>')}
    </section>

    <details class="plate card sk-how">
      <summary class="small">${raw(icon('sparkle'))} How XP is earned</summary>
      <ul class="small muted">
        <li>Lesson mastered: 60 + 40 × your exit score (one to redo: 30), to its area.</li>
        <li>Weekly test: up to 150 per subject, by score.</li>
        <li>Problem solved: 25 to Algorithms. Card reviewed: 2 to Discipline.</li>
        <li>Study time: 1 per 4 minutes; task done: 10; milestone: 30; a day with every Çetele minimum met: 40 (Discipline).</li>
        <li>Çetele counts: 50 for meeting a daily target (part of it for part of the way), 150 for a weekly one; up to 120 a day.</li>
        <li>Ratings run 1–99 and slow down near the top; levels need 100, 300, 600, 1,000 … XP.</li>
      </ul>
    </details>`;
}
