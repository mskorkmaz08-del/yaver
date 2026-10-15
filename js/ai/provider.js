// Which AI Yaver talks to: Gemini (free tier) or Claude (paid, smartest).
// The key's prefix tells them apart, so one paste box works for both.
import * as db from '../db.js';
import { testKey } from './claude.js';
import { testGeminiKey } from './gemini.js';

export const PROVIDERS = [['gemini', 'Gemini · free'], ['anthropic', 'Claude · paid']];

export function provider() {
  const p = db.setting('provider', '');
  if (p) return p;
  if (db.setting('geminiKey', '')) return 'gemini';
  if (db.setting('apiKey', '')) return 'anthropic';
  return 'gemini';
}

export const hasKey = () => !!db.setting(provider() === 'gemini' ? 'geminiKey' : 'apiKey', '');

export function kindOfKey(v) {
  if (v.startsWith('sk-ant-')) return 'anthropic';
  if (v.startsWith('AIza')) return 'gemini';
  return '';
}

// Store a pasted key under the right provider, switch to it, and check it works.
export async function saveKey(raw) {
  const v = (raw || '').trim();
  const kind = kindOfKey(v);
  if (!kind) throw new Error('That is not a Gemini key (starts with AIza) or a Claude key (starts with sk-ant-).');
  await db.setSetting(kind === 'gemini' ? 'geminiKey' : 'apiKey', v);
  await db.setSetting('provider', kind);
  return testCurrent();
}

export async function testCurrent() {
  if (provider() === 'gemini') { const m = await testGeminiKey(); return `Key works. Yaver is using ${m} (free).`; }
  await testKey();
  return 'Key works. Yaver is using Claude.';
}
