// Food photos (v50): snap a meal or a drink and Gemini estimates each item's
// weight, then its calories, macros and key vitamins and minerals. The person
// checks the result (and can change any weight) before it is logged.
//
// Why Gemini: in a 2026 benchmark of ten vision models on 3,229 meal photos,
// Gemini 3 Flash was the most accurate for calories and weight, Flash Lite was
// almost as good, and both beat GPT-4o; it is also on the free tier Mustafa
// already uses. The prompt follows that study's best single-pass strategy:
// judge the portion actually visible (not a standard serving), weight first.
import * as db from './db.js';
import { pickModel } from './ai/gemini.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

// Per-item numbers the model returns. Micros use FDA daily-value units.
export const MACROS = [['calories', 'kcal'], ['protein', 'g'], ['carbs', 'g'], ['fat', 'g'], ['fiber', 'g'], ['sugar', 'g'], ['sodium', 'mg']];
export const MICROS = [
  ['potassium', 'Potassium', 'mg', 4700], ['calcium', 'Calcium', 'mg', 1300], ['iron', 'Iron', 'mg', 18], ['magnesium', 'Magnesium', 'mg', 420],
  ['zinc', 'Zinc', 'mg', 11], ['vitaminA', 'Vitamin A', 'µg', 900], ['vitaminC', 'Vitamin C', 'mg', 90], ['vitaminD', 'Vitamin D', 'µg', 20],
  ['vitaminB12', 'Vitamin B12', 'µg', 2.4], ['caffeine', 'Caffeine', 'mg', 400],
];
// Daily references for the extras on the Diet screen (FDA daily values; sugar and caffeine are limits).
export const DAILY = { fiber: 28, sugar: 50, sodium: 2300, ...Object.fromEntries(MICROS.map(m => [m[0], m[3]])) };
const NUMS = [...MACROS.map(m => m[0]), ...MICROS.map(m => m[0])];

const num = { type: 'number' };
const SCHEMA = {
  type: 'object',
  properties: {
    dish: { type: 'string', description: 'Short name for the whole meal or drink' },
    meal: { type: 'string', enum: ['Breakfast', 'Lunch', 'Dinner', 'Snack'] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    note: { type: 'string', description: 'One short line on what was hard to judge (hidden oil, sauce, portion), or empty' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, grams: { ...num, description: 'Estimated weight of the visible portion in grams (ml for drinks)' }, ...Object.fromEntries(NUMS.map(n => [n, num])) },
        required: ['name', 'grams', 'calories', 'protein', 'carbs', 'fat'],
      },
    },
  },
  required: ['dish', 'items', 'confidence'],
};

const PROMPT = note => `You are a careful dietitian estimating nutrition from a photo.
1. List every separate food or drink you can see (include sauces, oil, dressing, bread, sugar in tea).
2. For each, estimate the weight in grams (ml for drinks) of the portion actually visible in this photo. Use the plate, glass, cutlery and hands for scale. Do not assume a standard serving size.
3. Then give that portion's nutrients: calories (kcal), protein, carbs, fat, fiber, sugar (g), sodium, potassium, calcium, iron, magnesium, zinc (mg), vitamin A (µg RAE), vitamin C (mg), vitamin D (µg), vitamin B12 (µg), caffeine (mg). Use 0 when there is none.
Turkish and Central Asian dishes are common (the user lives in Kazakhstan). If the photo shows no food or drink, return no items.
${note ? `The user adds: "${note}". Trust this over the photo where they differ.` : ''}
Also guess the meal from the time now: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`;

export async function scanFood(image, note = '', { signal } = {}) {
  const key = db.setting('geminiKey', '');
  if (!key) throw Object.assign(new Error('Food photos use Gemini (free). Paste your Gemini key in Settings → AI first.'), { code: 'nokey' });
  let model = db.setting('geminiModel', '') || await pickModel();
  const call = m => fetch(`${API}/models/${m}:generateContent`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: image.media_type, data: image.data } }, { text: PROMPT(note.trim()) }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA },
    }),
  });
  let res;
  try { res = await call(model); } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Could not reach Gemini. Check your connection.');
  }
  if (res.status === 404) { model = await pickModel(); res = await call(model); }
  if (res.status === 429) throw new Error('Free Gemini limit reached for now. Wait a minute and try again.');
  if (!res.ok) { let m = ''; try { m = (await res.json()).error?.message || ''; } catch {} throw new Error(m || `Gemini error ${res.status}`); }
  const out = await res.json();
  const text = (out.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  let r;
  try { r = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { throw new Error('Gemini gave an answer Yaver could not read. Try the photo again.'); }
  return normalize(r, model);
}

const round = (n, d = 1) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;
export function normalize(r, model = '') {
  const items = (r.items || []).filter(i => i && i.name).map(i => ({
    name: String(i.name), grams: Math.max(0, round(i.grams, 0)),
    ...Object.fromEntries(NUMS.map(n => [n, Math.max(0, Number(i[n]) || 0)])),
  }));
  return { dish: String(r.dish || items.map(i => i.name).join(', ') || 'Meal'), meal: r.meal, confidence: r.confidence || 'medium', note: r.note || '', items, model };
}

// An item at a new weight: every nutrient scales with it.
export const scaleItem = (item, grams) => {
  const f = item.grams ? grams / item.grams : 0;
  return { ...item, grams, ...Object.fromEntries(NUMS.map(n => [n, item[n] * f])) };
};

export function totals(items) {
  const t = Object.fromEntries(NUMS.map(n => [n, 0]));
  for (const i of items) for (const n of NUMS) t[n] += Number(i[n]) || 0;
  return t;
}

// What gets stored on the meal row: whole-number macros as before, plus the extras.
export function mealRow({ dish, items, meal, date, confidence }) {
  const t = totals(items);
  const micros = Object.fromEntries(MICROS.map(([k]) => [k, round(t[k], 1)]));
  return {
    name: dish, meal, date,
    calories: Math.round(t.calories), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat),
    fiber: round(t.fiber), sugar: round(t.sugar), sodium: Math.round(t.sodium), micros,
    items: items.map(i => ({ name: i.name, grams: Math.round(i.grams), calories: Math.round(i.calories), protein: round(i.protein) })),
    source: 'photo', confidence,
  };
}
