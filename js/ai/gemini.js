// Google Gemini as Yaver's brain: free tier with a key from aistudio.google.com.
// Same idea as claude.js: stream a reply, run the tools Gemini asks for on the
// phone, send the results back, repeat until it answers in text.
import * as db from '../db.js';
import { toolDefinitions, runTool, WRITE_TOOLS, describeAction } from './tools.js';
import { STATIC_SYSTEM, dynamicContext, statusFor } from './claude.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

const key = () => {
  const k = db.setting('geminiKey', '');
  if (!k) throw Object.assign(new Error('Add your Gemini API key in Settings to wake Yaver up.'), { code: 'nokey' });
  return k;
};

// Gemini reads a subset of JSON Schema: drop the fields it rejects.
function cleanSchema(s) {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties') continue;
    out[k] = cleanSchema(v);
  }
  return out;
}

const functionDeclarations = () => toolDefinitions.map(t => {
  const hasParams = Object.keys(t.input_schema.properties || {}).length > 0;
  return { name: t.name, description: t.description, ...(hasParams ? { parameters: cleanSchema(t.input_schema) } : {}) };
});

export function userMessage(text, image) {
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.media_type, data: image.data } });
  parts.push({ text });
  return { role: 'user', parts };
}

// Pick the best free "flash" model this key can use.
export async function pickModel() {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key() } });
  if (!res.ok) throw await apiError(res);
  const { models = [] } = await res.json();
  const usable = models
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace('models/', ''))
    .filter(n => /^gemini-[\d.]+-flash/.test(n) && !/(lite|image|tts|live|audio|thinking-exp|embedding)/.test(n));
  const ver = n => parseFloat(n.match(/^gemini-([\d.]+)/)[1]);
  const pre = n => /preview|exp/.test(n);
  // Stable models first (steadier free limits), then newest, then the plainest name.
  usable.sort((a, b) => pre(a) - pre(b) || ver(b) - ver(a) || a.length - b.length);
  const model = usable[0] || 'gemini-2.5-flash';
  await db.setSetting('geminiModel', model);
  await db.setSetting('geminiModels', usable);
  return model;
}

async function apiError(res) {
  let msg = '';
  try { msg = (await res.json()).error?.message || ''; } catch {}
  if (res.status === 400 && /api key/i.test(msg)) return new Error('Your Gemini key was rejected. Copy it again from aistudio.google.com → Get API key.');
  if (res.status === 403) return new Error('This Gemini key is not allowed to use the API. Create a new key in aistudio.google.com.');
  if (res.status === 404) { db.setSetting('geminiModel', ''); return new Error('That Gemini model is not available to your key. Try again; Yaver will pick another.'); }
  if (res.status === 429) return new Error('Free Gemini limit reached for now (requests per minute or per day). Wait a minute and try again.');
  if (res.status >= 500) return new Error('Gemini is having a moment (server error). Try again.');
  return new Error(msg || `Gemini error ${res.status}`);
}

async function streamOnce(contents, { onDelta, onStatus, signal }) {
  const model = db.setting('geminiModel', '') || await pickModel();
  const body = {
    systemInstruction: { parts: [{ text: `${STATIC_SYSTEM}\n\nWeb search is not available in this mode: answer from what you know, and say plainly when something may be out of date.\n\n${dynamicContext()}` }] },
    contents,
    tools: [{ functionDeclarations: functionDeclarations() }],
    generationConfig: { maxOutputTokens: 8192 },
  };
  let res;
  try {
    res = await fetch(`${API}/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('Stopped.'), { code: 'abort' });
    throw new Error(navigator.onLine ? 'Could not reach Gemini. Check your connection.' : 'You are offline. Your trackers still work; Yaver needs internet to think.');
  }
  if (!res.ok) throw await apiError(res);

  // Server-sent events: each "data:" line is a partial response.
  const parts = [];
  let finish = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const chunk = JSON.parse(line.slice(5));
        const cand = chunk.candidates?.[0];
        if (cand?.finishReason) finish = cand.finishReason;
        for (const p of cand?.content?.parts || []) {
          parts.push(p); // keep every part as sent (thought signatures must go back unchanged)
          if (p.text && !p.thought) { onStatus?.(''); onDelta(p.text); }
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('Stopped.'), { code: 'abort' });
    throw e;
  }
  return { parts, finish };
}

export async function runTurnGemini(contents, { onText, onAction, onStatus, signal } = {}) {
  let text = '';
  for (let step = 0; step < 10; step++) {
    const { parts, finish } = await streamOnce(contents, { onDelta: d => { text += d; onText?.(text); }, onStatus, signal });
    if (!parts.length) {
      if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT') text += "I can't help with that one.";
      break;
    }
    contents.push({ role: 'model', parts });
    const calls = parts.filter(p => p.functionCall);
    if (!calls.length) break;

    const responses = [];
    for (const { functionCall: fc } of calls) {
      onStatus?.(statusFor(fc.name));
      const out = await runTool(fc.name, fc.args || {});
      if (WRITE_TOOLS.has(fc.name) && !out?.error) {
        const label = describeAction(fc.name, fc.args || {});
        if (label) onAction?.(label);
      }
      responses.push({ functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: Array.isArray(out) ? { result: out } : out ?? { ok: true } } });
    }
    contents.push({ role: 'user', parts: responses });
    if (text && !text.endsWith('\n')) text += '\n\n';
  }
  onStatus?.('');
  return { text: text.trim() };
}

export async function testGeminiKey() {
  const model = await pickModel();
  return model;
}
