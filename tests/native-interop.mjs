// Checks that the native Swift app and the web app read each other's sync data.
// Runs on the Mac build server (.github/workflows/native.yml) around native/CoreTests:
//   node tests/native-interop.mjs make  <fixture.json>   web app encrypts a sample database
//   (native/CoreTests decrypts it, checks it, merges, and encrypts its own copy)
//   node tests/native-interop.mjs check <from-swift.json> web app decrypts the Swift copy
import { readFileSync, writeFileSync } from 'node:fs';
import { encryptJSON, decryptJSON } from '../js/crypto.js';

const PASS = 'interop-test-passphrase-123';
const [mode, file] = process.argv.slice(2);
const fail = m => { console.error('FAIL:', m); process.exit(1); };

if (mode === 'make') {
  const now = new Date().toISOString();
  const data = {
    meals: [{ id: 'm1', name: 'Döner, KZ style', calories: 650, protein: 32.5, carbs: 60, fat: 28, meal: 'Lunch', date: '2026-11-10', time: '13:05',
      micros: { iron: 3.1, vitaminC: 12 }, items: [{ name: 'lavash', grams: 80 }], createdAt: now, updatedAt: now, deviceId: 'web' }],
    ceteleItems: [{ id: 'quran', name: "Kur'an", unit: 'pages', target: 5, per: 'day', step: 1, order: 0, archived: false, createdAt: now, updatedAt: now }],
    ceteleLog: [{ id: 'quran:2026-11-10', item: 'quran', day: '2026-11-10', value: 6, createdAt: now, updatedAt: now }],
    kv: [{ id: 'currency', value: 'KZT', updatedAt: now }, { id: 'plan', value: { title: 'ML', start: '2026-10-19', phases: [] }, updatedAt: now }],
    tombstones: [{ id: 'expenses/gone', store: 'expenses', rid: 'gone', deletedAt: now }],
  };
  writeFileSync(file, JSON.stringify({ pass: PASS, text: await encryptJSON({ app: 'yaver', deviceId: 'web', deviceName: 'iPhone', at: now, data }, PASS) }));
  console.log('fixture written');
} else if (mode === 'check') {
  const { text } = JSON.parse(readFileSync(file, 'utf8'));
  const got = await decryptJSON(text, PASS);
  const d = got.data;
  if (got.app !== 'yaver') fail('app tag');
  const meal = d.meals.find(m => m.id === 'm1');
  if (!meal || meal.name !== 'Döner, KZ style' || meal.micros?.iron !== 3.1 || meal.items?.[0]?.grams !== 80) fail('meal not kept intact: ' + JSON.stringify(meal));
  if (!d.meals.find(m => m.id === 'swift-meal')) fail('meal written by Swift missing');
  if (d.ceteleLog.find(r => r.id === 'quran:2026-11-10')?.value !== 7) fail('Swift Çetele edit missing');
  if (!d.tombstones.find(t => t.id === 'expenses/gone')) fail('tombstone lost');
  if (d.kv.find(r => r.id === 'plan')?.value?.start !== '2026-10-19') fail('nested setting lost');
  if (d.kv.some(r => r.id === 'deviceId' || r.id.startsWith('sync'))) fail('device-only setting leaked into sync');
  console.log('web app reads the Swift copy: OK');
} else {
  fail('usage: make|check <file>');
}
