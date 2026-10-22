// Wake word: while Yaver is open on screen, listen for "Yaver" and start voice
// chat. Uses the phone's speech recognition in short rounds and restarts it;
// it pauses when the app is in the background (a web app can't listen there)
// and while a voice chat is running.
import * as db from '../db.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
// Ways recognisers write "Yaver" (and "Jarvis", which works too).
const WAKE = /\b(ya+ ?v[eaı]r+|yav[eı]r|javer|jarvis|yeah,? ?ver|ya ?bear|ja ?ver)\b/i;
export const wakeSupported = () => !!SR;
export const wakeOn = () => !!SR && db.setting('wakeWord', true);

let rec = null, paused = false, handler = null, failures = 0, timer;

export function initWake(onWake) {
  handler = onWake;
  document.addEventListener('visibilitychange', () => (document.hidden ? stopRec() : resumeSoon()));
  resumeSoon();
}

// Voice chat owns the microphone while it runs.
export function pauseWake() { paused = true; stopRec(); }
export function resumeWake() { paused = false; resumeSoon(); }
export function refreshWake() { stopRec(); resumeSoon(); }

function stopRec() { clearTimeout(timer); const r = rec; rec = null; try { r?.abort(); } catch {} }
function resumeSoon(ms = 400) { clearTimeout(timer); timer = setTimeout(listen, ms); }

function listen() {
  if (rec || paused || document.hidden || !wakeOn() || !db.setting('onboarded', false)) return;
  const r = rec = new SR();
  r.lang = db.setting('wakeLang', 'tr-TR'); // "Yaver" is a Turkish word; Turkish recognition spells it reliably
  r.continuous = true;
  r.interimResults = true;
  r.onresult = e => {
    failures = 0;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (WAKE.test(e.results[i][0].transcript)) { failures = 0; stopRec(); handler?.(); return; }
    }
  };
  r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') failures = 99; else if (e.error !== 'no-speech' && e.error !== 'aborted') failures++; };
  // Rounds end on their own after a while or on silence: start the next one.
  r.onend = () => { if (rec !== r) return; rec = null; if (failures < 5) resumeSoon(failures ? 1500 : 250); };
  try { r.start(); } catch { rec = null; }
}
