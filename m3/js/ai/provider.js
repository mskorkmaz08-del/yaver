// Which AI Yaver talks to: Gemini (free tier) or Claude (paid, smartest).
// The key's prefix tells them apart, so a key works whichever box it is pasted in.
import * as db from '../db.js';
import { testKey } from './claude.js';
import { testGeminiKey } from './gemini.js';

export const PROVIDERS = [['gemini', 'Gemini · free'], ['anthropic', 'Claude · paid']];

// Claude keys start with sk-ant-; anything else is treated as a Google key.
export const kindOfKey = v => (!v ? '' : v.startsWith('sk-ant-') ? 'anthropic' : 'gemini');
// Copying on a phone can pick up spaces, line breaks or quotes.
export const cleanKey = v => String(v || '').replace(/[\s"'`]/g, '');

// Put each stored key in the slot that matches its prefix (fixes a Gemini key
// pasted into the Claude box, or the other way round).
export async function sortKeys() {
  const a = cleanKey(db.setting('apiKey', ''));
  const g = cleanKey(db.setting('geminiKey', ''));
  const keys = { anthropic: '', gemini: '' };
  for (const k of [g, a]) if (k) keys[kindOfKey(k)] ||= k;
  if (keys.anthropic !== db.setting('apiKey', '')) await db.setSetting('apiKey', keys.anthropic);
  if (keys.gemini !== db.setting('geminiKey', '')) await db.setSetting('geminiKey', keys.gemini);
  // Never stay on an AI that has no key when the other one has one.
  const p = db.setting('provider', '');
  const has = { anthropic: !!keys.anthropic, gemini: !!keys.gemini };
  if (!has[p]) await db.setSetting('provider', has.gemini || !has.anthropic ? 'gemini' : 'anthropic');
}

export function provider() {
  const p = db.setting('provider', '');
  const has = { anthropic: !!db.setting('apiKey', ''), gemini: !!db.setting('geminiKey', '') };
  if (has[p]) return p;
  if (has.gemini) return 'gemini';
  if (has.anthropic) return 'anthropic';
  return 'gemini';
}

export const hasKey = () => !!db.setting(provider() === 'gemini' ? 'geminiKey' : 'apiKey', '');

// Store a pasted key under the right AI, switch to it, and check it works.
export async function saveKey(raw) {
  const v = cleanKey(raw);
  if (v.length < 20) throw new Error('That key looks too short. Copy the whole key again.');
  const kind = kindOfKey(v);
  await db.setSetting(kind === 'gemini' ? 'geminiKey' : 'apiKey', v);
  await db.setSetting('provider', kind);
  if (kind === 'gemini') await db.setSetting('geminiModel', '');
  await sortKeys();
  return testCurrent();
}

export async function testCurrent() {
  if (provider() === 'gemini') { const m = await testGeminiKey(); return `Key works. Yaver is using ${m} (free).`; }
  await testKey();
  return 'Key works. Yaver is using Claude.';
}
