import * as db from '../db.js';
import { html, raw, toast, confirmSheet } from '../util.js';
import { MODELS } from '../ai/claude.js';
import { PROVIDERS, provider, testCurrent, sortKeys, cleanKey } from '../ai/provider.js';
import { currencyOptions } from '../data.js';
import { icon } from '../icons.js';

export function render(root, go) {
  const s = (k, f) => db.setting(k, f);
  const key = s('apiKey', '');
  const gkey = s('geminiKey', '');
  const prov = provider();
  const gmodels = s('geminiModels', []);
  const gmodel = s('geminiModel', '');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">~/yaver <b>›</b> settings</p><h1>Settings</h1></div>
      <button class="icon-btn" data-back aria-label="Back">${raw(icon('close'))}</button>
    </header>

    ${raw(standalone ? '' : `<section class="card install">
      <p class="label">install on iphone</p>
      <ol class="small" style="margin:0;padding-left:18px"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>
      <p class="muted small">Yaver then opens full screen like a normal app and works offline.</p></section>`)}

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

    <section class="card">
      <p class="label">your data</p>
      <p class="muted small">Everything lives on this phone. Back it up now and then: if you delete the Home Screen app, its data goes with it.</p>
      <div class="btn-row wrap">
        <button class="btn ghost" data-export>${raw(icon('download'))} Export</button>
        <label class="btn ghost">${raw(icon('upload'))} Import<input type="file" accept="application/json,.json" data-import hidden></label>
        <button class="btn danger" data-wipe>Erase everything</button>
      </div>
    </section>
    <p class="small dim center mono">yaver v4</p>`;

  root.querySelector('[data-back]').onclick = () => go('home');
  const form = root.querySelector('[data-form]');
  const saveForm = async () => {
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) {
      const num = ['monthlyBudget', 'dailyStudyMin', 'dailyCalories', 'dailyProtein', 'dailyWater'].includes(k);
      const val = num ? Number(v) || 0 : /Key$/.test(k) ? cleanKey(v) : String(v).trim();
      if (k === 'geminiKey' && val !== db.setting('geminiKey', '')) await db.setSetting('geminiModel', '');
      await db.setSetting(k, val);
    }
    await sortKeys();
    await db.setSetting('webSearch', fd.has('webSearch'));
    await db.setSetting('speak', fd.has('speak'));
  };
  form.onsubmit = async e => { e.preventDefault(); await saveForm(); toast('Saved'); };
  root.querySelector('[data-test]').onclick = async () => {
    await saveForm();
    try { toast(await testCurrent()); } catch (e) { toast(e.message, 4000); }
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
    try { await db.importAll(JSON.parse(await f.text())); toast('Backup restored'); } catch (err) { toast(err.message, 4000); }
  };
  root.querySelector('[data-wipe]').onclick = async () => {
    if (await confirmSheet('Erase everything?', 'All expenses, meetings, study sessions, meals, chats and settings on this phone will be deleted. Export a backup first if unsure.', 'Erase')) {
      await db.wipe();
      toast('All data erased');
      go('home');
    }
  };
}
