// Runs every fenced ```python and ```cpp block in the course content.
// Blocks meant to be partial use ```python-snippet / ```cpp-snippet and are skipped.
// Usage: node tests/run-lesson-code.mjs [--week N]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../data/course');
const args = process.argv.slice(2);
const onlyWeek = args.includes('--week') ? Number(args[args.indexOf('--week') + 1]) : null;
const course = JSON.parse(fs.readFileSync(path.join(ROOT, 'course.json'), 'utf8'));

const blocks = [];
// Practice tasks with starter tests: the solution's code followed by the tests must pass.
function collectTests(l) {
  for (const s of l.steps || []) for (const t of s.tasks || []) {
    if (!t.tests || !['python', 'cpp'].includes(t.lang)) continue;
    const sol = [...String(t.solution || '').matchAll(new RegExp('```' + t.lang + '\\n([\\s\\S]*?)```', 'g'))].map(m => m[1]).join('\n');
    if (!sol) { blocks.push({ lang: 'missing', code: '', where: `${l.id} tests (no ${t.lang} solution block)` }); continue; }
    const code = t.lang === 'python'
      ? `${sol}\n\n${t.tests}\n\nfor _n, _f in list(globals().items()):\n    if _n.startswith('test_') and callable(_f):\n        _f()\n`
      : `#include <cassert>\n${sol.replace(/int\s+main\s*\(/, 'int solution_main_unused(')}\nint main() {\n${t.tests}\nreturn 0;\n}\n`;
    blocks.push({ lang: t.lang, code, where: `${l.id} tests` });
  }
}
function collect(v, where) {
  if (typeof v === 'string') {
    for (const m of v.matchAll(/```(python|cpp)\n([\s\S]*?)```/g)) blocks.push({ lang: m[1], code: m[2], where });
  } else if (Array.isArray(v)) v.forEach((x, i) => collect(x, where));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) collect(x, where);
}
for (const w of course.weeks) {
  if (!w.file || (onlyWeek !== null && w.week !== onlyWeek)) continue;
  const f = path.join(ROOT, w.file);
  if (!fs.existsSync(f)) continue;
  for (const l of JSON.parse(fs.readFileSync(f, 'utf8')).lessons) { collect(l, l.id); collectTests(l); }
}

const run = (cmd, argv, opts) => new Promise(res => execFile(cmd, argv, { timeout: 30000, maxBuffer: 4e6, ...opts }, (e, out, errOut) => res({ ok: !e, out: String(errOut || out || e?.message || '').slice(0, 600) })));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-code-'));
let n = 0;
async function one(b) {
  if (b.lang === 'missing') return { ok: false, out: 'task has tests but no runnable solution block' };
  const dir = path.join(tmp, String(n++));
  fs.mkdirSync(dir);
  if (b.lang === 'python') {
    fs.writeFileSync(path.join(dir, 'main.py'), b.code);
    return run('python3', ['-I', 'main.py'], { cwd: dir, env: { ...process.env, MPLBACKEND: 'Agg' } });
  }
  fs.writeFileSync(path.join(dir, 'main.cpp'), b.code);
  const c = await run('g++', ['-std=c++20', '-O0', '-o', 'a.out', 'main.cpp'], { cwd: dir });
  if (!c.ok) return c;
  return run('./a.out', [], { cwd: dir });
}
const failures = [];
const queue = [...blocks];
await Promise.all(Array.from({ length: Math.max(2, os.cpus().length) }, async () => {
  while (queue.length) {
    const b = queue.shift();
    const r = await one(b);
    if (!r.ok) failures.push(`${b.where} [${b.lang}]\n  ${r.out.replace(/\n/g, '\n  ')}\n  --- code starts: ${b.code.slice(0, 120).replace(/\n/g, ' ⏎ ')}`);
  }
}));
fs.rmSync(tmp, { recursive: true, force: true });
for (const f of failures) console.log('FAIL ' + f);
const py = blocks.filter(b => b.lang === 'python').length;
console.log(`${blocks.length} blocks (${py} python, ${blocks.length - py} cpp), ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
