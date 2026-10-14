// Talking to Claude. The phone calls the Anthropic API directly with the
// user's own key: there is no Yaver server in between.
//
// The "agent loop": send the conversation + tool list -> Claude answers with
// text and/or tool calls -> we run the tools on the phone -> send results back
// -> repeat until Claude is done. Replies stream in word by word.
import Anthropic from '../../vendor/anthropic-sdk.js';
import * as db from '../db.js';
import { toolDefinitions, runTool, WRITE_TOOLS, describeAction } from './tools.js';

export const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 · smartest'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 · fast & smart'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 · fastest & cheapest'],
];

const STATIC_SYSTEM = `You are Yaver (Turkish for "aide"), a personal assistant living in the user's iPhone app, like a pocket Jarvis.
The app tracks the user's expenses, meetings, study sessions and streak, diet (meals, calories, water) and to-dos, and you can read and change all of it with your tools.

How to work:
- Act, don't ask, when intent is clear: "spent 120 on lunch" means call add_expense right away; "meeting with Ayşe tomorrow at 3" means check list_meetings for a clash, then add_meeting.
- Look before you answer questions about the user's data: use get_overview or the specific list/stats tool. Never invent numbers.
- When the user sends a photo of a meal, estimate the food and macros and log it. A photo of a receipt: read the total and log the expense.
- For questions about the wider world (news, facts, prices, how-tos) answer from knowledge, and use web search when the answer depends on recent information.
- You are read on a phone screen: lead with the answer, keep replies short, use short bullet lists when listing. No tables.
- Reply in the language the user writes in (Turkish or English, or whatever they use).
- Be warm and encouraging about streaks and goals, never preachy. After logging something, confirm in one line and add one useful number (e.g. budget left, calories left, streak).`;

function dynamicContext() {
  const name = db.setting('userName', '');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const d = new Date();
  return `Current local date and time: ${d.toLocaleString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} (${tz}). Today is ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.
User's name: ${name || 'unknown'}. Currency: ${db.setting('currency', 'TRY')}.${db.setting('aboutMe', '') ? `\nAbout the user, in their words: ${db.setting('aboutMe', '')}` : ''}`;
}

let client, clientKey;
function getClient() {
  const key = db.setting('apiKey', '');
  if (!key) throw Object.assign(new Error('Add your Anthropic API key in Settings to wake Yaver up.'), { code: 'nokey' });
  if (!client || clientKey !== key) {
    // The key never leaves this phone except to go to api.anthropic.com.
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = key;
  }
  return client;
}

// Optional features we turn off for the rest of the session if the account rejects them.
const disabled = { fallbacks: false, webSearch: false };

function buildParams(messages) {
  const tools = [...toolDefinitions];
  if (db.setting('webSearch', true) && !disabled.webSearch) {
    tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 3 });
  }
  const params = {
    model: db.setting('model', 'claude-opus-5-5'),
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: db.setting('effort', 'low') },
    // Tools + the fixed instructions are cached (cheaper, faster); the clock and profile come after the cache point.
    system: [
      { type: 'text', text: STATIC_SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicContext() },
    ],
    tools,
    messages,
  };
  if (!disabled.fallbacks) {
    // If a safety check declines a request, let Anthropic retry it on a fallback model automatically.
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

/**
 * Run one user turn. `messages` is the stored conversation (API format) and is
 * appended to in place. Callbacks:
 *   onText(fullTextSoFar)  – streaming text of the current reply
 *   onAction(label)        – a tool changed data ("💸 Added 120 · Food")
 *   onStatus(text)         – what Yaver is doing ("Checking your calendar…")
 */
export async function runTurn(messages, { onText, onAction, onStatus, signal } = {}) {
  const c = getClient();
  let text = '';
  for (let step = 0; step < 12; step++) {
    let final;
    try {
      final = await streamOnce(c, messages, delta => { text += delta; onText?.(text); }, signal, onStatus);
    } catch (e) {
      throw friendlyError(e);
    }
    // Keep Claude's whole reply (thinking blocks included) exactly as returned.
    messages.push({ role: 'assistant', content: final.content });

    if (final.stop_reason === 'refusal') {
      text += (text ? '\n\n' : '') + "I can't help with that one.";
      onText?.(text);
      return { text, changed: false };
    }
    if (final.stop_reason === 'pause_turn') continue; // long web search: let Claude carry on
    if (final.stop_reason === 'max_tokens' && !final.content.some(b => b.type === 'tool_use')) break;

    const calls = final.content.filter(b => b.type === 'tool_use');
    if (!calls.length) break;

    // Run every tool Claude asked for, then return all results in one message.
    const results = [];
    for (const call of calls) {
      onStatus?.(statusFor(call.name));
      const out = await runTool(call.name, call.input);
      if (WRITE_TOOLS.has(call.name) && !out?.error) {
        const label = describeAction(call.name, call.input);
        if (label) onAction?.(label);
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out), ...(out?.error ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
    if (text && !text.endsWith('\n')) { text += '\n\n'; }
  }
  onStatus?.('');
  return { text: text.trim() };
}

async function streamOnce(c, messages, onDelta, signal, onStatus) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const params = buildParams(messages);
    try {
      const stream = c.beta.messages.stream(params, { signal });
      stream.on('text', d => { onStatus?.(''); onDelta(d); });
      stream.on('streamEvent', ev => {
        if (ev.type === 'content_block_start' && ev.content_block.type === 'server_tool_use') onStatus?.('Searching the web…');
        if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking') onStatus?.('Thinking…');
      });
      return await stream.finalMessage();
    } catch (e) {
      // Older accounts may not have every feature: drop it and retry once.
      const msg = String(e?.message || '');
      if (e instanceof Anthropic.BadRequestError) {
        if (!disabled.fallbacks && /fallback|beta/i.test(msg)) { disabled.fallbacks = true; continue; }
        if (!disabled.webSearch && /web_search|web search/i.test(msg)) { disabled.webSearch = true; continue; }
      }
      throw e;
    }
  }
  throw new Error('Could not reach Claude.');
}

function statusFor(name) {
  if (name.includes('meeting')) return 'Checking your calendar…';
  if (name.includes('expense')) return 'Updating your expenses…';
  if (name.includes('study')) return 'Looking at your studies…';
  if (name.includes('meal') || name.includes('diet') || name.includes('water')) return 'Updating your diet log…';
  if (name.includes('task')) return 'Updating your tasks…';
  return 'Looking at your day…';
}

function friendlyError(e) {
  if (e?.code === 'nokey') return e;
  if (e?.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) return Object.assign(new Error('Stopped.'), { code: 'abort' });
  if (e instanceof Anthropic.AuthenticationError) return new Error('Your API key was rejected. Check it in Settings.');
  if (e instanceof Anthropic.PermissionDeniedError) return new Error('This API key is not allowed to use that model. Try another model in Settings.');
  if (e instanceof Anthropic.RateLimitError) return new Error('Too many requests right now (or your API credit ran out). Try again in a moment.');
  if (e instanceof Anthropic.APIConnectionError) return new Error(navigator.onLine ? 'Could not reach Claude. Check your connection.' : 'You are offline. Your trackers still work; Yaver needs internet to think.');
  if (e instanceof Anthropic.InternalServerError) return new Error('Claude is having a moment (server error). Try again.');
  if (e instanceof Anthropic.APIError) return new Error(e.message || 'Claude returned an error.');
  return e instanceof Error ? e : new Error(String(e));
}

// Quick key check for the Settings screen.
export async function testKey() {
  const c = getClient();
  try {
    await c.models.retrieve(db.setting('model', 'claude-opus-5-5'));
    return true;
  } catch (e) {
    throw friendlyError(e);
  }
}
