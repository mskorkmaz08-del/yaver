// Yaver handbook. Reference sections read the app's own modules and files, and
// GitHub's API, at load time, so they stay current without editing this page.
import { FILES, FOLDERS, LAYERS, SERVICES, STORE_FIELDS, LANES, FLOWS, STACK, BROWSER_APIS, SECURITY, RECIPES, TESTS } from './content.js';

const REPO = 'mskorkmaz08-del/yaver';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setLive = (k, v) => document.querySelectorAll(`[data-live="${k}"]`).forEach(el => (el.textContent = v));
const fmtSize = b => (b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const ago = iso => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const getJSON = async url => { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); };

// ---------------------------------------------------------------- live data
const live = { tree: null, tools: [], write: new Set(), stores: [], localStores: new Set(), localKeys: [], course: null, lessons: 0 };

async function loadLive() {
  const jobs = [
    fetch('../sw.js').then(r => r.text()).then(t => setLive('version', (t.match(/VERSION\s*=\s*'([^']+)'/) || [])[1] || '?')),
    import('../js/ai/tools.js').then(m => { live.tools = m.toolDefinitions; live.write = m.WRITE_TOOLS; renderTools(); }),
    import('../js/db.js').then(m => { live.stores = m.STORES; live.localStores = m.LOCAL_STORES; live.localKeys = [...m.LOCAL_KEYS]; renderStores(); }),
    fetch('../js/ai/claude.js').then(r => r.text()).then(t => setLive('claude-models', [...t.matchAll(/\['claude-[^']+',\s*'([^'·]+)/g)].map(m => m[1].replace('Claude ', '').trim()).join(' · ') || '?')),
    loadCourse(),
    getJSON(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`).then(t => { live.tree = t.tree.filter(x => x.type === 'blob'); }).catch(() => {}),
    getJSON(`https://api.github.com/repos/${REPO}/commits?per_page=25`).then(renderLog).catch(() => { $('#log').innerHTML = '<li class="dim">Could not reach GitHub right now (offline or rate-limited). Try again later.</li>'; setLive('updated', '—'); }),
  ];
  await Promise.allSettled(jobs.slice(0, 6));
  renderFiles();
}

async function loadCourse() {
  const c = await getJSON('../data/course/course.json');
  live.course = c;
  const counts = await Promise.all(c.weeks.filter(w => w.file).map(w => getJSON(`../data/course/${w.file}`).then(d => (d.lessons || []).length).catch(() => 0)));
  live.lessons = counts.reduce((a, b) => a + b, 0);
  setLive('lessons', live.lessons);
  renderCourse();
}

// ---------------------------------------------------------------- 3D system map
let rx = 62, rz = -32, spread = 1, selected = null, dragging = false, lastInteract = 0;
const GAP = 118;
const svcPos = (i, n) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return [Math.cos(a) * 330, Math.sin(a) * 235]; };
const layerZ = i => i * GAP * spread;

function buildMap() {
  const stage = $('#stage');
  stage.innerHTML = '<div class="grid-floor"></div>';
  LAYERS.forEach((l, i) => {
    const p = document.createElement('div');
    p.className = 'plane';
    p.dataset.id = l.id;
    p.style.borderColor = l.color;
    p.innerHTML = `<div class="pl-name" style="color:${l.color}">${esc(l.name)}</div><div class="pl-tag">${esc(l.tag)}</div><div class="pl-mods">${l.mods.map(m => `<span>${esc(m.split('/').pop())}</span>`).join('')}</div>`;
    p.onclick = e => { e.stopPropagation(); select({ kind: 'layer', id: l.id }); };
    stage.append(p);
  });
  SERVICES.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'svc';
    el.dataset.id = s.id;
    el.innerHTML = `<div class="face">${esc(s.name)}<small>${esc(s.proto.split(',')[0])}</small></div>`;
    el.onclick = e => { e.stopPropagation(); select({ kind: 'svc', id: s.id }); };
    stage.append(el);
    const b = document.createElement('div');
    b.className = 'beam';
    b.dataset.svc = s.id;
    stage.append(b);
  });
  layoutMap();
  select({ kind: 'layer', id: 'ai' });
}

function layoutMap() {
  const stage = $('#stage');
  const k = Math.min(1, $('#scene').clientWidth / 860);
  stage.style.transform = `scale3d(${k}, ${k}, ${k}) rotateX(${rx}deg) rotateZ(${rz}deg)`;
  LAYERS.forEach((l, i) => {
    const p = stage.querySelector(`.plane[data-id="${l.id}"]`);
    const lift = selected?.kind === 'layer' && selected.id === l.id ? 14 : 0;
    p.style.transform = `translateZ(${layerZ(i) + lift}px)`;
    p.classList.toggle('on', selected?.id === l.id || (selected?.kind === 'svc' && SERVICES.find(s => s.id === selected.id)?.layer === l.id));
    p.style.boxShadow = p.classList.contains('on') ? `0 0 0 1px ${l.color}, 0 0 40px ${l.color}33` : 'none';
  });
  const topZ = layerZ(LAYERS.length - 1);
  SERVICES.forEach((s, i) => {
    const [x, y] = svcPos(i, SERVICES.length);
    const z = topZ * 0.5 + 30;
    const el = stage.querySelector(`.svc[data-id="${s.id}"]`);
    el.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
    el.classList.toggle('on', selected?.id === s.id || (selected?.kind === 'layer' && selected.id === s.layer));
    // Beam from the service to the centre of the layer it talks to.
    const li = LAYERS.findIndex(l => l.id === s.layer);
    const dx = -x, dy = -y, dz = layerZ(li) - z;
    const flat = Math.hypot(dx, dy), len = Math.hypot(flat, dz);
    const b = stage.querySelector(`.beam[data-svc="${s.id}"]`);
    b.style.width = `${len}px`;
    b.style.transform = `translate3d(${x}px, ${y}px, ${z}px) rotateZ(${Math.atan2(dy, dx)}rad) rotateY(${-Math.atan2(dz, flat)}rad)`;
    b.classList.toggle('on', el.classList.contains('on'));
  });
}

function select(sel) {
  selected = sel;
  const panel = $('#map-panel');
  if (sel.kind === 'layer') {
    const l = LAYERS.find(x => x.id === sel.id);
    const svcs = SERVICES.filter(s => s.layer === l.id);
    panel.innerHTML = `<p class="label" style="color:${l.color}">layer</p><h3>${esc(l.name)}</h3><p class="muted small">${esc(l.text)}</p>
      <ul>${l.mods.map(m => `<li><code>${esc(m)}</code> ${esc(FILES[m] || '')}</li>`).join('')}</ul>
      ${svcs.length ? `<p class="small muted" style="margin-top:12px">Talks to: ${svcs.map(s => `<b>${esc(s.name)}</b>`).join(', ')}</p>` : ''}`;
  } else {
    const s = SERVICES.find(x => x.id === sel.id);
    panel.innerHTML = `<p class="label">external service</p><h3>${esc(s.name)}</h3><p class="muted small">${esc(s.role)}</p><p class="small"><span class="dim">protocol</span><br><code>${esc(s.proto)}</code></p><p class="small muted">Connected to the <b>${esc(LAYERS.find(l => l.id === s.layer).name)}</b> layer.</p>`;
  }
  layoutMap();
}

function initMapControls() {
  const scene = $('#scene');
  let sx = 0, sy = 0;
  scene.addEventListener('pointerdown', e => { dragging = true; sx = e.clientX; sy = e.clientY; scene.setPointerCapture(e.pointerId); });
  scene.addEventListener('pointermove', e => {
    if (!dragging) return;
    rz += (e.clientX - sx) * 0.35;
    rx = Math.max(15, Math.min(80, rx - (e.clientY - sy) * 0.3));
    sx = e.clientX; sy = e.clientY;
    lastInteract = Date.now();
    layoutMap();
  });
  scene.addEventListener('pointerup', () => { dragging = false; });
  $('[data-explode]').onclick = e => { spread = spread === 1 ? 1.7 : 1; e.target.textContent = spread === 1 ? 'spread layers' : 'stack layers'; lastInteract = Date.now(); layoutMap(); };
  $('[data-reset]').onclick = () => { rx = 62; rz = -32; spread = 1; $('[data-explode]').textContent = 'spread layers'; layoutMap(); };
  // Gentle idle sway so the depth reads at a glance.
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let base = rz;
  (function sway(t) {
    if (!reduce && !dragging && Date.now() - lastInteract > 4000) { rz = base + Math.sin(t / 2600) * 6; layoutMap(); } else base = rz;
    requestAnimationFrame(sway);
  })(0);
}

// ---------------------------------------------------------------- sequence diagram
let route = 'mac', step = 0, playing = null, anim = null;
const LX = i => 70 + i * 117, ROW = 46, TOP = 74;

function drawFlow() {
  const steps = FLOWS[route].steps;
  const W = LX(LANES.length - 1) + 70, H = TOP + steps.length * ROW + 20;
  const svg = $('#flow-svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let s = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>';
  LANES.forEach((n, i) => {
    s += `<rect x="${LX(i) - 50}" y="16" width="100" height="28" rx="7" fill="#17171b" stroke="#24242a"/><text class="lane-head" x="${LX(i)}" y="35">${esc(route === 'mac' && n === 'Model' ? 'Mac Claude' : n)}</text>`;
    s += `<line class="lane-line" x1="${LX(i)}" y1="46" x2="${LX(i)}" y2="${H - 8}"/>`;
  });
  steps.forEach(([a, b, label], k) => {
    const y = TOP + k * ROW + 18, x1 = LX(a), x2 = LX(b), dir = Math.sign(x2 - x1) || 1;
    const cls = k < step ? 'done' : k === step ? 'cur' : '';
    s += `<g class="${cls}"><line class="msg" x1="${x1 + dir * 4}" y1="${y}" x2="${x2 - dir * 6}" y2="${y}" marker-end="url(#ah)"/><text class="msg-label" x="${(x1 + x2) / 2}" y="${y - 7}">${esc(label)}</text></g>`;
  });
  s += '<circle class="pkt" id="pkt" r="5" cx="-20" cy="-20"/>';
  svg.innerHTML = s;
  const [a, b, label, text] = steps[step];
  $('#flow-text').innerHTML = `<b>${step + 1}. ${esc(label)}</b><br>${esc(text)}`;
  $('#flow-count').textContent = `${step + 1} / ${steps.length}`;
  movePacket(LX(a), LX(b), TOP + step * ROW + 18);
}

function movePacket(x1, x2, y) {
  cancelAnimationFrame(anim);
  const pkt = $('#pkt'), t0 = performance.now(), dur = 700;
  (function f(t) {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    pkt.setAttribute('cx', x1 + (x2 - x1) * e);
    pkt.setAttribute('cy', y);
    if (p < 1) anim = requestAnimationFrame(f);
  })(t0);
}

function initFlow() {
  const seg = $('#flow-route');
  seg.innerHTML = Object.entries(FLOWS).map(([k, f]) => `<button data-route="${k}">${esc(f.label)}</button>`).join('');
  const mark = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.route === route));
  seg.onclick = e => { const b = e.target.closest('button'); if (!b) return; route = b.dataset.route; step = 0; stop(); mark(); drawFlow(); };
  mark();
  const n = () => FLOWS[route].steps.length;
  const stop = () => { clearInterval(playing); playing = null; $('[data-flow="play"]').textContent = '▶ play'; };
  document.querySelectorAll('[data-flow]').forEach(b => (b.onclick = () => {
    const a = b.dataset.flow;
    if (a === 'next') { stop(); step = Math.min(n() - 1, step + 1); }
    if (a === 'prev') { stop(); step = Math.max(0, step - 1); }
    if (a === 'play') {
      if (playing) return stop();
      if (step >= n() - 1) step = 0;
      b.textContent = '❚❚ pause';
      playing = setInterval(() => { if (step >= n() - 1) return stop(); step++; drawFlow(); }, 1700);
    }
    drawFlow();
  }));
  drawFlow();
}

// ---------------------------------------------------------------- files
function groupOf(path) {
  for (const l of LAYERS) if (l.mods.includes(path)) return l.name;
  if (/^(index\.html|manifest|sw\.js|css\/)/.test(path)) return 'Shell & offline';
  if (/^js\/(util|ui|forms|ics|icons|keys)\.js$/.test(path)) return 'UI helpers';
  if (path.startsWith('bridge/')) return 'Mac bridge';
  if (path.startsWith('data/') || path.startsWith('vendor/') || path.startsWith('icons/')) return 'Data, content & vendor';
  if (path.startsWith('tests/')) return 'Tests';
  return 'Docs & handbook';
}
const GROUP_ORDER = ['Shell & offline', 'Screens', 'AI agent', 'Logic', 'Storage', 'UI helpers', 'Mac bridge', 'Data, content & vendor', 'Tests', 'Docs & handbook'];
const GROUP_COLOR = Object.fromEntries(LAYERS.map(l => [l.name, l.color]));

function renderFiles() {
  const q = $('#file-filter').value.trim().toLowerCase();
  let rows;
  if (live.tree) {
    const folded = new Map();
    for (const f of live.tree) {
      const folder = Object.keys(FOLDERS).find(d => f.path.startsWith(d));
      if (folder) { const r = folded.get(folder) || { path: folder, size: 0, n: 0, desc: FOLDERS[folder] }; r.size += f.size; r.n++; folded.set(folder, r); continue; }
      if (f.path.startsWith('tests/shots/')) continue;
      folded.set(f.path, { path: f.path, size: f.size, desc: FILES[f.path] });
    }
    rows = [...folded.values()];
    setLive('files', live.tree.filter(f => /\.(js|mjs|css|html)$/.test(f.path) && !f.path.startsWith('vendor/')).length);
  } else {
    rows = [...Object.entries(FILES).map(([path, desc]) => ({ path, desc })), ...Object.entries(FOLDERS).map(([path, desc]) => ({ path, desc }))];
    setLive('files', Object.keys(FILES).filter(p => /\.(js|mjs|css|html)$/.test(p)).length);
  }
  if (q) rows = rows.filter(r => (r.path + ' ' + (r.desc || '')).toLowerCase().includes(q));
  const groups = new Map(GROUP_ORDER.map(g => [g, []]));
  for (const r of rows) groups.get(groupOf(r.path))?.push(r);
  $('#files').innerHTML = [...groups].filter(([, rs]) => rs.length).map(([g, rs]) => `
    <div class="group"><h3><i style="background:${GROUP_COLOR[g] || '#3a3a44'}"></i>${esc(g)} <span class="dim mono small">${rs.length}</span></h3>
      ${rs.sort((a, b) => a.path.localeCompare(b.path)).map(r => `<div class="file"><code>${esc(r.path)}${r.n ? ` <span class="dim">(${r.n} files)</span>` : ''}</code><span class="desc ${r.desc ? '' : 'missing'}">${esc(r.desc || 'Not documented yet')}</span><span class="sz">${fmtSize(r.size)}</span></div>`).join('')}
    </div>`).join('') || '<p class="dim">No match.</p>';
}

// ---------------------------------------------------------------- data model
function renderStores() {
  setLive('stores', live.stores.length);
  $('#stores').innerHTML = live.stores.map(s => `<button class="store ${live.localStores.has(s) ? 'local' : ''}" data-store="${s}">${esc(s)}<small>${live.localStores.has(s) ? 'this device only' : s === 'kv' ? 'syncs, except device keys' : 'syncs'}</small></button>`).join('');
  $('#stores').onclick = e => {
    const b = e.target.closest('[data-store]');
    if (!b) return;
    document.querySelectorAll('.store').forEach(x => x.classList.toggle('on', x === b));
    const s = b.dataset.store;
    $('#store-detail').innerHTML = `<b>${esc(s)}</b>: ${esc(STORE_FIELDS[s] || 'fields not documented yet')}<br><span class="small">${live.localStores.has(s) ? 'Never leaves this device.' : 'Merged across devices by sync: newest updatedAt wins; deletions travel as tombstones.'}</span>`;
  };
  $('#local-keys').innerHTML = live.localKeys.map(k => `<span class="chip">${esc(k)}</span>`).join('') + '<span class="chip">sync*</span>';
}

// ---------------------------------------------------------------- AI
function renderRoute() {
  const box = (x, y, w, t, sub, hi) => `<rect x="${x}" y="${y}" width="${w}" height="46" rx="9" fill="#111114" stroke="${hi ? '#b8f34a' : '#2c2c33'}"/><text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" fill="#ececf0" font-family="ui-monospace,monospace" font-size="12">${t}</text><text x="${x + w / 2}" y="${y + 36}" text-anchor="middle" fill="#5c5c66" font-family="ui-monospace,monospace" font-size="10">${sub}</text>`;
  const arr = (x1, y1, x2, y2, t) => `<path d="M${x1},${y1} L${x2},${y2}" stroke="#3a3a44" stroke-width="1.5" fill="none" marker-end="url(#ah2)"/>${t ? `<text x="${(x1 + x2) / 2 + 6}" y="${(y1 + y2) / 2 - 4}" fill="#9a9aa6" font-family="ui-monospace,monospace" font-size="10">${t}</text>` : ''}`;
  $('#route-diagram').innerHTML = `<svg viewBox="0 0 900 190"><defs><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#3a3a44"/></marker></defs>
    ${box(10, 72, 120, 'your message', 'text or photo')}
    ${box(180, 72, 150, 'photo attached?', 'bridge is text only')}
    ${box(380, 10, 170, 'Mac set up + /health ok?', '2.5 s check, cached 30 s')}
    ${box(610, 10, 140, 'Claude on Mac', 'subscription', true)}
    ${box(380, 134, 170, 'provider()', 'which key is saved')}
    ${box(610, 100, 120, 'Gemini', 'free · default', true)}
    ${box(610, 150, 120, 'Claude API', 'sk-ant- key')}
    ${arr(130, 95, 178, 95)}${arr(330, 85, 378, 40, 'no')}${arr(330, 108, 378, 152, 'yes')}${arr(550, 33, 608, 33, 'yes')}${arr(465, 56, 465, 132, 'no')}${arr(550, 150, 608, 125)}${arr(550, 162, 608, 172)}
    ${arr(680, 56, 680, 98, '')}<text x="690" y="82" fill="#9a9aa6" font-family="ui-monospace,monospace" font-size="10">Mac drops mid-message → retry here</text></svg>`;
}

function renderTools() {
  setLive('tools', live.tools.length);
  setLive('tools-n', `(${live.tools.length})`);
  const q = $('#tool-filter').value.trim().toLowerCase();
  const list = live.tools.filter(t => !q || (t.name + t.description).toLowerCase().includes(q));
  $('#tools').innerHTML = list.map(t => {
    const props = t.input_schema?.properties || {}, req = new Set(t.input_schema?.required || []);
    return `<div class="tool ${live.write.has(t.name) ? 'write' : ''}"><b>${esc(t.name)}</b><p>${esc(t.description)}</p><div class="params">${Object.entries(props).map(([k, v]) => `<span class="${req.has(k) ? 'req' : ''}" title="${esc(v.description || '')}">${esc(k)}${req.has(k) ? '*' : ''}: ${esc(v.type || (v.enum ? 'enum' : 'any'))}</span>`).join('') || '<span>no input</span>'}</div></div>`;
  }).join('');
}

// ---------------------------------------------------------------- course
let box = 0;
function renderCourse() {
  const c = live.course;
  const weeks = c.weeks.length, files = c.weeks.filter(w => w.file).length;
  $('#course-stats').innerHTML = [[c.start, 'week 1 starts'], [weeks, 'weeks planned'], [files, 'weeks written'], [live.lessons, 'lessons'], [`${Math.round(c.masteryThreshold * 100)}%`, 'mastery score'], [`${c.sleep.start}–${c.sleep.end}`, 'sleep protected']]
    .map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
  $('#phases').innerHTML = c.phases.map(p => `<div class="phase"><b>${esc(p.name || p.title || p.id)}</b><span class="mono">weeks ${p.weeks[0]}–${p.weeks[1]}</span>${p.goal ? `<br>${esc(p.goal)}` : ''}</div>`).join('');
  $('#tracks').innerHTML = c.tracks.map(t => `<span class="chip"><i style="background:${t.color}"></i>${esc(t.name)}</span>`).join('');
  drawBoxes();
}
function drawBoxes() {
  const iv = live.course?.cardIntervals || [1, 3, 7, 14, 30, 60];
  $('#boxes').innerHTML = [0, ...iv].map((d, i) => `<div class="box"><b>${i === 0 ? 'new' : `+${d}d`}</b>${i === 0 ? 'learning' : `box ${i}`}${i === box ? '<div class="card3d"></div>' : ''}</div>`).join('');
}

// ---------------------------------------------------------------- service worker
const NET = {
  online: ['Online', ['app', 'sw', 'net'], 'The worker asks the network first. The fresh file is shown and also saved to the cache, so updates appear on the next open.'],
  slow: ['Slow (> 3 s)', ['app', 'sw', 'cache'], 'The network hasn\'t answered within 3 seconds, so the saved copy is served instantly. The network reply still refreshes the cache in the background.'],
  offline: ['Offline', ['app', 'sw', 'cache'], 'No network: every app file comes from the cache. Trackers, course and map history work; only AI, sync and new map tiles need internet.'],
  api: ['AI / sync call', ['app', 'net'], 'Requests to other sites (Gemini, Anthropic, GitHub, the Mac bridge) skip the worker and always go straight to the network.'],
};
function initSW() {
  const seg = $('#net-mode');
  seg.innerHTML = Object.entries(NET).map(([k, [l]]) => `<button data-net="${k}">${l}</button>`).join('');
  const show = k => {
    const [, on, text] = NET[k];
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.net === k));
    $('#sw').innerHTML = `<div class="node ${on.includes('app') ? 'on' : ''}">Yaver app<small>asks for a file</small></div>
      <div class="node ${on.includes('sw') ? 'on' : 'off'}">Service worker<small>sw.js · network-first</small></div>
      <div class="stack"><div class="node ${on.includes('net') ? 'on' : 'off'}">Network<small>GitHub Pages / APIs</small></div><div class="node ${on.includes('cache') ? 'on' : 'off'}">Cache Storage<small>on the phone</small></div></div>`;
    $('#sw-text').textContent = text;
  };
  seg.onclick = e => { const b = e.target.closest('button'); if (b) show(b.dataset.net); };
  show('online');
}

// ---------------------------------------------------------------- sync
const PIPE = [
  ['MacBook data', 'records changed since last sync'], ['Pull', 'download the Gist, decrypt'], ['Merge', 'per record: newest updatedAt wins; tombstones delete'],
  ['JSON → gzip', 'CompressionStream'], ['Encrypt', 'AES-GCM 256 · PBKDF2 310k · fresh IV'], ['GitHub Gist', 'ciphertext only'], ['iPhone', 'pulls, decrypts, merges the same way'],
];
function initSync() {
  $('#pipe').innerHTML = PIPE.map(([b, t], i) => `<div class="pnode" data-i="${i}"><b>${esc(b)}</b><span>${esc(t)}</span></div>`).join('');
  $('#security').innerHTML = SECURITY.map(s => `<li>${esc(s)}</li>`).join('');
  let timer;
  $('[data-sync]').onclick = () => {
    clearInterval(timer);
    let i = 0;
    const nodes = [...document.querySelectorAll('.pnode')];
    const rand = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
    const tick = () => {
      nodes.forEach((n, k) => n.classList.toggle('on', k === i));
      const gist = nodes[5];
      gist.classList.toggle('cipher', i >= 4);
      gist.innerHTML = i >= 4 ? `<b>GitHub Gist</b>${rand()}…` : `<b>GitHub Gist</b><span>ciphertext only</span>`;
      $('#pipe-text').innerHTML = `<b>${esc(PIPE[i][0])}</b>: ${esc(PIPE[i][1])}.`;
      if (++i >= nodes.length) clearInterval(timer);
    };
    tick();
    timer = setInterval(tick, 1100);
  };
}

// ---------------------------------------------------------------- specs, ship, log
function renderStatic() {
  const kv = rows => rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('');
  $('#stack').innerHTML = kv(STACK);
  $('#apis').innerHTML = kv(BROWSER_APIS);
  $('#services').innerHTML = kv(SERVICES.map(s => [s.name, `${s.role} ${s.proto}.`]));
  $('#recipes').innerHTML = RECIPES.map(([t, d]) => `<div class="recipe"><b>${esc(t)}</b>${esc(d)}</div>`).join('');
  $('#tests').innerHTML = kv(TESTS);
  $('#ship-steps').innerHTML = [
    ['Change', 'Edit files in the repo; update the handbook text for anything new.'],
    ['Bump', 'Raise VERSION in sw.js so phones fetch the new files.'],
    ['Test', 'Playwright tests with mocked AI and GitHub; docs coverage check.'],
    ['Push', 'git push to main on GitHub.'],
    ['Deploy', 'GitHub Pages publishes within about a minute.'],
    ['Update', 'Close and reopen the app twice: install, then use.'],
  ].map(([b, t]) => `<div><b>${esc(b)}</b>${esc(t)}</div>`).join('');
}

function renderLog(commits) {
  if (commits[0]) setLive('updated', ago(commits[0].commit.committer.date));
  $('#log').innerHTML = commits.map(c => {
    const d = new Date(c.commit.committer.date);
    return `<li><span class="d">${d.toISOString().slice(0, 10)}</span><a href="${esc(c.html_url)}">${c.sha.slice(0, 7)}</a><span>${esc(c.commit.message.split('\n')[0])}</span></li>`;
  }).join('');
}

// Highlight the section in view.
function initToc() {
  const links = [...document.querySelectorAll('.toc a')];
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`)); }), { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('main section[id]').forEach(s => io.observe(s));
}

buildMap();
initMapControls();
addEventListener('resize', layoutMap);
initFlow();
renderRoute();
initSW();
initSync();
renderStatic();
initToc();
$('#file-filter').oninput = renderFiles;
$('#tool-filter').oninput = renderTools;
document.querySelectorAll('[data-grade]').forEach(b => (b.onclick = () => {
  const g = Number(b.dataset.grade), n = (live.course?.cardIntervals || [1, 3, 7, 14, 30, 60]).length;
  box = g === 0 || g === 1 ? 0 : Math.min(n, box + 1);
  drawBoxes();
}));
renderFiles();
loadLive();
