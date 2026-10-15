// The Yaver chat: a full-screen sheet that opens from the glowing button.
import * as db from '../db.js';
import { runTurn } from './claude.js';
import { runTurnGemini, userMessage } from './gemini.js';
import { provider } from './provider.js';
import { html, raw, md, esc, shrinkImage, toast, haptic } from '../util.js';
import { icon } from '../icons.js';

const CHAT_ID = 'main';
let chat;          // { id, api: [Claude messages], gapi: [Gemini messages], view: [what the user sees] }
let busy = false;
let abort;
let pendingImage = null;
let el;

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
        <button class="icon-btn" data-new aria-label="New chat">${icon('edit')}</button>
      </header>
      <div class="chat-log" data-log></div>
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
  el.querySelector('[data-new]').onclick = () => { if (busy) return; chat = { id: CHAT_ID, api: [], gapi: [], view: [] }; save(); render(); };
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
  setupVoice(el.querySelector('[data-mic]'), input);
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

export function closeAssistant() {
  el.classList.remove('open');
  document.body.classList.remove('chat-open');
  speechSynthesis?.cancel?.();
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
  return `<div class="msg bot">${actions}<div class="bot-text">${body}</div></div>`;
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
  speechSynthesis?.cancel?.();

  // Each AI keeps its own history format; switching AI starts that one's context fresh.
  const gem = provider() === 'gemini';
  const prompt = text || 'What do you see? If it is food, log it as a meal; if it is a receipt, log the expense.';
  const img = pendingImage && { media_type: pendingImage.media_type, data: pendingImage.data };
  chat.view.push({ role: 'user', text, image: pendingImage?.url });
  pendingImage = null;
  el.querySelector('[data-preview]').hidden = true;

  const reply = { role: 'bot', text: '', actions: [] };
  chat.view.push(reply);
  const history = gem ? (chat.gapi ||= []) : chat.api;
  const before = history.length;
  if (gem) history.push(userMessage(prompt, img));
  else history.push({ role: 'user', content: [...(img ? [{ type: 'image', source: { type: 'base64', ...img } }] : []), { type: 'text', text: prompt }] });
  busy = true;
  el.classList.add('busy');
  el.querySelector('[data-send]').innerHTML = icon('stop');
  setStatus('Thinking…');
  render();

  const log = el.querySelector('[data-log]');
  const live = () => log.lastElementChild;
  abort = new AbortController();
  try {
    const { text: out } = await (gem ? runTurnGemini : runTurn)(history, {
      signal: abort.signal,
      onText: t => { reply.text = t; live().outerHTML = bubble(reply); scrollDown(); },
      onAction: a => { reply.actions.push(a); haptic(); live().outerHTML = bubble(reply); },
      onStatus: setStatus,
    });
    reply.text = out || (reply.actions.length ? 'Done.' : '…');
    if (db.setting('speak', false)) speak(reply.text);
  } catch (e) {
    // Drop the unfinished turn from what we send next time, so the conversation stays valid.
    history.length = before;
    reply.error = e.code !== 'abort';
    reply.text = e.code === 'abort' ? (reply.text || 'Stopped.') : e.message;
    if (e.code === 'nokey') reply.text += ' (Settings → AI)';
  } finally {
    busy = false;
    el.classList.remove('busy');
    el.querySelector('[data-send]').innerHTML = icon('send');
    setStatus('');
    // Long conversations: start a fresh context (the screen keeps the old bubbles).
    // We never edit earlier turns in place, because the model's saved reasoning is tied to them.
    if (history.length > 80) { history.length = 0; chat.view.push({ role: 'bot', text: '`context reset` Your data is kept; earlier messages in this chat are not.', actions: [] }); }
    save();
    render();
  }
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, '').slice(0, 1200));
  u.lang = /[çğıöşüÇĞİÖŞÜ]/.test(text) ? 'tr-TR' : (navigator.language || 'en-US');
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

function setupVoice(btn, input) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.onclick = () => toast('Use the mic key on your iPhone keyboard to dictate.');
    return;
  }
  let rec = null;
  btn.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = db.setting('voiceLang', navigator.language || 'en-US');
    rec.interimResults = true;
    rec.continuous = false;
    btn.classList.add('listening');
    haptic();
    let finalText = '';
    rec.onresult = e => {
      let interim = '';
      for (const r of e.results) (r.isFinal ? (finalText = r[0].transcript) : (interim += r[0].transcript));
      input.value = finalText || interim;
      autosize(input);
    };
    rec.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Voice input is unavailable here. Use the keyboard mic instead.'); };
    rec.onend = () => {
      btn.classList.remove('listening');
      rec = null;
      if (finalText.trim()) send(finalText);
    };
    try { rec.start(); } catch { btn.classList.remove('listening'); rec = null; }
  };
}
