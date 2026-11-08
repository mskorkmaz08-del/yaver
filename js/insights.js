// Insights (v60): Mustafa's main objective for Yaver's data is to analyse everything
// he logs and hear about it when it matters. Each check below looks across the
// stores (meals and their times, feelings, body and weigh-ins, training, study,
// çetele, money) and returns a plain finding only when the data is strong enough
// and something stands out. No AI call: it runs instantly and offline. The Home
// card shows the top few; the assistant gets all of them (get_insights) and can
// explain one in depth. Each finding carries a level (3 act on it, 2 worth knowing,
// 1 a note), the evidence in numbers, a question for the assistant and a screen.
import * as db from './db.js';
import * as D from './data.js';
import * as L from './dietlog.js';
import * as B from './body.js';
import * as T from './training.js';
import * as CT from './cetele.js';
import { today, addDays, monthKey } from './util.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const CHECKS = [
  // Feeling bad often, and what came before.
  function feelings() {
    const list = db.all('checkins').filter(c => c.date > addDays(today(), -7));
    const bad = list.filter(c => c.feel === 'bad');
    if (list.length < 3 || bad.length < 2 || bad.length / list.length < 0.4) return null;
    return { id: 'feel-bad', area: 'You', level: 3, go: 'diet',
      text: `You felt bad on ${bad.length} of the last ${list.length} days you checked in.`,
      ask: 'I have felt bad on several days this week (diet_history has my check-ins). Look at what I ate, when I ate, my training and sleep-related clues on the days before, and tell me plainly what could be behind it and what to try. Say when I should see a doctor.' };
  },
  // Late eating and the mornings after it.
  function lateEating() {
    const t = L.report(14).timing;
    if (!t) return null;
    const a = t.afterLate, o = t.afterOther;
    if (a.days >= 2 && o.days >= 2 && a.bad / a.days >= 0.5 && a.bad / a.days > o.bad / o.days + 0.25)
      return { id: 'late-mornings', area: 'Food timing', level: 3, go: 'diet',
        text: `After late eating you felt bad on ${a.bad} of ${a.days} mornings; after other days, ${o.bad} of ${o.days}.`,
        ask: 'My diary shows I feel worse the morning after eating late. Look at diet_history (times, what I ate late, how I felt) and suggest a simple evening eating plan that fits my day.' };
    const recent = t.lateDays.filter(d => d > addDays(today(), -7));
    if (recent.length >= 3) return { id: 'late-often', area: 'Food timing', level: 2, go: 'diet',
      text: `A third or more of your food came after 21:00 on ${recent.length} of the last 7 days.`,
      ask: 'I have been eating late on most days this week (diet_history). What does late eating do for sleep, digestion and my goal, and how can I move food earlier?' };
    return null;
  },
  // Eating against the body plan (losing fat while in a surplus, or the reverse).
  function againstPlan() {
    const s = B.status();
    if (!s?.projection) return null;
    const { balance } = s.projection, t = s.target;
    if (t.mode === 'cut' && balance > 150) return { id: 'plan-surplus', area: 'Body', level: 3, go: 'body',
      text: `The plan is to lose fat, but you have eaten about ${balance} kcal a day over your burn. At this rate: ${s.projection.month.fat > 0 ? '+' : ''}${s.projection.month.fat} kg of fat in a month.`,
      ask: 'I am eating over my burn while my plan is to lose fat (body_status, diet_history). Where are the extra calories coming from, and what are 3 easy swaps?' };
    if (t.mode === 'gain' && balance < -250) return { id: 'plan-deficit', area: 'Body', level: 2, go: 'body',
      text: `You are trying to build muscle but eating about ${-balance} kcal a day under your burn.`,
      ask: 'I want to build muscle but my food logs show a deficit (body_status, diet_history). How do I add the calories easily?' };
    return null;
  },
  // Protein under the goal on most days.
  function protein() {
    const r = L.report(7, addDays(today(), -1));
    const p = r.nutrients.find(x => x.key === 'protein');
    if (r.loggedDays < 4 || !p || p.pct >= 80) return null;
    return { id: 'protein-low', area: 'Food', level: 2, go: 'diet',
      text: `Protein has averaged ${Math.round(p.avg)} g a day this week, ${p.pct}% of your ${p.ref} g goal.`,
      ask: 'My protein is below my goal this week (diet_history). Suggest simple high-protein foods I can add here in Kazakhstan, by meal.' };
  },
  // Vitamins and minerals well under the daily value all week.
  function lowNutrients() {
    const r = L.report(7, addDays(today(), -1));
    if (r.detailedDays < 3) return null;
    const low = r.low.filter(x => x.partial && x.pct < 50).slice(0, 3);
    if (!low.length) return null;
    return { id: `low-${low.map(x => x.key).join('-')}`, area: 'Food', level: 2, go: 'diet',
      text: `Low all week: ${low.map(x => `${x.label} ${x.pct}%`).join(', ')} of the daily value.`,
      ask: `My food diary shows ${low.map(x => x.label).join(', ')} well under the daily value this week (diet_history). Which everyday foods fix that, and is any of it worth checking with a blood test?` };
  },
  // Over a limit all week (sodium, sugar, saturated fat, caffeine).
  function overLimits() {
    const r = L.report(7, addDays(today(), -1));
    if (r.detailedDays < 3 || !r.high.length) return null;
    const h = r.high[0];
    if (h.pct < 120) return null;
    return { id: `high-${h.key}`, area: 'Food', level: 1, go: 'diet',
      text: `${h.label} has averaged ${h.pct}% of the daily limit this week.`,
      ask: `My ${h.label.toLowerCase()} is over the daily limit this week (diet_history). Which of my foods bring it in, and what can I swap?` };
  },
  // Training sessions missed against the plan.
  function training() {
    if (!B.profile()) return null;
    const past = T.week().filter(x => x.session && x.day < today());
    const missed = past.filter(x => !x.done);
    const any = T.workouts().some(w => w.date > addDays(today(), -14));
    if (!any && T.workouts().length) return { id: 'train-stopped', area: 'Training', level: 2, go: 'body',
      text: 'No training logged in the last two weeks.',
      ask: 'I have not trained for two weeks. Give me a short, easy plan to restart this week without getting hurt.' };
    // Only once he logs training: the plan alone is no evidence he skipped it.
    if (missed.length >= 2 && T.workouts().length) return { id: 'train-missed', area: 'Training', level: 2, go: 'body',
      text: `${plural(missed.length, 'planned session')} missed this week (${missed.map(x => new Date(x.day + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short' })).join(', ')}).`,
      ask: 'I missed some planned training this week (body_status). How do I fit the important parts into the days left?' };
    return null;
  },
  // Weight moving differently from what the food logs predict (missing meals or wrong estimates).
  function weightVsLogs() {
    const w = B.weighins();
    if (w.length < 2) return null;
    const first = w.find(x => x.date >= addDays(today(), -28)) || w.at(-2), last = w.at(-1);
    const days = (new Date(last.date) - new Date(first.date)) / 864e5;
    if (days < 10 || first === last) return null;
    const s = B.status();
    const logged = B.days(Math.round(days), last.date).filter(d => d.counted);
    if (!s || logged.length < days * 0.6) return null;
    const predicted = logged.reduce((a, d) => a + d.fat + d.muscle, 0) / 1000;
    const actual = last.kg - first.kg;
    if (Math.abs(actual - predicted) < 1.2) return null;
    return { id: 'weight-vs-logs', area: 'Body', level: 1, go: 'body',
      text: `Your weight changed ${actual > 0 ? '+' : ''}${actual.toFixed(1)} kg since ${first.date}, but your food logs predict ${predicted > 0 ? '+' : ''}${predicted.toFixed(1)} kg. ${actual > predicted ? 'Some food may be missing from the logs.' : 'You may burn more than estimated.'}`,
      ask: 'My weigh-ins and my food logs disagree (body_status, diet_history). What is the likely reason and how do I make the numbers more accurate?' };
  },
  // Food logging too thin for the rest to mean much.
  function loggingGaps() {
    const r = L.report(7, addDays(today(), -1));
    if (!db.all('meals').length || r.loggedDays >= 5) return null;
    return { id: 'log-gaps', area: 'Data', level: 1, go: 'diet',
      text: `Food was logged on ${r.loggedDays} of the last 7 days, so food insights are rough. A photo per meal is enough.`,
      ask: null };
  },
  // Study falling behind the daily goal.
  function study() {
    const g = D.goals().dailyStudyMin;
    if (!g || !db.all('sessions').length) return null;
    let min = 0;
    for (let i = 1; i <= 7; i++) min += D.minutesOn(addDays(today(), -i));
    const st = D.studyStreak();
    if (min < g * 7 * 0.5) return { id: 'study-behind', area: 'Study', level: 2, go: 'study',
      text: `${Math.round(min / 60 * 10) / 10} h of study in the last 7 days, ${pct(min, g * 7)}% of your goal.`,
      ask: 'My study time is well under my goal this week (get_course_progress and my sessions). What is the smallest plan that gets me back on track?' };
    if (!st.current && st.best >= 5 && !st.studiedToday) return { id: 'study-streak', area: 'Study', level: 1, go: 'study',
      text: `Your study streak ended (best: ${st.best} days). Today restarts it.`, ask: null };
    return null;
  },
  // Spending on pace to go over the budget.
  function money() {
    const m = D.moneySummary();
    if (!m.budget || !m.month) return null;
    const d = new Date(), dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (d.getDate() < 5) return null;
    const pace = (m.month / d.getDate()) * dim;
    if (pace <= m.budget * 1.1) return null;
    const top = m.categories[0];
    return { id: `money-pace-${monthKey()}`, area: 'Money', level: 2, go: 'money',
      text: `At this pace you will spend about ${Math.round(pace).toLocaleString('en')} this month, ${pct(pace, m.budget) - 100}% over the budget${top ? `; most goes to ${top[0]}` : ''}.`,
      ask: 'I am on pace to go over my monthly budget. Look at my spending by category and suggest where to cut for the rest of the month.' };
  },
  // A çetele minimum slipping.
  function cetele() {
    const items = CT.items().filter(i => i.per !== 'week');
    for (const i of items) {
      let missed = 0;
      for (let k = 1; k <= 7; k++) if (!CT.met(i, addDays(today(), -k))) missed++;
      const any = db.all('ceteleLog').some(r => r.item === i.id);
      if (any && missed >= 5) return { id: `cetele-${i.id}`, area: 'Çetele', level: 1, go: 'cetele',
        text: `${i.name} was missed on ${missed} of the last 7 days.`, ask: null };
    }
    return null;
  },
];

// Every finding, most important first. Findings hidden today are left out unless all=true.
export function all({ hidden = true } = {}) {
  const out = [];
  for (const c of CHECKS) { try { const r = c(); if (r) out.push(r); } catch (e) { console.warn('insight', c.name, e); } }
  const hide = db.setting('insightsHidden', {}) || {};
  return out.filter(i => !hidden || hide[i.id] !== today()).sort((a, b) => b.level - a.level);
}
export async function hide(id) {
  const h = { ...(db.setting('insightsHidden', {}) || {}) };
  for (const k of Object.keys(h)) if (h[k] !== today()) delete h[k];
  h[id] = today();
  await db.setSetting('insightsHidden', h);
}
export const forAI = () => ({
  insights: all({ hidden: false }).map(({ area, level, text }) => ({ area, importance: ['', 'note', 'worth knowing', 'act on it'][level], text })),
  note: 'Rule-based findings from the logged data, shown only when the data is strong enough. Explain them plainly and suggest one next step.',
});
