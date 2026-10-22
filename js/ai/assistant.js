// The Yaver chat: a full-screen sheet that opens from the glowing button.
import * as db from '../db.js';
import { runTurn } from './claude.js';
import { runTurnGemini, userMessage } from './gemini.js';
import { provider } from './provider.js';
import { macConfigured, macOnline, runTurnMac } from './mac.js';
import { startLive, liveAvailable } from './live.js';
import { pauseWake, resumeWake } from './wake.js';
import { audioCtx } from './voice.js';
import { speaker, chunks, pickDeviceVoice, unlockAudio, stopAudio, audioPlaying, suspendAudio, jarvisOn } from './voice.js';
import { html, raw, md, esc, shrinkImage, toast, haptic } from '../util.js';
import { icon } from '../icons.js';

const CHAT_ID = 'main';
let chat;          // { id, api: [Claude], gapi: [Gemini], mapi: [Claude on Mac], view: [what the user sees] }
let busy = false;
let abort;
let pendingImage = null;
let el;
let voice = false; // voice chat: speak, hear the answer, then it listens again
let live = null;   // live voice session (Gemini Live), when that engine is on
let listen = () => {};

const SUGGESTIONS = [
  'What should I study today?',
  'Quiz me on what I studied this week',
  'Explain recursion with a small Python example',
  'Log 45 min of algorithms and 3 problems',
  'Find a quiet cafe near me',
  'How much did I spend this week?',
];

function load() {
  chat = db.get('chats', CHAT_ID) || { id: CHAT_ID, api: [], view: [] };
}
const save = () => db.put('chats', chat);

export function initAssistant() {
  load();
  el = document.createElement('div');
  el.className = 'chat-wrap';
  el.innerHTML = `
    <div class="chat" role="dialog" aria-label="Yaver assistant">
      <header class="chat-head">
        <button class="icon-btn" data-close aria-label="Close">${icon('chevronDown')}</button>
        <div class="chat-title"><span class="mark sm">Y</span><div><b>Yaver</b><small data-status>ready</small></div></div>
        <div class="chat-tools"><button class="icon-btn" data-voice aria-label="Voice chat" aria-pressed="false">${icon('wave')}</button><button class="icon-btn" data-new aria-label="New chat">${icon('edit')}</button></div>
      </header>
      <div class="chat-log" data-log></div>
      <button class="voice-orb" data-orb hidden><span class="orb" aria-hidden="true"></span><b data-orb-label>tap to talk</b><small>voice chat · tap the wave icon at the top to end</small></button>
      <div class="chat-input">
        <div class="attach-preview" data-preview hidden></div>
        <div class="chat-bar">
          <label class="icon-btn" aria-label="Add photo">${icon('camera')}<input type="file" accept="image/*" data-file hidden></label>
          <textarea rows="1" placeholder="Ask Yaver anything…" data-input enterkeyhint="send"></textarea>
          <button class="icon-btn mic" data-mic aria-label="Speak">${icon('mic')}</button>
          <button class="send" data-send aria-label="Send">${icon('send')}</button>
        </div>
      </div>
    </div>`;
  document.body.append(el);

  const input = el.querySelector('[data-input]');
  el.querySelector('[data-close]').onclick = closeAssistant;
  el.querySelector('[data-new]').onclick = () => { if (busy) return; chat = { id: CHAT_ID, api: [], gapi: [], mapi: [], view: [] }; save(); render(); };
  el.querySelector('[data-send]').onclick = () => (busy ? abort?.abort() : send(input.value));
  input.addEventListener('input', () => autosize(input));
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); send(input.value); } });
  el.querySelector('[data-file]').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    pendingImage = await shrinkImage(f);
    const p = el.querySelector('[data-preview]');
    p.hidden = false;
    p.innerHTML = `<img src="${pendingImage.url}" alt=""><button data-x aria-label="Remove photo">${icon('close')}</button><span>meal, receipt, notes, code…</span>`;
    p.querySelector('[data-x]').onclick = () => { pendingImage = null; p.hidden = true; };
    input.focus();
  };
  listen = setupVoice(el.querySelector('[data-mic]'), input);
  el.querySelector('[data-voice]').onclick = () => setVoice(!voice);
  el.querySelector('[data-orb]').onclick = () => {
    if (live) return live.interrupt();
    if (busy) return abort?.abort();
    if (speaking || speechSynthesis?.speaking || audioPlaying()) { hush(); return listen(); }
    listen();
  };
  el.addEventListener('click', e => {
    const chip = e.target.closest('[data-suggest]');
    if (chip) send(chip.dataset.suggest);
  });
  render();
}

export function openAssistant(prompt) {
  el.classList.add('open');
  document.body.classList.add('chat-open');
  haptic();
  scrollDown();
  if (prompt) send(prompt);
  else if (!matchMedia('(pointer:coarse)').matches) el.querySelector('[data-input]').focus();
}

// Voice chat: one big button; each reply is read out and then Yaver listens again.
// Called by the wake word: open the chat straight into voice.
export function startVoiceChat() {
  if (!el.classList.contains('open')) openAssistant();
  if (!voice) setVoice(true);
}

function setVoice(on) {
  voice = on;
  el.classList.toggle('voice', on);
  el.querySelector('[data-orb]').hidden = !on;
  el.querySelector('[data-voice]').setAttribute('aria-pressed', String(on));
  haptic();
  if (on) {
    pauseWake();
    unlockSpeech();
    if (db.setting('voiceEngine', 'live') === 'live' && liveAvailable()) startLiveChat();
    else listen();
  } else { live?.stop(); live = null; hush(); listen.stop?.(); orb(''); resumeWake(); }
}

// Live engine: the model hears and speaks directly; each finished turn is added to the chat.
async function startLiveChat() {
  let actions = [];
  const add = m => { chat.view.push(m); save(); render(); };
  try {
    live = await startLive({
      onState: s => orb(s === 'ended' ? '' : s === 'listening' ? 'live' : s),
      onUser: text => add({ role: 'user', text }),
      onModel: text => { add({ role: 'bot', text, actions, via: 'live' }); actions = []; },
      onAction: a => { actions.push(a); haptic(); },
      onIdle: () => { live = null; if (voice) setVoice(false); },
      onError: (msg, fatal) => {
        live = null;
        if (fatal && voice) { toast(`${msg} Using standard voice chat.`, 5000); listen(); }
        else toast(msg, 5000);
      },
    });
  } catch (e) {
    live = null;
    toast(`${e.message} Using standard voice chat.`, 5000);
    if (voice) listen();
    return;
  }
  // Started by the wake word before any tap: iOS keeps sound off until one tap.
  if (audioCtx().state !== 'running') {
    orb('tap');
    document.addEventListener('pointerdown', () => { audioCtx().resume(); orb('live'); }, { once: true });
  }
}

function orb(state) {
  const o = el?.querySelector('[data-orb]');
  if (!o) return;
  o.dataset.state = state;
  o.querySelector('[data-orb-label]').textContent = { listening: 'listening…', tap: 'tap once so I can speak', live: 'live · just talk', connecting: 'connecting…', thinking: 'thinking…', voicing: 'getting the voice…', speaking: 'speaking · tap to interrupt' }[state] || 'tap to talk';
}

export function closeAssistant() {
  if (voice) setVoice(false);
  el.classList.remove('open');
  document.body.classList.remove('chat-open');
  hush();
}

function autosize(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 140) + 'px';
}

function render() {
  const log = el.querySelector('[data-log]');
  if (!chat.view.length) {
    const name = db.setting('userName', '');
    log.innerHTML = html`
      <div class="chat-empty">
        <span class="mark lg">Y</span>
        <h2>${name ? `What's next, ${name}?` : "What's next?"}</h2>
        <p class="muted small">Ask anything, or tell me what you did: I log study, practice, expenses, meetings and meals, explain concepts, quiz you, and find places nearby.</p>
        <div class="chips">${raw(SUGGESTIONS.map(s => html`<button class="chip" data-suggest="${s}">${s}</button>`).join(''))}</div>
      </div>`;
    return;
  }
  log.innerHTML = chat.view.map(bubble).join('');
  scrollDown();
}

function bubble(m) {
  if (m.role === 'user') {
    return html`<div class="msg user">${raw(m.image ? `<img src="${m.image}" alt="">` : '')}${m.text ? raw(`<p>${esc(m.text)}</p>`) : ''}</div>`;
  }
  const actions = (m.actions || []).map(a => html`<div class="receipt">${raw(icon('check'))}${a}</div>`).join('');
  const body = m.error ? html`<p class="err">${m.text}</p>` : m.text ? md(m.text) : '<span class="typing"><i></i><i></i><i></i></span>';
  const via = m.via && !m.error ? `<div class="via">${{ mac: 'claude · your mac', gemini: 'gemini', anthropic: 'claude', live: 'gemini live · voice' }[m.via]}${m.ms ? ` · ${(m.ms / 1000).toFixed(1)}s` : ''}</div>` : '';
  return `<div class="msg bot">${actions}<div class="bot-text">${body}</div>${via}</div>`;
}

function scrollDown() {
  const log = el.querySelector('[data-log]');
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

function setStatus(s) {
  el.querySelector('[data-status]').textContent = (s || (busy ? 'thinking…' : 'ready')).toLowerCase();
}

async function send(textIn) {
  const text = (textIn || '').trim();
  if (busy || (!text && !pendingImage)) return;
  const input = el.querySelector('[data-input]');
  input.value = '';
  autosize(input);
  hush();

  // Each AI keeps its own history format; switching AI starts that one's context fresh.
  const asked = text || 'What do you see? If it is food, log it as a meal; if it is a receipt, log the expense.';
  // In voice chat the answer is heard, not read: ask for short, plain sentences.
  const prompt = voice ? `${asked}\n\n(Voice chat: this reply is read aloud. Answer in a few short spoken sentences, no markdown, lists, tables or code unless I ask.${jarvisOn() ? ' Speak like JARVIS: calm, precise and understated, British English, a touch of dry wit, now and then address me as "sir". No American filler like "Great question" or "Awesome".' : ''})` : asked;
  orb('thinking');
  const img = pendingImage && { media_type: pendingImage.media_type, data: pendingImage.data };
  chat.view.push({ role: 'user', text, image: pendingImage?.url });
  pendingImage = null;
  el.querySelector('[data-preview]').hidden = true;

  const reply = { role: 'bot', text: '', actions: [] };
  chat.view.push(reply);
  busy = true;
  el.classList.add('busy');
  el.querySelector('[data-send]').innerHTML = icon('stop');
  setStatus('Thinking…');
  render();

  const log = el.querySelector('[data-log]');
  const live = () => log.lastElementChild;
  // Speak while the reply is still arriving: each finished sentence goes to the voice queue.
  const talk = voice || db.setting('speak', false);
  let said = 0;
  const feed = (t, final = false) => {
    if (!talk || t.length < said) return;
    const rest = t.slice(said);
    if (final) { const first = said === 0; said = t.length; for (const c of chunks(cleanForSpeech(rest), first)) say(c); return endSpeech(); }
    const m = rest.match(/^[\s\S]*?[.!?…](?=\s)/);
    if (!m || (said === 0 && m[0].length < 12)) return;
    // after the first sentence, wait for a fuller piece so there are fewer voice requests
    const piece = said === 0 ? m[0] : (rest.match(/^[\s\S]*[.!?…](?=\s)/) || [''])[0];
    if (said > 0 && piece.length < 140) return;
    said += piece.length;
    for (const c of chunks(cleanForSpeech(piece), said === piece.length)) say(c);
  };
  abort = new AbortController();
  const t0 = performance.now();
  const callbacks = {
    signal: abort.signal,
    onText: t => { reply.ms ??= Math.round(performance.now() - t0); reply.text = t; live().outerHTML = bubble(reply); scrollDown(); feed(t); },
    onAction: a => { reply.actions.push(a); haptic(); live().outerHTML = bubble(reply); },
    onStatus: setStatus,
  };

  // Route: Claude on the Mac when it's reachable (text only), otherwise the chosen AI.
  const routes = [];
  // Voice chat skips the Mac unless asked: Claude Code takes several seconds to start each reply.
  if (!img && macConfigured() && (!voice || db.setting('voiceMac', false))) { setStatus('Checking your Mac…'); if (await macOnline()) routes.push('mac'); }
  routes.push(provider());

  let history;
  for (const route of routes) {
    history = route === 'mac' ? (chat.mapi ||= []) : route === 'gemini' ? (chat.gapi ||= []) : chat.api;
    const before = history.length;
    if (route === 'mac') history.push({ role: 'user', text: prompt });
    else if (route === 'gemini') history.push(userMessage(prompt, img));
    else history.push({ role: 'user', content: [...(img ? [{ type: 'image', source: { type: 'base64', ...img } }] : []), { type: 'text', text: prompt }] });
    const run = route === 'mac' ? runTurnMac : route === 'gemini' ? (h, cb) => runTurnGemini(h, { ...cb, fast: voice }) : runTurn;
    try {
      const { text: out } = await run(history, callbacks);
      reply.text = out || (reply.actions.length ? 'Done.' : '…');
      reply.via = route;
      feed(reply.text, true);
      break;
    } catch (e) {
      // Drop the unfinished turn from what we send next time, so the conversation stays valid.
      history.length = before;
      // The Mac dropped off mid-message: quietly try the next AI, unless something was already done.
      if (route === 'mac' && e.code === 'offline' && !reply.actions.length) { reply.text = ''; said = 0; continue; }
      hush();
      reply.error = e.code !== 'abort';
      reply.text = e.code === 'abort' ? (reply.text || 'Stopped.') : e.message;
      break;
    }
  }
  busy = false;
  el.classList.remove('busy');
  el.querySelector('[data-send]').innerHTML = icon('send');
  setStatus('');
  if (voice && !speaking) orb('');
  // Long conversations: start a fresh context (the screen keeps the old bubbles).
  // We never edit earlier turns in place, because the model's saved reasoning is tied to them.
  if (history.length > 80) { history.length = 0; chat.view.push({ role: 'bot', text: '`context reset` Your data is kept; earlier messages in this chat are not.', actions: [] }); }
  save();
  render();
}

let speaking = false, current = null;
const hush = () => { current?.stop(); current = null; speechSynthesis?.cancel?.(); stopAudio(); speaking = false; };

// iOS only plays sound after a tap; doing it once during the tap unlocks later replies.
function unlockSpeech() {
  try { unlockAudio(); } catch {}
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

// Markdown and code read badly; strip them before speaking.
const cleanForSpeech = text => text.replace(/```[\s\S]*?```/g, ' (code on screen) ').replace(/`([^`]*)`/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_#>|]/g, '').replace(/^\s*[-•]\s+/gm, '');

// One voice queue per reply: natural (Gemini) voice per piece, the phone's voice
// for any piece Gemini can't do. When it ends, voice chat listens again.
function say(piece) {
  if (!current) {
    speaking = true;
    orb('voicing');
    const me = current = speaker({
      onStart: () => orb('speaking'),
      onDone: () => {
        if (current !== me) return;
        current = null; speaking = false;
        if (!busy) orb('');
        if (voice && el.classList.contains('open') && db.setting('voiceAuto', true)) setTimeout(() => { if (voice && !busy && !current) listen(); }, 350);
      },
      device: text => new Promise(res => speakDevice(text, res)),
    });
  }
  current.push(piece);
}
const endSpeech = () => current?.finish();

function speakDevice(clean, done) {
  if (!('speechSynthesis' in window)) return done();
  const pref = db.setting('voiceLang', navigator.language || 'en-US');
  const lang = /[çğıöşüÇĞİÖŞÜ]/.test(clean) ? 'tr-TR' : /[а-яё]/i.test(clean) ? (pref.startsWith('kk') ? 'kk-KZ' : 'ru-RU') : 'en-GB';
  const u = new SpeechSynthesisUtterance(clean);
  u.voice = pickDeviceVoice(lang);
  u.lang = u.voice?.lang || lang;
  // Jarvis: a touch lower and more measured.
  u.rate = jarvisOn() ? 1.0 : 1.05;
  u.pitch = jarvisOn() ? 0.9 : 1;
  u.onstart = () => orb('speaking');
  u.onend = u.onerror = done;
  speechSynthesis.speak(u);
}

function setupVoice(btn, input) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.onclick = () => toast('Use the mic key on your iPhone keyboard to dictate.');
    const fallback = () => { orb(''); if (voice) toast('Speech recognition is not available here: tap the text box and use the keyboard mic. Replies are still read aloud.', 5000); };
    fallback.stop = () => {};
    return fallback;
  }
  let rec = null;
  const start = () => {
    if (rec || busy) return;
    hush();
    pauseWake();
    suspendAudio();
    rec = new SR();
    rec.lang = db.setting('voiceLang', navigator.language || 'en-US');
    rec.interimResults = true;
    rec.continuous = false;
    btn.classList.add('listening');
    orb('listening');
    haptic();
    let finalText = '', quiet;
    rec.onresult = e => {
      // iOS waits a long pause before it decides you're done; stop after 0.7 s without new words.
      clearTimeout(quiet);
      quiet = setTimeout(() => rec?.stop(), 700);
      let interim = '';
      for (const r of e.results) (r.isFinal ? (finalText = r[0].transcript) : (interim += r[0].transcript));
      input.value = finalText || interim;
      autosize(input);
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' && voice) toast('Yaver needs the microphone. Allow it in iPhone Settings → Safari → Microphone, or tap the big button to try again.', 6000);
      else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Voice input is unavailable here. Use the keyboard mic instead.');
    };
    rec.onend = () => {
      clearTimeout(quiet);
      if (!voice) resumeWake();
      if (!finalText.trim()) finalText = input.value; // stopped early: use what was heard so far
      btn.classList.remove('listening');
      rec = null;
      if (finalText.trim()) send(finalText);
      else orb('');
    };
    try { rec.start(); } catch { btn.classList.remove('listening'); rec = null; orb(''); }
  };
  start.stop = () => rec?.abort();
  btn.onclick = () => { if (rec) rec.stop(); else { unlockSpeech(); start(); } };
  return start;
}
