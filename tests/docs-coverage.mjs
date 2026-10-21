// Keeps the handbook honest: every file in the repo needs a description in
// handbook/content.js, every data store needs its fields documented, and the
// handbook page must have its required sections. Run: node tests/docs-coverage.mjs
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { FILES, FOLDERS, LAYERS, STORE_FIELDS, REQUIRED_SECTIONS } from '../handbook/content.js';
import { STORES } from '../js/db.js';

const problems = [];
const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
for (const f of [...tracked, ...untracked]) {
  if (f.startsWith('tests/shots/') || Object.keys(FOLDERS).some(d => f.startsWith(d))) continue;
  if (!FILES[f]) problems.push(`no handbook description for ${f} (add it to FILES in handbook/content.js)`);
}
for (const s of STORES) if (!STORE_FIELDS[s]) problems.push(`store "${s}" has no fields in STORE_FIELDS`);
for (const l of LAYERS) for (const m of l.mods) if (!existsSync(m)) problems.push(`layer ${l.name} lists missing file ${m}`);
const html = readFileSync('handbook/index.html', 'utf8');
for (const id of REQUIRED_SECTIONS) if (!html.includes(`<section id="${id}"`)) problems.push(`handbook is missing section #${id}`);

if (problems.length) { console.log(problems.map(p => `FAIL ${p}`).join('\n')); process.exit(1); }
console.log(`ok   handbook covers ${tracked.length + untracked.length} files, ${STORES.length} stores, ${REQUIRED_SECTIONS.length} sections`);
