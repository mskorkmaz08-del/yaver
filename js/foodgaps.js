// Fill the gaps (v55): what to eat or drink next to cover what today (and the
// last week) is missing. Yaver works out the gaps itself from the food diary:
// calories and protein left, vitamins and minerals under 70%, fat quality (too
// much seed or plant oil, too little omega-3, too much saturated fat), and what
// has been running low all week. Gemini then turns those gaps into real foods
// that are easy to get in Kazakhstan, with an amount and why for each. Late in
// the evening, or once the day's calories are in, the plan is for tomorrow.
// The answer is kept for the day and offered for refresh once more food is logged.
import * as db from './db.js';
import * as D from './data.js';
import * as L from './dietlog.js';
import { MICROS, DAILY, ask, jsonOf } from './foodscan.js';
import { today, addDays } from './util.js';

const pct = (v, ref) => (ref ? Math.round(((Number(v) || 0) / ref) * 100) : 0);

// The gaps, in plain lines, plus whether the plan is for the rest of today or tomorrow.
export function gaps(now = new Date()) {
  const day = today();
  const d = D.dietDay(day);
  const g = d.goals;
  const late = now.getHours() >= 20 || (g.dailyCalories && d.calories >= g.dailyCalories * 0.9);
  const lines = [];
  if (d.meals.length) {
    lines.push(`Today so far: ${Math.round(d.calories)} of ${g.dailyCalories} kcal, protein ${Math.round(d.protein)} of ${g.dailyProtein} g, carbs ${Math.round(d.carbs)} g, fat ${Math.round(d.fat)} g.`);
    if (d.detailed) {
      const low = [['fiber', 'Fiber', 'g', DAILY.fiber], ...MICROS.filter(m => m[0] !== 'caffeine')].map(([k, label, , ref]) => [label, pct(k === 'fiber' ? d.fiber : d.micros[k], ref)]).filter(([, p]) => p < 70);
      if (low.length) lines.push(`Under 70% of the daily value today: ${low.map(([l, p]) => `${l} ${p}%`).join(', ')}.`);
      if (d.sodium > DAILY.sodium) lines.push(`Sodium is already ${pct(d.sodium, DAILY.sodium)}% of the limit.`);
      if (d.sugar > DAILY.sugar) lines.push(`Sugar is already ${pct(d.sugar, DAILY.sugar)}% of the limit.`);
    }
    const m = d.micros, kinds = (m.satFat || 0) + (m.monoFat || 0) + (m.polyFat || 0);
    if (kinds >= 5) {
      const share = k => Math.round(((m[k] || 0) / kinds) * 100);
      lines.push(`Fat today: saturated ${share('satFat')}%, monounsaturated ${share('monoFat')}%, polyunsaturated ${share('polyFat')}% (seed and plant oils are mostly poly); omega-3 ${Math.round((m.omega3 || 0) * 10) / 10} g of ${DAILY.omega3} g; saturated ${Math.round(m.satFat || 0)} g of a ${DAILY.satFat} g limit.`);
    }
  } else lines.push('Nothing logged today yet.');
  const week = L.report(7, addDays(day, -1));
  if (week.loggedDays) {
    if (week.low.length) lines.push(`Running low over the last week (average): ${week.low.slice(0, 8).map(x => `${x.label} ${x.pct}%`).join(', ')}.`);
    if (week.high.length) lines.push(`Above the limit over the last week: ${week.high.map(x => `${x.label} ${x.pct}%`).join(', ')}.`);
  }
  const recent = db.all('meals').filter(x => x.date >= addDays(day, -6)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25).map(x => x.name);
  return { day, for: late ? 'tomorrow' : 'today', lines, recent, key: `${day}|${late ? 't' : 'd'}|${d.meals.length}|${Math.round(d.calories)}` };
}

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One or two plain sentences: the main gaps and the idea of the plan' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          food: { type: 'string', description: 'A real food or drink, e.g. "Baked mackerel"' },
          amount: { type: 'string', description: 'How much, e.g. "150 g fillet", "1 glass (250 ml)"' },
          when: { type: 'string', description: 'Which meal, e.g. "Dinner", "Tomorrow breakfast", "Snack"' },
          why: { type: 'string', description: 'What it covers, in a few words with rough numbers, e.g. "omega-3 2 g, protein 30 g, vitamin D"' },
        },
        required: ['food', 'amount', 'why'],
      },
    },
    ease_off: { type: 'string', description: 'What to have less of, one short line, or empty' },
  },
  required: ['summary', 'items'],
};

const PROMPT = (gp) => `You are a practical sports dietitian. Suggest 3 to 6 foods or drinks for ${gp.for === 'tomorrow' ? 'TOMORROW (today is nearly done)' : 'the REST OF TODAY'} that fill the gaps below.
The user lives in Kazakhstan: suggest foods easy to buy or order there (bazaar, supermarket, canteen, Turkish, Kazakh, Russian food). Real food, no supplements unless a gap cannot be met with food (then say so).
Balance fat quality: if seed or plant oils (polyunsaturated) dominate, favour fish, eggs, olive oil, nuts, butter or meat fat in moderation; if omega-3 is low, oily fish (mackerel, herring, salmon) or walnuts; keep saturated fat under the limit.
Respect the calories left; if the day is already over the calories, suggest light options. Give an amount for each item and what it covers. Vary from what they ate recently. Plain words, no motivational talk.
Gaps:
${gp.lines.map(l => `- ${l}`).join('\n')}
Goals: ${D.goals().dailyCalories} kcal, ${D.goals().dailyProtein} g protein a day.
Eaten in the last week: ${gp.recent.join('; ') || 'nothing logged'}.`;

// Cached answer for today, or null.
export function cached() {
  const c = db.setting('foodTips', null);
  return c && c.day === today() ? c : null;
}

export async function suggest({ signal, onStatus } = {}) {
  const gp = gaps();
  const { out } = await ask({ parts: [{ text: PROMPT(gp) }], config: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.5 }, signal, onStatus });
  const r = jsonOf(out);
  if (!r || !Array.isArray(r.items)) throw new Error('Gemini gave an answer Yaver could not read. Try again.');
  const tips = {
    day: gp.day, for: gp.for, key: gp.key, at: Date.now(),
    summary: String(r.summary || ''), ease: String(r.ease_off || ''),
    items: r.items.filter(i => i?.food).slice(0, 6).map(i => ({ food: String(i.food), amount: String(i.amount || ''), when: String(i.when || ''), why: String(i.why || '') })),
  };
  db.setSetting('foodTips', tips);
  return tips;
}
