// Plain reminders: facts about today that are worth acting on, no pep talk.
// Shown on Home, and given to Claude so its briefings say the same thing.
import * as db from './db.js';
import * as D from './data.js';
import { today, addDays, weekStart, sum, mins, money, timeHM } from './util.js';

export function reminders() {
  const out = [];
  const now = new Date();
  const s = D.studySummary();
  const need = D.streakMin();
  const plan = D.planStatus();
  const missedYesterday = (s.streak.perDay[addDays(today(), -1)] || 0) < need;

  // Study
  if (!s.streak.studiedToday && missedYesterday && db.all('sessions').length) {
    out.push({ kind: 'study', text: `Yesterday was missed. Don't miss two in a row: ${need} min today.` });
  } else if (!s.streak.studiedToday) {
    out.push(s.streak.current > 0
      ? { kind: 'study', text: `No study logged today. ${need} min keeps the ${s.streak.current}-day streak.` }
      : { kind: 'study', text: `No study logged today. Goal: ${mins(s.dailyGoalMin)}.` });
  } else if (s.todayMin < s.dailyGoalMin) {
    out.push({ kind: 'study', text: `${mins(s.dailyGoalMin - s.todayMin)} left to today's study goal.` });
  }
  if (plan?.started) {
    const w = weekCompare();
    const dow = (new Date().getDay() + 6) % 7; // Mon = 0
    const expected = (plan.weeklyHours * 60 * (dow + 1)) / 7;
    if (w.thisWeek < expected - 60) out.push({ kind: 'study', text: `Week ${plan.week}: ${mins(w.thisWeek)} of ${plan.weeklyHours}h. About ${mins(expected - w.thisWeek)} behind pace.` });
    if (plan.next[0]) out.push({ kind: 'roadmap', text: `Next: ${plan.next[0].title} (${plan.phase.name}).` });
  } else if (plan) {
    out.push({ kind: 'roadmap', text: `${plan.title} starts ${plan.start}. First: ${plan.next[0]?.title || plan.phase.name}.` });
  } else {
    const next = D.nextMilestone();
    if (next) out.push({ kind: 'roadmap', text: `Next on your roadmap: ${next.title} (${next.subject}).` });
  }

  // Calendar
  const soon = D.upcomingEvents(3).find(e => new Date(e.start) > now && new Date(e.start) - now < 3 * 3600e3);
  if (soon) out.push({ kind: 'meeting', text: `${soon.title} at ${timeHM(soon.start)}.` });

  // Tasks
  const overdue = D.openTasks().filter(t => t.due && t.due < today());
  if (overdue.length) out.push({ kind: 'task', text: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}: ${overdue[0].title}${overdue.length > 1 ? ', …' : ''}.` });

  // Money: only when spending is ahead of the month's pace
  const m = D.moneySummary();
  if (m.budget) {
    const day = now.getDate();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (m.month > m.budget) out.push({ kind: 'money', text: `Over budget by ${money(m.month - m.budget)} this month.` });
    else if (m.month / m.budget > day / days + 0.1) out.push({ kind: 'money', text: `Spending is ahead of pace: ${Math.round((m.month / m.budget) * 100)}% of budget used, ${Math.round((day / days) * 100)}% of the month gone.` });
  }

  // Diet: protein check in the evening only
  const d = D.dietDay();
  if (now.getHours() >= 17 && d.meals.length && d.protein < d.goals.dailyProtein * 0.6) out.push({ kind: 'diet', text: `Protein at ${Math.round(d.protein)}g of ${d.goals.dailyProtein}g.` });

  return out;
}

// This week vs last week, for the study card.
export function weekCompare() {
  const ws = weekStart();
  const lastStart = addDays(ws, -7);
  const sessions = db.all('sessions');
  const dayIdx = Math.round((new Date(today()) - new Date(ws)) / 86400000);
  return {
    thisWeek: sum(sessions.filter(x => x.date >= ws), x => x.minutes),
    lastWeekSamePoint: sum(sessions.filter(x => x.date >= lastStart && x.date <= addDays(lastStart, dayIdx)), x => x.minutes),
    totalMin: sum(sessions, x => x.minutes),
  };
}
