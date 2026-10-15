// Local database: everything Yaver knows lives in IndexedDB on the phone.
// On start we load every store into memory (the data is small), so views can
// read synchronously; every write goes to memory and IndexedDB together.

const DB_NAME = 'yaver';
const DB_VERSION = 2;
export const STORES = ['expenses', 'events', 'subjects', 'sessions', 'meals', 'tasks', 'milestones', 'chats', 'kv'];

let idb;
const mem = Object.fromEntries(STORES.map(s => [s, new Map()]));
const listeners = new Set();

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
  // Ask iOS not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function all(store) {
  return [...mem[store].values()];
}

export function get(store, id) {
  return mem[store].get(id);
}

export async function put(store, row) {
  if (!row.id) row.id = uid();
  if (!row.createdAt) row.createdAt = new Date().toISOString();
  mem[store].set(row.id, row);
  await req(idb.transaction(store, 'readwrite').objectStore(store).put(row));
  notify(store);
  return row;
}

export async function remove(store, id) {
  const existed = mem[store].delete(id);
  await req(idb.transaction(store, 'readwrite').objectStore(store).delete(id));
  notify(store);
  return existed;
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

function notify(store) {
  for (const fn of listeners) fn(store);
}

// Backup: the whole database as one JSON file, and back.
export function exportAll() {
  const data = {};
  for (const s of STORES) data[s] = all(s).filter(r => !(s === 'kv' && (r.id === 'apiKey' || r.id === 'geminiKey')));
  return { app: 'yaver', version: DB_VERSION, exportedAt: new Date().toISOString(), data };
}

export async function importAll(backup) {
  if (backup?.app !== 'yaver' || !backup.data) throw new Error('This is not a Yaver backup file.');
  for (const s of STORES) {
    for (const row of backup.data[s] || []) await put(s, row);
  }
}

export async function wipe() {
  for (const s of STORES) {
    mem[s].clear();
    await req(idb.transaction(s, 'readwrite').objectStore(s).clear());
  }
  notify('*');
}
