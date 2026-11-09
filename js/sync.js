// Sync between the laptop and the iPhone with no Yaver server: one private
// (secret) GitHub Gist holds the database, encrypted on the device first.
// Order: pull → merge record by record (newest updatedAt wins) → push.
// Token and passphrase stay on each device; chats and API keys never sync.
import * as db from './db.js';
import { encryptJSON, decryptJSON } from './crypto.js';

const API = 'https://api.github.com';
const DESC = 'Yaver sync, encrypted';
const FILE = 'yaver-sync.enc';
const PART = 900000;

const S = (k, f) => db.setting(k, f);
export const configured = () => !!(S('syncToken', '') && S('syncPass', '') && S('syncEnabled', false));
export function status() {
  return { enabled: S('syncEnabled', false), lastAt: S('syncLastAt', null), lastFrom: S('syncLastFrom', ''), state: S('syncState', 'off'), error: S('syncError', ''), gistId: S('syncGistId', '') };
}

export function deviceName() {
  const custom = S('deviceName', '');
  if (custom) return custom;
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'MacBook';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'this device';
}

async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${S('syncToken', '')}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw new Error('GitHub rejected the key (expired or deleted). Make a new one: Settings → Sync → Forget this device, then set up again.');
  if (res.status === 403 || res.status === 404 && path.startsWith('/gists?')) throw new Error(res.headers.get('x-ratelimit-remaining') === '0' ? 'GitHub says too many requests. Sync will try again later.' : 'This GitHub key can\'t use gists. Make a new one with the link in Settings → Sync (it ticks “gist”).');
  if (!res.ok) { let m = ''; try { m = (await res.json()).message; } catch {} throw Object.assign(new Error(`GitHub error ${res.status}${m ? `: ${m}` : ''}`), { status: res.status }); }
  return res.status === 204 ? null : res.json();
}

async function findGist() {
  const id = S('syncGistId', '');
  if (id) {
    try { return await gh(`/gists/${id}`); } catch (e) { if (e.status !== 404) throw e; }
  }
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const hit = list.find(g => g.description === DESC);
    if (hit) { await db.setSetting('syncGistId', hit.id); return gh(`/gists/${hit.id}`); }
    if (list.length < 100) break;
  }
  return null;
}

async function readGist(g) {
  const names = Object.keys(g.files).filter(n => n === FILE || n.startsWith(FILE + '.')).sort((a, b) => partNo(a) - partNo(b));
  if (!names.length) return null;
  const parts = [];
  for (const n of names) {
    const f = g.files[n];
    parts.push(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
  }
  return parts.join('');
}
const partNo = n => (n === FILE ? 1 : Number(n.slice(FILE.length + 1)) || 1);

function filesFor(text, existing = {}) {
  const files = {};
  const chunks = [];
  for (let i = 0; i < text.length; i += PART) chunks.push(text.slice(i, i + PART));
  chunks.forEach((c, i) => { files[i ? `${FILE}.${i + 1}` : FILE] = { content: c }; });
  for (const n of Object.keys(existing)) if ((n === FILE || n.startsWith(FILE + '.')) && !files[n]) files[n] = null;
  return files;
}

const countRows = data => Object.entries(data || {}).reduce((a, [s, rows]) => a + (s === 'tombstones' ? 0 : rows.length), 0);

async function autoBackup() {
  const list = S('autoBackups', []);
  const snap = { at: new Date().toISOString(), backup: db.exportAll() };
  await db.setSetting('autoBackups', [snap, ...list].slice(0, 3));
}

let running = null;
let merging = false;
export const isMerging = () => merging;

// confirmEmptyPush: called when this device is empty but the gist isn't; return true to overwrite.
export function syncNow({ confirmEmptyPush } = {}) {
  if (running) return running;
  running = run(confirmEmptyPush).finally(() => { running = null; });
  return running;
}

async function run(confirmEmptyPush) {
  if (!configured()) return { skipped: true };
  if (!navigator.onLine) { await setState('offline'); return { offline: true }; }
  await setState('syncing');
  const pass = S('syncPass', '');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let g = await findGist();
      let remote = null;
      if (g) {
        const text = await readGist(g);
        if (text) remote = await decryptJSON(text, pass); // throws on a wrong passphrase: nothing changed
      }
      if (remote?.data) {
        if (!S('syncFirstDone', false) && !db.isEmpty()) await autoBackup();
        merging = true;
        try {
          const changed = await db.merge(remote.data);
          if (changed && remote.deviceName) await db.setSetting('syncLastFrom', remote.deviceName);
        } finally { merging = false; }
      }
      const data = db.syncPayload();
      if (remote?.data && countRows(data) === 0 && countRows(remote.data) > 0) {
        if (!(await confirmEmptyPush?.())) { await setState('error', 'This device is empty and the synced copy is not. Nothing was uploaded.'); return { blocked: true }; }
      }
      const body = await encryptJSON({ app: 'yaver', deviceId: db.deviceId(), deviceName: deviceName(), at: new Date().toISOString(), data }, pass);
      if (!g) {
        g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: DESC, public: false, files: filesFor(body) }) });
        await db.setSetting('syncGistId', g.id);
      } else {
        // Did the other device push while we were merging? Then pull again first.
        const fresh = await gh(`/gists/${g.id}`);
        if (fresh.updated_at !== g.updated_at) continue;
        g = await gh(`/gists/${g.id}`, { method: 'PATCH', body: JSON.stringify({ files: filesFor(body, g.files) }) });
      }
      await db.setSetting('syncFirstDone', true);
      await db.setSetting('syncLastAt', new Date().toISOString());
      await setState('ok');
      return { ok: true };
    }
    await setState('error', 'The other device kept syncing at the same moment. Try again.');
    return { busy: true };
  } catch (e) {
    await setState(e.code === 'passphrase' ? 'error' : navigator.onLine ? 'error' : 'offline', e.message);
    throw e;
  }
}

async function setState(state, error = '') {
  if (S('syncState', '') !== state || S('syncError', '') !== error) {
    await db.setSetting('syncState', state);
    await db.setSetting('syncError', error);
  }
  paintDot();
}

export function paintDot() {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  const st = configured() ? S('syncState', 'off') : 'off';
  dot.dataset.state = st;
  dot.hidden = st === 'off';
  dot.title = describe();
}

export function describe() {
  if (!configured()) return 'Sync is off.';
  const s = status();
  if (s.state === 'syncing') return 'Syncing…';
  if (s.state === 'offline') return 'Offline, will sync later.';
  if (s.state === 'error') return `Sync problem: ${s.error}`;
  if (!s.lastAt) return 'Not synced yet.';
  const m = Math.round((Date.now() - new Date(s.lastAt)) / 60000);
  const ago = m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  return `Synced ${ago}${s.lastFrom && s.lastFrom !== deviceName() ? ` · last changes from ${s.lastFrom}` : ''}.`;
}

const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
// A long random passphrase: nobody has to choose or type one; the sync code carries it.
export function newPass() {
  const a = crypto.getRandomValues(new Uint8Array(18));
  return b64u(String.fromCharCode(...a)).slice(0, 24);
}
// Link that opens GitHub's new-token page with only the gist scope ticked.
export const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Yaver%20sync';

// Set up on this device: check the token, find or create the gist, first pull.
// fresh (the first device, usually the iPhone): an older synced copy this passphrase can't
// open is renamed and kept on GitHub, never overwritten, and a new one is started.
export async function setup({ token, pass, name, gistId, fresh = false }) {
  token = String(token || '').trim();
  if (!token) throw new Error('Paste the GitHub key first.');
  if (!/^(ghp_|github_pat_|gho_)[A-Za-z0-9_]{10,}$/.test(token)) throw new Error('That does not look like a GitHub key. It starts with ghp_ and is copied from the GitHub page in step 1.');
  pass = pass || S('syncPass', '') || newPass();
  if (pass.length < 10) throw new Error('Use a passphrase of at least 10 characters.');
  await db.setSetting('syncToken', token);
  await db.setSetting('syncPass', pass);
  if (gistId) await db.setSetting('syncGistId', gistId);
  if (name) await db.setSetting('deviceName', name.trim());
  if (fresh) await retireUnreadable(pass);
  await db.setSetting('syncEnabled', true);
  await db.setSetting('syncFirstDone', false);
  return syncNow({ confirmEmptyPush: async () => false });
}

async function retireUnreadable(pass) {
  const g = await findGist();
  if (!g) return;
  const text = await readGist(g);
  if (!text) return;
  try { await decryptJSON(text, pass); return; } catch (e) { if (e.code !== 'passphrase') throw e; }
  await gh(`/gists/${g.id}`, { method: 'PATCH', body: JSON.stringify({ description: `${DESC} (older copy, ${new Date().toISOString().slice(0, 10)})` }) });
  await db.setSetting('syncGistId', '');
}

// The sync code: GitHub key + passphrase + gist, for pasting on the other device.
// It opens the synced data, so it is treated like a password.
export function code() {
  if (!configured()) return '';
  return 'yaversync1.' + b64u(JSON.stringify({ t: S('syncToken', ''), p: S('syncPass', ''), g: S('syncGistId', '') }));
}
export function parseCode(raw) {
  const m = String(raw || '').match(/yaversync1\.([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try { const { t, p, g } = JSON.parse(unb64u(m[1])); return t && p ? { token: t, pass: p, gistId: g || '' } : null; } catch { return null; }
}
export async function join(raw, name) {
  const c = parseCode(raw);
  if (!c) throw new Error('That is not a Yaver sync code. On the other device open Settings → Sync and tap Copy sync code.');
  return setup({ ...c, name });
}

export async function turnOff({ forget = false } = {}) {
  await db.setSetting('syncEnabled', false);
  if (forget) for (const k of ['syncToken', 'syncPass', 'syncGistId', 'syncLastAt', 'syncLastFrom', 'syncFirstDone']) await db.setSetting(k, k === 'syncFirstDone' ? false : '');
  await setState('off');
}

let timer;
export function initSync() {
  paintDot();
  const kick = () => { if (configured()) syncNow().catch(() => {}); };
  db.onChange((store, id) => {
    if (merging || !configured() || store === 'chats') return;
    if (store === 'kv' && db.isLocalKey(String(id))) return;
    clearTimeout(timer);
    timer = setTimeout(kick, 10000);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  window.addEventListener('online', kick);
  setTimeout(kick, 1500);
  setInterval(paintDot, 60000);
}
