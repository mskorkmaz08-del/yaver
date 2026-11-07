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
import { flashModels } from './ai/gemini.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

// Per-item numbers the model returns. Micros use FDA daily-value units.
export const MACROS = [['calories', 'kcal'], ['protein', 'g'], ['carbs', 'g'], ['fat', 'g'], ['fiber', 'g'], ['sugar', 'g'], ['sodium', 'mg']];
// Fat quality (v55): which kind of fat. Saturated has a daily limit; omega-3 (fish, walnuts,
// flax) a daily target; mono (olive oil, nuts) and poly (seed oils) are shown as shares.
export const FATS = [['satFat', 'Saturated fat', 'g', 20], ['monoFat', 'Monounsaturated fat', 'g', 0], ['polyFat', 'Polyunsaturated fat', 'g', 0], ['omega3', 'Omega-3', 'g', 1.6]];
export const MICROS = [
  ['potassium', 'Potassium', 'mg', 4700], ['calcium', 'Calcium', 'mg', 1300], ['iron', 'Iron', 'mg', 18], ['magnesium', 'Magnesium', 'mg', 420],
  ['zinc', 'Zinc', 'mg', 11], ['vitaminA', 'Vitamin A', 'µg', 900], ['vitaminC', 'Vitamin C', 'mg', 90], ['vitaminD', 'Vitamin D', 'µg', 20],
  ['vitaminB12', 'Vitamin B12', 'µg', 2.4], ['caffeine', 'Caffeine', 'mg', 400],
];
// Daily references for the extras on the Diet screen (FDA daily values; sugar and caffeine are limits).
export const DAILY = { fiber: 28, sugar: 50, sodium: 2300, satFat: 20, omega3: 1.6, ...Object.fromEntries(MICROS.map(m => [m[0], m[3]])) };
export const NUMS = [...MACROS.map(m => m[0]), ...FATS.map(m => m[0]), ...MICROS.map(m => m[0])];

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
        properties: {
          name: { type: 'string' }, grams: { ...num, description: 'Weight of the portion in grams (ml for drinks)' },
          basis: { type: 'string', description: 'How the amount was judged, a few words: "26 cm plate, about a third covered", "2 slices", "250 ml mug, 3/4 full", "label: 45 g bar"' },
          source: { type: 'string', description: 'Where the nutrition values came from, a few words: brand label, a site found, or standard food tables' },
          ...Object.fromEntries(NUMS.map(n => [n, num])),
        },
        required: ['name', 'grams', 'calories', 'protein', 'carbs', 'fat'],
      },
    },
  },
  required: ['dish', 'items', 'confidence'],
};

const NUTRIENT_LIST = 'calories (kcal), protein, carbs, fat, of which saturated, monounsaturated, polyunsaturated and omega-3 fat, fiber, sugar (g), sodium, potassium, calcium, iron, magnesium, zinc (mg), vitamin A (µg RAE), vitamin C (mg), vitamin D (µg), vitamin B12 (µg), caffeine (mg)';
const WHERE = 'The user lives in Kazakhstan and eats Kazakh, Turkish, Russian and international food; local products and portions are what matter.';

// Step 1 (v55): look at the photo or the words and research every item with Google
// Search before estimating anything, so nothing rests on a lazy guess.
const RESEARCH = (note, photo) => `You are a meticulous dietitian. ${photo ? 'Look at this photo of food or drink.' : `The user wrote what they ate or drank: "${note}"`}
${WHERE}
For EACH separate item (include oil, butter, sauce, dressing, sugar or honey in drinks):
1. Identify it exactly. ${photo ? 'Read any brand, logo, label or packaging text you can see (e.g. a chocolate wrapper, a bottle, a cup print).' : 'Use the brand or place if they named one.'}
2. Amount: ${photo ? `measure it from what is in the photo, never from a "standard serving". Find reference objects (dinner plate about 26 cm, side plate 20 cm, fork about 19 cm, teaspoon 5 ml, tablespoon 15 ml, mug 250-350 ml, Turkish tea glass about 100 ml, can 330 ml, hand about 18 cm long, bread loaf slice size) and use them to judge size, then volume, then weight with the food's density. Count pieces (slices, dumplings, pieces of meat). Judge how full a cup or glass is.` : 'use the amounts they gave and convert pieces, slices, spoons, cups and bowls to grams or ml. If no amount is given, use one typical portion here and say so.'}
3. Use Google Search to look up what you can instead of assuming: the nutrition label of a branded product; how a local dish is usually made (e.g. the meat, bread and sauce share of a doner or shawarma in Kazakhstan, how much oil goes into plov or baursak); the weight of a measure (e.g. grams in a tablespoon of honey); the size of a named cup or bottle.
4. Write short notes per item: name, amount in grams or ml and how you judged it, nutrition per 100 g with where it came from, then the totals for this portion of: ${NUTRIENT_LIST}.
${photo && note ? `The user adds: "${note}". Trust this over the photo where they differ.` : ''}
Time now: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`;

// Step 2: turn the notes (or, if search was not available, a direct look) into the JSON.
const STRUCTURE = (note, photo, notes) => `Turn this into the JSON answer: one item per food or drink with its grams (ml for drinks), how the amount was judged (basis), where the values came from (source), and the portion's ${NUTRIENT_LIST}. Use 0 when there is none.
${notes ? `Use these research notes; keep their amounts and looked-up values, and fill any missing nutrient from standard food composition tables (USDA, national tables):\n---\n${notes}\n---` : `${photo ? 'From the photo: measure each item against reference objects (plate, cutlery, cup, hand), count pieces, never assume a standard serving.' : `What they wrote: "${note}". Convert their amounts to grams; with none, use one typical portion and say so in note.`} ${WHERE}${photo && note ? ` The user adds: "${note}".` : ''}`}
If there is no food or drink, return no items. Guess the meal from the time now: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`;

// Gemini's free models get overloaded at busy times (503 "high demand"). So each
// try has a time limit, thinking is kept low (much faster, same estimate), and a
// busy model hands over to the next one: the model that worked last time, the
// chat model, other Flash models, then Flash Lite (nearly as accurate in the
// benchmark, and usually free when the others are busy).
const TRY_MS = 30000, MAX_TRIES = 4;
const BUSY = new Set([429, 500, 502, 503, 504]);

function thinking(model) {
  if (/^gemini-2\.5-flash-lite/.test(model)) return {};
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/^gemini-[3-9]/.test(model)) return { thinkingConfig: { thinkingLevel: 'low' } };
  return {};
}

// One Gemini request with the busy-model fallback. Returns { out, model }.
export async function ask({ parts, config = {}, tools, signal, onStatus, timeout = TRY_MS, label = 'Gemini' }) {
  const key = db.setting('geminiKey', '');
  if (!key) throw Object.assign(new Error('This uses Gemini (free). Paste your Gemini key in Settings → AI first.'), { code: 'nokey' });
  const all = await flashModels();
  const order = [...new Set([db.setting('foodModel', ''), db.setting('geminiModel', ''), ...all.filter(m => !/lite/.test(m)).slice(0, 2), ...all.filter(m => /lite/.test(m))].filter(Boolean))].slice(0, MAX_TRIES);
  let lastError = '';
  for (const [i, model] of order.entries()) {
    if (i) onStatus?.(`${label} is busy. Trying ${model.replace(/^gemini-/, '')}…`);
    for (const think of [true, false]) {
      const ctrl = new AbortController();
      const stop = () => ctrl.abort();
      signal?.addEventListener('abort', stop);
      const timer = setTimeout(stop, timeout);
      let res;
      try {
        res = await fetch(`${API}/models/${model}:generateContent`, {
          method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts }], ...(tools ? { tools } : {}), generationConfig: { temperature: 0.2, ...config, ...(think ? thinking(model) : {}) } }),
        });
        if (res.ok) {
          const out = await res.json();
          if (db.setting('foodModel', '') !== model) db.setSetting('foodModel', model);
          return { out, model };
        }
      } catch (e) {
        if (signal?.aborted) throw Object.assign(new Error('Stopped.'), { name: 'AbortError' });
        lastError = ctrl.signal.aborted ? 'timeout' : 'network';
        if (lastError === 'network' && !navigator.onLine) throw new Error('You are offline. Log it by hand, or try again when you are back online.');
        break; // next model
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
      let msg = '';
      try { msg = (await res.json()).error?.message || ''; } catch {}
      // A model that rejects the thinking setting: same model again without it.
      if (res.status === 400 && think && /think/i.test(msg)) continue;
      if (res.status === 400 && /api key/i.test(msg)) throw new Error('Google says the Gemini key is not valid. Paste it again in Settings → AI.');
      if (res.status === 403) throw new Error(`Google refused the Gemini key: ${msg || 'permission denied'}.`);
      lastError = BUSY.has(res.status) ? 'busy' : res.status === 404 ? 'missing' : (msg || `error ${res.status}`);
      if (res.status === 404 && db.setting('foodModel', '') === model) db.setSetting('foodModel', '');
      break; // next model
    }
  }
  if (lastError === 'busy' || lastError === 'timeout') throw new Error('Gemini is overloaded right now (on Google\'s side) and every free model was busy. Try again in a minute, or log the meal by hand.');
  if (lastError === 'network') throw new Error('Could not reach Gemini. Check your connection.');
  throw new Error(`Gemini could not do it (${lastError}).`);
}

export const textOf = out => (out.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
export const jsonOf = out => { try { return JSON.parse(textOf(out).replace(/^```(json)?|```$/g, '').trim()); } catch { return null; } };
// Web pages Google Search used, for the "Looked up" line.
function sourcesOf(out) {
  const seen = new Set(), list = [];
  for (const c of out.candidates?.[0]?.groundingMetadata?.groundingChunks || []) {
    const w = c.web; if (!w?.uri || seen.has(w.title || w.uri)) continue;
    seen.add(w.title || w.uri); list.push({ title: String(w.title || '').replace(/^www\./, '') || 'source', uri: w.uri });
  }
  return list.slice(0, 6);
}

// image is null for a typed meal: then note is what they ate.
export async function scanFood(image, note = '', { signal, onStatus, research = true } = {}) {
  if (!image && !String(note).trim()) throw new Error('Write what you ate or drank first.');
  note = String(note || '').trim();
  const pic = image ? [{ inlineData: { mimeType: image.media_type, data: image.data } }] : [];
  // Step 1: look things up. If search isn't available right now, step 2 estimates directly.
  let notes = '', sources = [];
  if (research) {
    onStatus?.('Looking things up…');
    try {
      const { out } = await ask({ parts: [...pic, { text: RESEARCH(note, !!image) }], tools: [{ google_search: {} }], signal, onStatus, timeout: 45000 });
      notes = textOf(out).trim();
      sources = sourcesOf(out);
    } catch (e) {
      if (e.name === 'AbortError' || e.code === 'nokey') throw e;
      onStatus?.('Search is busy, estimating directly…');
    }
  }
  onStatus?.(notes ? 'Adding it up…' : image ? 'Looking at your photo…' : 'Working it out…');
  const { out, model } = await ask({ parts: [...pic, { text: STRUCTURE(note, !!image, notes) }], config: { responseMimeType: 'application/json', responseSchema: SCHEMA }, signal, onStatus });
  const r = jsonOf(out);
  if (!r) throw new Error('Gemini gave an answer Yaver could not read. Try again.');
  return { ...normalize(r, model), sources, researched: !!notes };
}

const round = (n, d = 1) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;
export function normalize(r, model = '') {
  const items = (r.items || []).filter(i => i && i.name).map(i => ({
    name: String(i.name), grams: Math.max(0, round(i.grams, 0)), basis: String(i.basis || ''), source: String(i.source || ''),
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
// Fat quality is kept with the micros, so the day sums and the diary pick it up.
export function mealRow({ dish, items, meal, date, confidence, source = 'photo', sources = [] }) {
  const t = totals(items);
  const micros = Object.fromEntries([...FATS, ...MICROS].map(([k]) => [k, round(t[k], 1)]));
  return {
    name: dish, meal, date,
    calories: Math.round(t.calories), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat),
    fiber: round(t.fiber), sugar: round(t.sugar), sodium: Math.round(t.sodium), micros,
    items: items.map(i => ({ name: i.name, grams: Math.round(i.grams), calories: Math.round(i.calories), protein: round(i.protein), ...(i.basis ? { basis: i.basis } : {}), ...(i.source ? { from: i.source } : {}) })),
    source, confidence, ...(sources.length ? { sources: sources.slice(0, 6) } : {}),
  };
}
