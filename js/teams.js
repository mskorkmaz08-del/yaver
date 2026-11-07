// Teams: the people Mustafa coordinates (the dev team and the students he
// mentors), the activities they had (what, where, when, who) and, for each
// person, when he last met them and whether a meeting is planned. Meetings
// count from three places: activities logged here, Yaver meetings and Apple
// Calendar events whose title names the person ("Call with Ali").
import * as db from './db.js';
import * as D from './data.js';
import { today, dayKey } from './util.js';

export const TEAMS = { student: 'Students', dev: 'Dev team' };
export const KINDS = { meeting: 'Meeting', activity: 'Activity', event: 'Event' };
// How often to meet someone (days); 0 means no target.
export const EVERY = [[0, 'No target'], [7, 'Every week'], [14, 'Every 2 weeks'], [30, 'Every month']];
const DEFAULT_EVERY = { student: 14, dev: 0 };

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('tr').replace(/ı/g, 'i');
const byName = (a, b) => a.name.localeCompare(b.name, 'tr');

export const people = team => db.all('people').filter(p => !team || p.team === team).sort(byName);
export const activities = team => db.all('activities')
  .filter(a => !team || a.team === team || a.team === 'both')
  .sort((a, b) => b.date.localeCompare(a.date));

export function findPerson(name) {
  const n = fold(name).trim();
  if (!n) return null;
  const all = db.all('people');
  return all.find(p => fold(p.name) === n) || all.find(p => fold(p.name).split(/\s+/)[0] === n) || all.find(p => fold(p.name).startsWith(n)) || null;
}

export function addPerson({ name, team = 'student', role = '', meetEvery, contact = '', notes = '' }) {
  name = String(name || '').trim();
  if (!name) throw new Error('name is required');
  if (!TEAMS[team]) team = 'student';
  const dup = db.all('people').find(p => fold(p.name) === fold(name));
  if (dup) return dup;
  return db.put('people', { name, team, role, contact, notes, meetEvery: Number(meetEvery ?? DEFAULT_EVERY[team]) || 0 });
}

// Names → ids. Unknown names are added to the activity's team (students for "both").
export async function resolvePeople(names, team = 'student') {
  const ids = [], added = [];
  for (const raw of names || []) {
    const name = String(raw).trim();
    if (!name) continue;
    let p = findPerson(name);
    if (!p) { p = await addPerson({ name, team: team === 'dev' ? 'dev' : 'student' }); added.push(p.name); }
    if (!ids.includes(p.id)) ids.push(p.id);
  }
  return { ids, added };
}

export async function logActivity({ title, kind = 'activity', team = 'student', date, place = '', people: names = [], notes = '' }) {
  title = String(title || '').trim();
  if (!title) throw new Error('title is required');
  const d = date ? new Date(date) : new Date();
  if (isNaN(d)) throw new Error('date must look like 2026-11-07T15:00');
  if (!['student', 'dev', 'both'].includes(team)) team = 'student';
  const { ids, added } = await resolvePeople(names, team);
  const row = await db.put('activities', { title, kind: KINDS[kind] ? kind : 'activity', team, date: d.toISOString(), place: String(place || ''), people: ids, notes: String(notes || '') });
  return { row, added };
}

// Does an event title name this person? Whole words, first name or full name.
function names(p) {
  const full = fold(p.name).trim();
  const first = full.split(/\s+/)[0];
  return [...new Set([full, first].filter(n => n.length >= 3))];
}
const wordIn = (hay, n) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(hay);
export const mentions = (text, p) => { const h = fold(text); return names(p).some(n => wordIn(h, n)); };

// Every time this person was (or will be) met, newest first.
export function contacts(p) {
  const out = [];
  for (const a of db.all('activities')) if ((a.people || []).includes(p.id)) out.push({ at: a.date, end: a.date, title: a.title, place: a.place, kind: a.kind, from: 'activity', id: a.id });
  for (const e of D.allEvents()) if (!e.allDay && mentions(e.title, p)) out.push({ at: e.start, end: e.end, title: e.title, place: e.location, kind: 'meeting', from: D.isApple(e) ? 'apple' : 'yaver', id: e.id });
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// Last met, next planned, and whether a meeting is overdue.
export function status(p, now = new Date()) {
  const iso = now.toISOString();
  const all = contacts(p);
  const last = all.find(c => c.at <= iso) || null;
  const next = [...all].reverse().find(c => c.at > iso) || null;
  const days = last ? Math.floor((new Date(dayKey(now)) - new Date(dayKey(new Date(last.at)))) / 86400000) : null;
  const every = Number(p.meetEvery) || 0;
  const overdue = !!every && !next && (days === null || days > every);
  return { last, next, days, every, overdue, count: all.filter(c => c.at <= iso).length };
}

// People with a target who haven't been met within it and have nothing planned, longest first.
export function needMeeting(team) {
  return people(team).map(p => ({ p, s: status(p) })).filter(x => x.s.overdue)
    .sort((a, b) => (b.s.days ?? 1e9) - (a.s.days ?? 1e9));
}

export const ago = days => days === null ? 'never met' : days === 0 ? 'met today' : days === 1 ? 'met yesterday' : `met ${days} days ago`;

// A compact picture for the assistant.
export function summary(team) {
  return {
    teams: Object.fromEntries(Object.keys(TEAMS).filter(t => !team || t === team).map(t => [t, people(t).map(p => {
      const s = status(p);
      return { id: p.id, name: p.name, role: p.role || undefined, last_met: s.last ? s.last.at.slice(0, 16) : null, days_since: s.days, next: s.next ? `${s.next.at.slice(0, 16)} ${s.next.title}` : null, meet_every_days: s.every || undefined, overdue: s.overdue || undefined };
    })])),
    recent_activities: activities(team).slice(0, 15).map(a => ({ id: a.id, title: a.title, kind: a.kind, team: a.team, date: a.date.slice(0, 16), place: a.place || undefined, people: (a.people || []).map(id => db.get('people', id)?.name).filter(Boolean) })),
    today: today(),
  };
}
