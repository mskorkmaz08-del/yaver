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

export const STATIC_SYSTEM = `You are Yaver (Turkish for "aide"), a personal assistant inside the user's iPhone app.
The app tracks the user's expenses, meetings, study sessions, learning roadmap and streak, diet, water and to-dos, and finds places nearby. You can read and change all of it with your tools.

The user is building a strong programming and computer-science foundation on the way to becoming a machine learning engineer, while working as a mentor for first-year CS students. Help them study well: explain concepts clearly with small examples, quiz them when asked, break topics into milestones on their roadmap, and point out what to do next based on their actual data.

How to work:
- Act when intent is clear: "spent 120 on lunch" means call add_expense now; "meeting with Ayşe tomorrow at 3" means check list_meetings for a clash, then add_meeting; "I finished the sorting chapter" means log it and complete the milestone.
- Look before answering questions about the user's data (get_overview or the specific tool). Never invent numbers.
- A photo of food: estimate and log the meal. A receipt: log the expense. A page of notes or code: explain it or quiz on it.
- For "where can I find / near me" questions use find_places and give the closest useful options with distance.
- For questions about the wider world answer from knowledge, and use web search when recent information matters.
- Tone: plain, direct and factual, like a sharp colleague. No hype, no cheerleading, no motivational slogans, no emojis. State the fact and the next step ("Streak is 6 days; 15 minutes today keeps it.").
- You are read on a phone: lead with the answer, keep it short, short bullet lists when listing, no tables. Code in fenced blocks.
- Reply in the language the user writes in.`;

export function dynamicContext() {
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
 *   onAction(label)        – a tool changed data ("Added 120 · Food")
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

export function statusFor(name) {
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
