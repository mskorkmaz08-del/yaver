// Claude on your Mac: Yaver talks to a small bridge (bridge/yaver-bridge.mjs)
// that runs Claude Code under your Claude subscription. The phone still runs
// every tool itself; the Mac only does the thinking. If the Mac is asleep or
// unreachable, the assistant falls back to Gemini.
import * as db from '../db.js';
import { toolDefinitions, runTool, WRITE_TOOLS, describeAction } from './tools.js';
import { STATIC_SYSTEM, dynamicContext, statusFor } from './claude.js';

const base = () => db.setting('macUrl', '').trim().replace(/\/+$/, '');
const headers = () => ({ Authorization: `Bearer ${db.setting('macToken', '').trim()}`, 'Content-Type': 'application/json' });
export const macConfigured = () => !!(base() && db.setting('macToken', ''));

let last = { at: 0, ok: false };

// Quick check before each message; remembered for 30 seconds so a chat stays snappy.
export async function macOnline(force = false) {
  if (!macConfigured()) return false;
  if (!force && Date.now() - last.at < 30000) return last.ok;
  let ok = false;
  try {
    const res = await fetch(`${base()}/health`, { headers: headers(), signal: AbortSignal.timeout(2500) });
    ok = res.ok;
  } catch {}
  last = { at: Date.now(), ok };
  return ok;
}

export async function testMac() {
  if (!macConfigured()) throw new Error('Add the bridge address and token first.');
  let res;
  try { res = await fetch(`${base()}/health`, { headers: headers(), signal: AbortSignal.timeout(5000) }); }
  catch { throw new Error('Could not reach your Mac. Is it awake, the bridge running, and Tailscale on for both devices?'); }
  if (res.status === 401) throw new Error('The Mac refused the token. Copy it again from the bridge window.');
  if (!res.ok) throw new Error(`The bridge answered ${res.status}.`);
  last = { at: Date.now(), ok: true };
  return 'Connected to Claude on your Mac.';
}

const tools = () => toolDefinitions.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

export async function runTurnMac(history, { onText, onAction, onStatus, signal } = {}) {
  let text = '';
  for (let step = 0; step < 8; step++) {
    onStatus?.('Thinking on your Mac…');
    let res;
    try {
      res = await fetch(`${base()}/chat`, {
        method: 'POST', headers: headers(), signal,
        body: JSON.stringify({
          system: `${STATIC_SYSTEM}\n\nWeb search is not available in this mode: answer from what you know, and say plainly when something may be out of date.\n\n${dynamicContext()}`,
          transcript: history, tools: tools(), model: db.setting('macModel', 'sonnet'),
        }),
      });
    } catch (e) {
      last = { at: 0, ok: false };
      if (e.name === 'AbortError') throw Object.assign(new Error('Stopped.'), { code: 'abort' });
      throw Object.assign(new Error('Lost the connection to your Mac.'), { code: 'offline' });
    }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Mac bridge error ${res.status}`);
    const calls = (out.tool_calls || []).filter(c => toolDefinitions.some(t => t.name === c.name));
    if (out.reply) { text += (text ? '\n\n' : '') + out.reply; onText?.(text); }
    history.push({ role: 'assistant', text: out.reply || '', calls });
    if (!calls.length) break;
    const results = [];
    for (const c of calls) {
      onStatus?.(statusFor(c.name));
      const r = await runTool(c.name, c.args || {});
      if (WRITE_TOOLS.has(c.name) && !r?.error) { const label = describeAction(c.name, c.args || {}); if (label) onAction?.(label); }
      results.push({ tool: c.name, result: r ?? { ok: true } });
    }
    history.push({ role: 'tool', text: JSON.stringify(results) });
  }
  onStatus?.('');
  return { text: text.trim() };
}
