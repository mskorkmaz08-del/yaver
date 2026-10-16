// Plain reminders: facts about today that are worth acting on, no pep talk.
// Shown on Home, and given to Claude so its briefings say the same thing.
import * as db from './db.js';
import * as D from './data.js';
import { today, addDays, weekStart, sum, mins, money, timeHM, parseDay } from './util.js';
import * as C from './course.js';

export function reminders() {
  const out = [];
  const now = new Date();
  const s = D.studySummary();
  const need = D.streakMin();
  const course = C.ready() && C.active();
  const plan = course ? null : D.planStatus();
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

  // Course: next block, cards, pace, teaching deadlines
  if (course) {
    if (now.getDay() === 0 && C.weekOf() >= 1) out.push({ kind: 'course', text: 'Weekly test and ship today.' });
    const nb = C.nextBlock(now);
    if (nb) out.push({ kind: 'course', text: `${nb.date === today() ? '' : nb.date === addDays(today(), 1) ? 'Tomorrow ' : nb.date + ' '}${nb.start} · ${C.slotTitle(nb)}${nb.minutes ? ` (${nb.minutes} min)` : ''}.`, open: nb.lesson ? `lesson/${nb.lesson.id}` : null });
    const due = C.dueCount();
    if (due) out.push({ kind: 'course', text: `${due} review card${due > 1 ? 's' : ''} due.`, open: 'lesson/review' });
    for (const t of Object.values(C.pace()).filter(t => t.behind > 0).sort((a, b) => b.behind - a.behind).slice(0, 2)) {
      out.push({ kind: t.color === 'red' ? 'task' : 'course', text: `${t.name} is ${t.behind} lesson${t.behind > 1 ? 's' : ''} behind.` });
    }
    for (const d of C.deadlines(7).slice(0, 2)) {
      out.push({ kind: 'task', text: d.days < 0 ? `Robotics: ${d.title} was due to be taught ${-d.days} day${d.days < -1 ? 's' : ''} ago and isn't prepared.` : `Robotics: ${d.title} is taught ${d.days === 0 ? 'today' : `in ${d.days} day${d.days > 1 ? 's' : ''}`} and not prepared.`, open: `lesson/${d.lessonId}` });
    }
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
