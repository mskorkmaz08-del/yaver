import * as db from '../db.js';
import { html, raw, esc, toast, confirmSheet } from '../util.js';
import { MODELS } from '../ai/claude.js';
import { testMac, useCode } from '../ai/mac.js';
import { refreshWake } from '../ai/wake.js';
import { VOICES, speakNatural, unlockAudio, deviceVoices, pickDeviceVoice } from '../ai/voice.js';
import { PROVIDERS, provider, testCurrent, sortKeys, cleanKey } from '../ai/provider.js';
import { currencyOptions } from '../data.js';
import { icon } from '../icons.js';
import * as sync from '../sync.js';

export function render(root, go) {
  const s = (k, f) => db.setting(k, f);
  const key = s('apiKey', '');
  const gkey = s('geminiKey', '');
  const prov = provider();
  const gmodels = s('geminiModels', []);
  const gmodel = s('geminiModel', '');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isPhone = /iPhone|iPad|Android/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && !matchMedia('(hover: hover)').matches;

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">~/yaver <b>›</b> settings</p><h1>Settings</h1></div>
      <button class="icon-btn" data-back aria-label="Back">${raw(icon('close'))}</button>
    </header>

    ${raw(standalone ? '' : isPhone ? `<section class="card install">
      <p class="label">install on iphone</p>
      <ol class="small" style="margin:0;padding-left:18px"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>
      <p class="muted small">Yaver then opens full screen like a normal app and works offline.</p></section>` : `<section class="card install">
      <p class="label">install on this computer</p>
      ${window.yaverInstall ? '<button class="btn primary" data-install>Install Yaver on this computer</button>' : ''}
      <ol class="small" style="margin:0;padding-left:18px"><li><b>Chrome or Edge:</b> the install button above, or the install icon at the right end of the address bar.</li><li><b>Safari on a Mac:</b> menu <b>File → Add to Dock</b>, then <b>Add</b>.</li></ol>
      <p class="muted small">It then opens in its own window from the Dock and works offline. Set up Sync below so it shows the same progress as your iPhone.</p></section>`)}

    ${raw(syncSection())}

    <form class="card form" data-form>
      <p class="label">ai</p>
      <label class="field"><span>Assistant</span><select name="provider">${raw(PROVIDERS.map(([v, l]) => `<option value="${v}" ${v === prov ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
      <p class="muted small mono" data-active>now using: ${prov === 'gemini' ? (gkey ? `gemini · ${gmodel || 'auto'} · key …${gkey.slice(-4)}` : 'nothing yet, paste a gemini key below') : `claude · key …${key.slice(-4)}`}</p>
      <label class="field"><span>Gemini API key (free)</span><input name="geminiKey" type="password" autocomplete="off" value="${gkey}" placeholder="AIza…"></label>
      <p class="muted small">Free at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> → Create API key. The free tier has per-minute and per-day limits, and Google may use free-tier chats to improve its models.</p>
      <label class="field"><span>Gemini model</span><select name="geminiModel"><option value="">Auto (best free flash model)</option>${raw(gmodels.map(m => `<option value="${m}" ${m === gmodel ? 'selected' : ''}>${m}</option>`).join(''))}</select></label>
      <label class="field"><span>Anthropic API key (paid)</span><input name="apiKey" type="password" autocomplete="off" value="${key}" placeholder="sk-ant-…"></label>
      <p class="muted small">Optional. From <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> → API Keys, with credit under Billing. Keys stay on this phone.</p>
      <label class="field"><span>Claude model</span><select name="model">${raw(MODELS.map(([id, label]) => `<option value="${id}" ${id === s('model', 'claude-opus-5-5') ? 'selected' : ''}>${label}</option>`).join(''))}</select></label>
      <label class="field"><span>Claude thinking effort</span><select name="effort">${raw([['low', 'Low · quickest replies'], ['medium', 'Medium · balanced'], ['high', 'High · deepest thinking']].map(([v, l]) => `<option value="${v}" ${v === s('effort', 'low') ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
      <label class="field check"><span>Claude web search</span><input type="checkbox" name="webSearch" ${raw(s('webSearch', true) ? 'checked' : '')}></label>
      <div class="btn-row"><button type="button" class="btn ghost" data-test>Test assistant</button></div>

      <p class="label">claude on your mac</p>
      <p class="muted small">Uses your Claude subscription through Claude Code on your MacBook. When the Mac is reachable, Yaver asks it first; otherwise it uses the assistant above. Start the Yaver bridge on the Mac (steps in the repo, bridge/README.md), then paste the connection code it shows.</p>
      <div class="btn-row"><button type="button" class="btn" data-paste-code>Paste connection code</button></div>
      <label class="field"><span>Or type the code</span><input name="macCode" autocomplete="off" placeholder="yaver1.…"></label>
      <label class="field"><span>Bridge address</span><input name="macUrl" type="url" autocomplete="off" value="${s('macUrl', '')}" placeholder="filled in by the connection code"></label>
      <label class="field"><span>Bridge token</span><input name="macToken" type="password" autocomplete="off" value="${s('macToken', '')}" placeholder="shown when the bridge starts"></label>
      <label class="field"><span>Model on the Mac</span><select name="macModel">${raw([['sonnet', 'Sonnet · fast'], ['opus', 'Opus · smartest, uses more of your limit'], ['haiku', 'Haiku · fastest']].map(([v, l]) => `<option value="${v}" ${v === s('macModel', 'sonnet') ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
      <div class="btn-row"><button type="button" class="btn ghost" data-test-mac>Test Mac connection</button></div>
      <label class="field"><span>Voice chat engine</span><select name="voiceEngine">${raw([['live', 'Live · talks directly, fastest (Gemini, free)'], ['standard', 'Standard · listen, write, read aloud (works with the Mac)']].map(([v, l]) => `<option value="${v}" ${v === s('voiceEngine', 'live') ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
      <label class="field"><span>Reply voice (standard engine)</span><select name="voiceStyle">${raw([['device', 'iPhone voice · instant, offline (recommended)'], ['natural', 'Gemini voice · slower, can crackle']].map(([v, l]) => `<option value="${v}" ${v === s('voiceStyle', 'device') ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
      <label class="field"><span>iPhone voice</span><select name="deviceVoice" data-device-voices><option value="">Auto · British male, best installed</option></select></label>
      <p class="muted small">For a Jarvis-like voice, download a better one once: iPhone Settings → Accessibility → Spoken Content → Voices → English → <b>English (UK)</b> → <b>Arthur (Premium)</b> or <b>Daniel (Enhanced)</b>. Then reopen Yaver.</p>
      <label class="field"><span>Gemini voice (live engine and Gemini reply voice)</span><select name="ttsVoice">${raw(VOICES.map(([v, l]) => `<option value="${v}" ${v === s('ttsVoice', 'Charon') ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
      <div class="btn-row"><button type="button" class="btn ghost" data-try-voice>Hear this voice</button></div>
      <label class="field check"><span>Jarvis style (calm, measured British delivery)</span><input type="checkbox" name="jarvis" ${raw(s('jarvis', true) ? 'checked' : '')}></label>
      <label class="field check"><span>Use Claude on the Mac in voice chat (smarter, a few seconds slower)</span><input type="checkbox" name="voiceMac" ${raw(s('voiceMac', false) ? 'checked' : '')}></label>
      <label class="field check"><span>Wake word: say “Yaver” while the app is open</span><input type="checkbox" name="wakeWord" ${raw(s('wakeWord', true) ? 'checked' : '')}></label>
      <p class="muted small">Works while Yaver is on screen (iPhones don't let web apps listen in the background). From anywhere: say <b>“Hey Siri, open Yaver”</b>, then “Yaver”.</p>
      <label class="field check"><span>Voice chat listens again by itself</span><input type="checkbox" name="voiceAuto" ${raw(s('voiceAuto', true) ? 'checked' : '')}></label>
      <label class="field check"><span>Read replies out loud</span><input type="checkbox" name="speak" ${raw(s('speak', false) ? 'checked' : '')}></label>
      <label class="field"><span>Voice input language</span><select name="voiceLang">${raw([['tr-TR', 'Türkçe'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ru-RU', 'Русский'], ['kk-KZ', 'Қазақша']].map(([v, l]) => `<option value="${v}" ${v === s('voiceLang', navigator.language) ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>

      <p class="label">you</p>
      <label class="field"><span>Your name</span><input name="userName" value="${s('userName', '')}" placeholder="Mustafa"></label>
      <label class="field"><span>About you (Yaver reads this)</span><textarea name="aboutMe" rows="3" placeholder="e.g. Engineering student, exams in January, trying to eat more protein, vegetarian…">${s('aboutMe', '')}</textarea></label>
      <label class="field"><span>Currency</span><select name="currency">${raw(currencyOptions().map(([c, l]) => `<option value="${c}" ${c ? '' : 'disabled'} ${c === s('currency', 'TRY') ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>

      <p class="label">goals</p>
      <div class="grid2">
        <label class="field"><span>Monthly budget</span><input name="monthlyBudget" type="number" inputmode="decimal" value="${s('monthlyBudget', 0) || ''}" placeholder="0 = none"></label>
        <label class="field"><span>Study / day (min)</span><input name="dailyStudyMin" type="number" inputmode="numeric" value="${s('dailyStudyMin', 60)}"></label>
        <label class="field"><span>Calories / day</span><input name="dailyCalories" type="number" inputmode="numeric" value="${s('dailyCalories', 2200)}"></label>
        <label class="field"><span>Protein / day (g)</span><input name="dailyProtein" type="number" inputmode="numeric" value="${s('dailyProtein', 120)}"></label>
        <label class="field"><span>Water / day (glasses)</span><input name="dailyWater" type="number" inputmode="numeric" value="${s('dailyWater', 8)}"></label>
      </div>

      <button class="btn primary">Save</button>
    </form>

    <a class="card" href="handbook/" style="display:block;color:inherit;text-decoration:none">
      <p class="label">system handbook</p>
      <p class="muted small" style="margin:0">How Yaver works: interactive architecture, every file, data model, AI tools and specs. Updates itself as the app changes. ↗</p>
    </a>

    <section class="card">
      <p class="label">your data</p>
      <p class="muted small">Everything lives on this device${raw(sync.configured() ? ', and Sync keeps an encrypted copy for your other devices' : '')}. Back it up now and then: if you delete the app, its data goes with it. Import merges a backup in: for each record the newer version wins, so nothing newer is lost. Backups never include API keys or the sync token and passphrase.</p>
      <div class="btn-row wrap">
        <button class="btn ghost" data-export>${raw(icon('download'))} Export</button>
        <label class="btn ghost">${raw(icon('upload'))} Import<input type="file" accept="application/json,.json" data-import hidden></label>
        <button class="btn danger" data-wipe>Erase everything</button>
      </div>
    </section>
    <p class="small dim center mono">yaver v21 · press ? for keyboard shortcuts</p>`;

  root.querySelector('[data-back]').onclick = () => go('home');
  bindSync(root, go);
  const inst = root.querySelector('[data-install]');
  if (inst) inst.onclick = async () => { const p = window.yaverInstall; window.yaverInstall = null; p.prompt(); const r = await p.userChoice.catch(() => null); if (r?.outcome === 'accepted') toast('Installed'); render(root, go); };
  const form = root.querySelector('[data-form]');
  const saveForm = async () => {
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) {
      if (k === 'macCode') continue;
      const num = ['monthlyBudget', 'dailyStudyMin', 'dailyCalories', 'dailyProtein', 'dailyWater'].includes(k);
      const val = num ? Number(v) || 0 : /Key$|^macToken$/.test(k) ? cleanKey(v) : String(v).trim();
      if (k === 'geminiKey' && val !== db.setting('geminiKey', '')) await db.setSetting('geminiModel', '');
      await db.setSetting(k, val);
    }
    await sortKeys();
    if (String(fd.get('macCode') || '').trim()) await useCode(fd.get('macCode'));
    await db.setSetting('webSearch', fd.has('webSearch'));
    await db.setSetting('speak', fd.has('speak'));
    await db.setSetting('voiceAuto', fd.has('voiceAuto'));
    await db.setSetting('jarvis', fd.has('jarvis'));
    await db.setSetting('voiceMac', fd.has('voiceMac'));
    await db.setSetting('wakeWord', fd.has('wakeWord'));
    refreshWake();
  };
  form.onsubmit = async e => { e.preventDefault(); try { await saveForm(); toast('Saved'); render(root, go); } catch (err) { toast(err.message, 5000); } };
  const connect = async code => {
    try { await useCode(code); } catch (e) { return toast(e.message, 5000); }
    render(root, go);
    try { toast(await testMac()); } catch (e) { toast(`Code saved. ${e.message}`, 6000); }
  };
  root.querySelector('[data-paste-code]').onclick = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { return toast('Could not read the clipboard. Paste the code into the box below and tap Save.', 5000); }
    connect(text);
  };
  root.querySelector('[data-test]').onclick = async () => {
    await saveForm();
    try { toast(await testCurrent()); } catch (e) { toast(e.message, 4000); }
  };
  // Installed voices arrive asynchronously on iOS.
  const fillVoices = () => {
    const sel = root.querySelector('[data-device-voices]');
    if (!sel) return;
    const cur = db.setting('deviceVoice', '');
    sel.innerHTML = `<option value="">Auto · ${pickDeviceVoice('en-GB')?.name || 'British male, best installed'}</option>` + deviceVoices().map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === cur ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
  };
  fillVoices();
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fillVoices;
  root.querySelector('[data-try-voice]').onclick = async e => {
    unlockAudio();
    try { await saveForm(); } catch {}
    e.target.disabled = true;
    const line = `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}${db.setting('userName', '') ? ', ' + db.setting('userName') : ', sir'}. This is how I'll sound when I answer you.`;
    if (db.setting('voiceStyle', 'device') === 'device') {
      await new Promise(res => {
        const u = new SpeechSynthesisUtterance(line);
        u.voice = pickDeviceVoice('en-GB'); u.lang = u.voice?.lang || 'en-GB';
        u.rate = db.setting('jarvis', true) ? 1.0 : 1.05; u.pitch = db.setting('jarvis', true) ? 0.9 : 1;
        u.onend = u.onerror = res;
        speechSynthesis.cancel(); speechSynthesis.speak(u);
      });
    } else {
      try { await speakNatural(line); }
      catch { toast('Could not get the Gemini voice. Check your Gemini key, or the free voice limit may be used up for today.', 5000); }
    }
    e.target.disabled = false;
  };
  root.querySelector('[data-test-mac]').onclick = async () => {
    try { await saveForm(); } catch (e) { return toast(e.message, 5000); }
    try { toast(await testMac()); } catch (e) { toast(e.message, 5000); }
  };
  root.querySelector('[data-export]').onclick = async () => {
    const blob = new Blob([JSON.stringify(db.exportAll(), null, 1)], { type: 'application/json' });
    const file = new File([blob], `yaver-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
    a.click();
  };
  root.querySelector('[data-import]').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { const n = await db.importAll(JSON.parse(await f.text())); toast(n ? `Backup merged: ${n} records updated` : 'Nothing newer in that backup'); } catch (err) { toast(err.message, 4000); }
  };
  root.querySelector('[data-wipe]').onclick = async () => {
    if (await confirmSheet('Erase everything?', 'All expenses, meetings, study sessions, meals, chats and settings on this phone will be deleted. Export a backup first if unsure.', 'Erase')) {
      await db.wipe();
      toast('All data erased');
      go('home');
    }
  };
}

// ---------- Sync ----------
function syncSection() {
  const on = sync.configured();
  const st = sync.status();
  if (on) return html`<section class="card">
      <p class="label">sync</p>
      <p class="sync-status small"><span class="sync-dot" data-state="${st.state}"></span><span>${sync.describe()}</span></p>
      <p class="muted small">This device: <b>${sync.deviceName()}</b>. Progress, money, meetings, diet and settings sync through an encrypted secret gist on your GitHub. Chats, API keys, the token and the passphrase stay on each device.</p>
      <div class="btn-row wrap">
        <button class="btn primary" data-sync-now>Sync now</button>
        <button class="btn ghost" data-sync-off>Turn off</button>
        <button class="btn danger" data-sync-forget>Forget this device</button>
      </div>
      ${raw((db.setting('autoBackups', []) || []).length ? html`<button class="link" data-sync-restore>restore the backup taken before the first sync</button>` : '')}
    </section>`;
  return html`<section class="card">
      <p class="label">sync with your other devices</p>
      <p class="muted small">Keep the iPhone and the laptop on the same progress, with no Yaver server: everything is encrypted on this device with your passphrase, then stored in one secret gist on your GitHub account. GitHub can't read it.</p>
      <p class="small"><b>1. Create a token</b> (once, on any device):</p>
      <ol class="small muted" style="margin:0;padding-left:18px">
        <li>On github.com: your photo → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.</li>
        <li>Name: <b>Yaver sync</b>. Expiration: up to a year (set a reminder to renew it).</li>
        <li>Repository access: <b>Public repositories</b> (it needs no repository).</li>
        <li><b>Permissions → Account permissions → Gists: Read and write.</b> Nothing else.</li>
        <li><b>Generate token</b> and copy it (it's shown once). Use the same token on both devices, or make one per device.</li>
      </ol>
      <p class="small"><b>2. Choose a passphrase</b> of a few words (at least 10 characters). Use the same one on every device. If you lose it, the synced copy can't be opened; your devices keep their own data.</p>
      <p class="small"><b>3. Paste both below</b>, here and on your other device. The first device creates the gist; the second finds it and pulls everything.</p>
      <form class="form" data-sync-form style="display:flex;flex-direction:column">
        <label class="field"><span>GitHub token</span><input name="token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
        <label class="field"><span>Sync passphrase</span><input name="pass" type="password" autocomplete="new-password" placeholder="four or five random words"></label>
        <label class="field"><span>Name of this device</span><input name="name" value="${sync.deviceName()}"></label>
        <button class="btn primary">Turn on sync</button>
      </form>
    </section>`;
}

function bindSync(root, go) {
  const f = root.querySelector('[data-sync-form]');
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const b = f.querySelector('button');
    b.disabled = true; b.textContent = 'Connecting…';
    try {
      const r = await sync.setup(v);
      toast(r?.blocked ? 'Sync is on. This device is empty: open Sync now to pull your data.' : 'Sync is on.', 4000);
    } catch (err) { toast(err.message, 6000); }
    render(root, go);
  };
  const now = root.querySelector('[data-sync-now]');
  if (now) now.onclick = async () => {
    now.disabled = true; now.textContent = 'Syncing…';
    try {
      const r = await sync.syncNow({ confirmEmptyPush: () => confirmSheet('Upload an empty Yaver?', 'This device has no data but the synced copy does. Uploading would make your other devices empty too. Usually you want Cancel: the data will be pulled here instead.', 'Upload empty') });
      toast(r?.blocked ? 'Nothing uploaded.' : 'Synced', 3000);
    } catch (err) { toast(err.message, 6000); }
    render(root, go);
  };
  const off = root.querySelector('[data-sync-off]');
  if (off) off.onclick = async () => { await sync.turnOff(); toast('Sync is off on this device'); render(root, go); };
  const forget = root.querySelector('[data-sync-forget]');
  if (forget) forget.onclick = async () => {
    if (!(await confirmSheet('Forget sync on this device?', 'The token and passphrase are removed from this device. Your data here and the synced copy on GitHub both stay.', 'Forget'))) return;
    await sync.turnOff({ forget: true });
    toast('Sync forgotten on this device');
    render(root, go);
  };
  const rest = root.querySelector('[data-sync-restore]');
  if (rest) rest.onclick = async () => {
    const b = db.setting('autoBackups', [])[0];
    if (!b || !(await confirmSheet('Restore the earlier backup?', `Taken ${b.at.slice(0, 16).replace('T', ' ')}. It is merged in: records changed since then keep their newer version.`, 'Restore'))) return;
    const n = await db.importAll(b.backup);
    toast(`${n} records restored`);
  };
}
