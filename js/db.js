// Local database: everything Yaver knows lives in IndexedDB on this device.
// On start we load every store into memory (the data is small), so views can
// read synchronously; every write goes to memory and IndexedDB together.
// Every write is stamped with updatedAt + deviceId, and every delete leaves a
// tombstone, so two devices can merge their copies record by record (sync.js).

const DB_NAME = 'yaver';
const DB_VERSION = 3;
export const STORES = ['expenses', 'events', 'subjects', 'sessions', 'meals', 'tasks', 'milestones', 'chats', 'kv',
  'courseProgress', 'cards', 'courseLessons', 'courseTests', 'tombstones'];

// Settings that belong to this device only: never synced, never in backups' sync payload.
export const LOCAL_KEYS = new Set(['apiKey', 'geminiKey', 'provider', 'model', 'effort', 'geminiModel', 'geminiModels', 'speak', 'voiceLang', 'voiceStyle', 'voiceName', 'lastLoc', 'onboarded', 'webSearch', 'deviceId', 'deviceName', 'autoBackups', 'macUrl', 'macToken', 'macModel']);
export const isLocalKey = id => LOCAL_KEYS.has(id) || id.startsWith('sync');
// Stores that never leave the device (chat history can be large and holds photos).
export const LOCAL_STORES = new Set(['chats']);

let idb;
const mem = Object.fromEntries(STORES.map(s => [s, new Map()]));
const listeners = new Set();
let device = '';

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function openDB() {
  idb = await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      for (const s of STORES) {
        if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  for (const s of STORES) {
    const rows = await req(idb.transaction(s).objectStore(s).getAll());
    for (const row of rows) mem[s].set(row.id, row);
  }
  device = setting('deviceId', '');
  if (!device) { device = uid(); await setSetting('deviceId', device); }
  await migrate();
  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

// v2 → v3: give old rows an updatedAt, and move practice counters to one key per device.
async function migrate() {
  const stale = [];
  for (const s of STORES) for (const row of mem[s].values()) if (!row.updatedAt) stale.push([s, row]);
  for (const [s, row] of stale) await write(s, { ...row, updatedAt: row.createdAt || new Date(0).toISOString() });
  for (const row of [...mem.kv.values()]) {
    const m = /^(practice:[a-z]+|water):(\d{4}-\d\d-\d\d)$/.exec(row.id);
    if (!m) continue;
    await put('kv', { id: `${row.id}:${device}`, value: row.value });
    await remove('kv', row.id);
  }
}

export const deviceId = () => device;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function all(store) {
  return [...mem[store].values()];
}

export function get(store, id) {
  return mem[store].get(id);
}

async function write(store, row) {
  mem[store].set(row.id, row);
  await req(idb.transaction(store, 'readwrite').objectStore(store).put(row));
}

export async function put(store, row) {
  if (!row.id) row.id = uid();
  const now = new Date().toISOString();
  if (!row.createdAt) row.createdAt = now;
  row.updatedAt = now;
  row.deviceId = device;
  await write(store, row);
  if (mem.tombstones.has(`${store}/${row.id}`)) await dropTombstone(`${store}/${row.id}`);
  notify(store, row.id);
  return row;
}

export async function remove(store, id) {
  const existed = mem[store].delete(id);
  await req(idb.transaction(store, 'readwrite').objectStore(store).delete(id));
  if (store !== 'tombstones' && !(store === 'kv' && isLocalKey(id))) {
    await write('tombstones', { id: `${store}/${id}`, store, rid: id, deletedAt: new Date().toISOString() });
  }
  notify(store, id);
  return existed;
}

async function dropTombstone(id) {
  mem.tombstones.delete(id);
  await req(idb.transaction('tombstones', 'readwrite').objectStore('tombstones').delete(id));
}

// Settings and small values live in the 'kv' store as {id: key, value}.
export function setting(key, fallback) {
  const row = mem.kv.get(key);
  return row === undefined ? fallback : row.value;
}

export function setSetting(key, value) {
  return put('kv', { id: key, value });
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(store, id) {
  for (const fn of listeners) fn(store, id);
}

// ---------- Merging (used by sync and by Import) ----------
// Newest updatedAt wins; a tombstone newer than the record deletes it.
// Returns how many rows changed here. Does not stamp: merged rows keep their own time.
export async function merge(data, { local = false } = {}) {
  let changed = 0;
  const tomb = new Map((data.tombstones || []).map(t => [t.id, t]));
  for (const t of tomb.values()) {
    const mine = mem.tombstones.get(t.id);
    if (!mine || mine.deletedAt < t.deletedAt) await write('tombstones', t);
    const row = mem[t.store]?.get(t.rid);
    if (row && (row.updatedAt || '') < t.deletedAt) {
      mem[t.store].delete(t.rid);
      await req(idb.transaction(t.store, 'readwrite').objectStore(t.store).delete(t.rid));
      changed++;
    }
  }
  for (const s of STORES) {
    if (s === 'tombstones' || !data[s] || (!local && LOCAL_STORES.has(s))) continue;
    for (const row of data[s]) {
      if (!row || row.id == null) continue;
      if (s === 'kv' && !local && isLocalKey(row.id)) continue;
      const t = mem.tombstones.get(`${s}/${row.id}`);
      if (t && t.deletedAt >= (row.updatedAt || '')) continue;
      const mine = mem[s].get(row.id);
      if (mine && (mine.updatedAt || '') >= (row.updatedAt || '')) continue;
      await write(s, { ...row, updatedAt: row.updatedAt || row.createdAt || new Date(0).toISOString() });
      changed++;
    }
  }
  pruneTombstones();
  if (changed) notify('*');
  return changed;
}

async function pruneTombstones() {
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  for (const t of all('tombstones')) if (t.deletedAt < cutoff) await dropTombstone(t.id);
}

// Everything that syncs between devices: no keys, no device-only settings, no chats.
export function syncPayload() {
  const data = {};
  for (const s of STORES) {
    if (LOCAL_STORES.has(s)) continue;
    data[s] = all(s).filter(r => !(s === 'kv' && isLocalKey(r.id)));
  }
  return data;
}

export function isEmpty() {
  return STORES.every(s => s === 'kv' || s === 'tombstones' || mem[s].size === 0) && !all('kv').some(r => !isLocalKey(r.id));
}

// Backup: the whole database as one JSON file, and back.
const SECRET = new Set(['apiKey', 'geminiKey', 'macToken']);
export function exportAll() {
  const data = {};
  for (const s of STORES) data[s] = all(s).filter(r => !(s === 'kv' && (SECRET.has(r.id) || r.id.startsWith('sync') || r.id === 'autoBackups')));
  return { app: 'yaver', version: DB_VERSION, exportedAt: new Date().toISOString(), data };
}

// Import merges by updatedAt (old v2 backups have no updatedAt: their rows only fill gaps).
export async function importAll(backup) {
  if (backup?.app !== 'yaver' || !backup.data) throw new Error('This is not a Yaver backup file.');
  const data = {};
  for (const s of STORES) {
    data[s] = (backup.data[s] || []).map(r => (r.updatedAt ? r : { ...r, updatedAt: r.createdAt || new Date(0).toISOString() }))
      .filter(r => !(s === 'kv' && (SECRET.has(r.id) || r.id === 'deviceId' || r.id.startsWith('sync'))));
    // v2 counters were one key per day: give them a device suffix so they add up instead of colliding.
    if (s === 'kv') data[s] = data[s].map(r => (/^(practice:[a-z]+|water):\d{4}-\d\d-\d\d$/.test(r.id) ? { ...r, id: `${r.id}:import` } : r));
  }
  return merge(data, { local: true });
}

export async function wipe() {
  for (const s of STORES) {
    mem[s].clear();
    await req(idb.transaction(s, 'readwrite').objectStore(s).clear());
  }
  await setSetting('deviceId', device);
  notify('*');
}
