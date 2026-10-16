// End-to-end encryption for sync: AES-GCM 256 with a key derived from the
// sync passphrase (PBKDF2-SHA-256, random salt, fresh IV on every upload).
// The passphrase never leaves the device; only ciphertext goes to GitHub.
const ITER = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

const keys = new Map();
async function deriveKey(pass, salt, iter) {
  const id = `${b64(salt)}:${iter}:${pass.length}:${pass}`;
  if (keys.has(id)) return keys.get(id);
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  keys.clear();
  keys.set(id, key);
  return key;
}

async function gzip(bytes, mode) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(mode === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Reuse one salt per passphrase so the slow key derivation runs once per session.
let lastSalt = null;
export async function encryptJSON(obj, pass, salt = lastSalt) {
  if (!pass) throw new Error('No sync passphrase set.');
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  lastSalt = salt;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, ITER);
  let bytes = enc.encode(JSON.stringify(obj));
  const z = await gzip(bytes, 'c');
  if (z) bytes = z;
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return JSON.stringify({ yaver: 'sync', v: 1, alg: 'AES-GCM-256/PBKDF2-SHA256', iter: ITER, gz: !!z, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}

export class WrongPassphrase extends Error {
  constructor() { super('Wrong sync passphrase: this device could not decrypt the synced data. Nothing was changed.'); this.code = 'passphrase'; }
}

export async function decryptJSON(text, pass) {
  let env;
  try { env = JSON.parse(text); } catch { throw new Error('The sync file is damaged (not Yaver sync data).'); }
  if (env?.yaver !== 'sync' || !env.data) throw new Error('The sync file is not Yaver sync data.');
  const salt = unb64(env.salt);
  const key = await deriveKey(pass, salt, env.iter || ITER);
  let bytes;
  try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data))); } catch { throw new WrongPassphrase(); }
  lastSalt = salt;
  if (env.gz) bytes = await gzip(bytes, 'd');
  return JSON.parse(dec.decode(bytes));
}
