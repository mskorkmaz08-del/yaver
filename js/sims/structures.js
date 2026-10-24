// Data structures you can operate: push and pop a stack or queue, insert into and reverse a
// linked list, hash keys into buckets, sift values through a heap, and watch recursion fill
// and empty the call stack. Every box glides to its new place.
export default function structures(host, { mode, kit }) {
  const { stage, plate, text, roundRect, arrow, loop, controls, caption, timeline, C, clamp } = kit;
  let kind = ['stack', 'queue', 'list', 'hash', 'heap', 'recursion'].includes(mode) ? mode : 'stack';
  if (kind === 'recursion') return recursion();
  const st = stage(host, { height: 260 });

  // ---------- animated boxes ----------
  let items = new Map(); // id -> {label, x, y, tx, ty, a, ta, hue}
  let seq = 0;
  const add = (label, x, y) => { const id = ++seq; items.set(id, { id, label: String(label), x, y, tx: x, ty: y, a: 0, ta: 1, hi: 0 }); return id; };
  const settle = dt => {
    let moving = false;
    for (const [id, b] of items) {
      const k = 1 - Math.exp(-dt * 10);
      b.x += (b.tx - b.x) * k; b.y += (b.ty - b.y) * k; b.a += (b.ta - b.a) * k; b.hi = Math.max(0, b.hi - dt * 1.5);
      if (Math.abs(b.tx - b.x) + Math.abs(b.ty - b.y) + Math.abs(b.ta - b.a) > 0.5 || b.hi > 0) moving = true;
      if (b.ta === 0 && b.a < 0.02) items.delete(id);
    }
    return moving;
  };
  const box = (ctx, b, w = 46, h = 30) => {
    ctx.globalAlpha = clamp(b.a, 0, 1);
    roundRect(ctx, b.x - w / 2, b.y - h / 2, w, h, 4);
    ctx.fillStyle = b.hi > 0 ? `rgba(231,176,75,${0.25 + b.hi * 0.4})` : 'rgba(217,181,108,.16)'; ctx.fill();
    ctx.strokeStyle = b.hi > 0 ? C.amber : C.brass; ctx.lineWidth = 1.5; ctx.stroke();
    text(ctx, b.label, b.x, b.y + 5, { size: 14, color: C.ink, align: 'center', mono: true });
    ctx.globalAlpha = 1;
  };
  let order = []; // ids in structure order
  let msg = '';
  const queue = []; // pending layout steps for multi-step operations (heap sifts)
  let stepT = 0;

  // ---------- layouts ----------
  const layout = () => {
    const { w, h } = st;
    if (kind === 'stack') order.forEach((id, i) => { const b = items.get(id); b.tx = w / 2; b.ty = h - 40 - i * 34; });
    if (kind === 'queue') order.forEach((id, i) => { const b = items.get(id); b.tx = 50 + i * 54; b.ty = h / 2; });
    if (kind === 'list') order.forEach((id, i) => { const b = items.get(id); const per = Math.max(1, Math.floor((w - 40) / 74)); b.tx = 44 + (i % per) * 74; b.ty = 80 + Math.floor(i / per) * 70; });
    if (kind === 'heap') order.forEach((id, i) => { const b = items.get(id); const d = Math.floor(Math.log2(i + 1)), k = i + 1 - 2 ** d; b.tx = w * ((k + 0.5) / 2 ** d); b.ty = 56 + d * 52; });
    if (kind === 'hash') buckets.forEach((ids, r) => ids.forEach((id, j) => { const b = items.get(id); b.tx = 112 + j * 76; b.ty = 34 + r * ((st.h - 40) / NB) + 10; }));
  };
  const NB = 7;
  let buckets = Array.from({ length: NB }, () => []);
  const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000003, 7);
  const WORDS = ['loop', 'gear', 'node', 'hex', 'tree', 'cog', 'byte', 'list', 'map', 'key', 'stack', 'heap', 'core', 'path', 'zaun', 'brass'];
  let reversed = false;

  const ops = {
    push() { if (order.length >= 6) { msg = 'Full in this demo: pop one first'; return; } const v = 1 + Math.floor(Math.random() * 99); const id = add(v, st.w / 2, 0); order.push(id); items.get(id).hi = 1; msg = kind === 'stack' ? `push(${v}) goes on top` : `enqueue(${v}) joins at the back`; layout(); },
    pop() {
      if (!order.length) { msg = 'Empty'; return; }
      const id = kind === 'stack' ? order.pop() : order.shift();
      const b = items.get(id); b.ta = 0; b.tx = kind === 'stack' ? st.w - 40 : -40; b.hi = 1;
      msg = kind === 'stack' ? `pop() → ${b.label}: last in, first out` : `dequeue() → ${b.label}: first in, first out`; layout();
    },
    insertHead() { if (order.length >= 10) return; const v = 1 + Math.floor(Math.random() * 99); const id = add(v, 44, 10); order.unshift(id); items.get(id).hi = 1; msg = `New node ${v} points at the old head: O(1)`; layout(); },
    append() { if (order.length >= 10) return; const v = 1 + Math.floor(Math.random() * 99); const id = add(v, st.w, 80); order.push(id); items.get(id).hi = 1; msg = `Walk to the tail, then link ${v}: O(n) without a tail pointer`; layout(); },
    reverse() { order.reverse(); reversed = !reversed; msg = 'Reverse: each next pointer flips to the previous node'; order.forEach(id => (items.get(id).hi = 0.8)); layout(); },
    hashAdd() {
      const word = WORDS[Math.floor(Math.random() * WORDS.length)];
      const r = hash(word) % NB;
      const id = add(word, 20, -20); items.get(id).hi = 1;
      buckets[r].push(id);
      msg = `hash("${word}") % ${NB} = ${r}${buckets[r].length > 1 ? `: bucket ${r} already has ${buckets[r].length - 1}, so it chains` : ''}`;
      layout();
    },
    heapPush() {
      if (order.length >= 15) { msg = 'Full in this demo: pop the minimum'; return; }
      const v = 1 + Math.floor(Math.random() * 99);
      const id = add(v, st.w / 2, st.h); order.push(id); items.get(id).hi = 1;
      layout();
      let i = order.length - 1;
      msg = `Insert ${v} at the end, then sift it up`;
      while (i > 0) { const p = (i - 1) >> 1; if (Number(items.get(order[p]).label) <= v) break; queue.push([p, i]); i = p; }
    },
    heapPop() {
      if (!order.length) return;
      const top = order[0]; const b = items.get(top); b.ta = 0; b.ty = -30; b.hi = 1;
      msg = `Pop the minimum ${b.label}; the last value moves to the top and sifts down`;
      const last = order.pop();
      if (order.length) { order[0] = last; }
      layout();
      let i = 0;
      const sim = order.slice(), v = k => Number(items.get(sim[k]).label);
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < sim.length && v(l) < v(m)) m = l; if (r < sim.length && v(r) < v(m)) m = r; if (m === i) break; queue.push([i, m]); [sim[i], sim[m]] = [sim[m], sim[i]]; i = m; }
    },
  };

  const frame = dt => {
    const { ctx, w, h } = st;
    plate(ctx, w, h);
    // run queued heap swaps at a readable pace
    if (queue.length) { stepT += dt; if (stepT > 0.45) { stepT = 0; const [a, b] = queue.shift(); [order[a], order[b]] = [order[b], order[a]]; items.get(order[a]).hi = 1; items.get(order[b]).hi = 1; layout(); } }
    const moving = settle(dt);
    if (kind === 'stack') { ctx.strokeStyle = C.faint; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w / 2 - 34, 30); ctx.lineTo(w / 2 - 34, h - 18); ctx.lineTo(w / 2 + 34, h - 18); ctx.lineTo(w / 2 + 34, 30); ctx.stroke(); if (order.length) text(ctx, '← top', w / 2 + 40, h - 35 - (order.length - 1) * 34, { size: 13, color: C.amber }); }
    if (kind === 'queue' && order.length) { text(ctx, 'front', 50, h / 2 - 28, { size: 12.5, color: C.amber, align: 'center' }); text(ctx, 'back', 50 + (order.length - 1) * 54, h / 2 + 34, { size: 12.5, color: C.amber, align: 'center' }); }
    if (kind === 'list') {
      text(ctx, 'head', 44, 52, { size: 12.5, color: C.amber, align: 'center' });
      for (let i = 0; i < order.length; i++) {
        const a = items.get(order[i]), b = items.get(order[i + 1]);
        if (b) arrow(ctx, a.x + 24, a.y, b.x - 26, b.y, { color: C.glow });
        else text(ctx, '→ None', a.x + 26, a.y + 5, { size: 12.5, color: C.dim, mono: true });
      }
    }
    if (kind === 'heap') order.forEach((id, i) => { if (i) { const a = items.get(order[(i - 1) >> 1]), b = items.get(id); ctx.strokeStyle = C.faint; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a.x, a.y + 15); ctx.lineTo(b.x, b.y - 15); ctx.stroke(); } });
    if (kind === 'hash') for (let r = 0; r < NB; r++) { const y = 34 + r * ((h - 40) / NB) + 10; text(ctx, `[${r}]`, 22, y + 5, { size: 13, color: C.brassHi, mono: true }); ctx.strokeStyle = C.faint; ctx.beginPath(); ctx.moveTo(48, y); ctx.lineTo(80, y); ctx.stroke(); buckets[r].forEach((id, j) => { if (j) { const a = items.get(buckets[r][j - 1]), b = items.get(id); arrow(ctx, a.x + 26, a.y, b.x - 28, b.y, { color: C.glow, head: 5 }); } }); }
    for (const b of items.values()) box(ctx, b, kind === 'hash' ? 54 : 46, 28);
    text(ctx, msg, 14, 20, { size: 13.5, color: C.ink, italic: true });
    return moving || queue.length > 0;
  };

  const opsFor = {
    stack: [['Push', 'push', true], ['Pop', 'pop']], queue: [['Enqueue', 'push', true], ['Dequeue', 'pop']],
    list: [['Insert at head', 'insertHead', true], ['Append', 'append'], ['Reverse', 'reverse']],
    hash: [['Add a key', 'hashAdd', true]], heap: [['Insert', 'heapPush', true], ['Pop min', 'heapPop']],
  };
  controls(host, [{ key: 'k', type: 'select', value: kind, options: [['stack', 'Stack'], ['queue', 'Queue'], ['list', 'Linked list'], ['hash', 'Hash table'], ['heap', 'Min-heap']], onChange: v => { kind = v; start(); } }]);
  const btnRow = document.createElement('div');
  btnRow.className = 'sim-controls';
  host.append(btnRow);
  caption(host, 'Tap the buttons: each operation animates, and the line at the top says what it cost.');
  const kick = loop(host, st, frame);
  function start() {
    items = new Map(); order = []; buckets = Array.from({ length: NB }, () => []); queue.length = 0; msg = '';
    btnRow.innerHTML = '';
    for (const [label, op, primary] of opsFor[kind]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = `sim-btn ${primary ? 'primary' : ''}`; b.textContent = label;
      b.onclick = () => { ops[op](); kick(); };
      btnRow.append(b);
    }
    // seed a few values
    const seed = { stack: () => [0, 1, 2].forEach(() => ops.push()), queue: () => [0, 1, 2].forEach(() => ops.push()), list: () => [0, 1, 2, 3].forEach(() => ops.append()), hash: () => [0, 1, 2, 3, 4].forEach(() => ops.hashAdd()), heap: () => { for (let i = 0; i < 6; i++) { ops.heapPush(); while (queue.length) { const [a, b] = queue.shift(); [order[a], order[b]] = [order[b], order[a]]; } layout(); } } };
    seed[kind]();
    msg = 'Ready';
    kick();
  }
  start();

  // ---------- recursion: the call stack as a timeline ----------
  function recursion() {
    const st2 = stage(host, { height: 270 });
    let fn = 'factorial', n = 4;
    const build = () => {
      const F = [], stack = [];
      const snap = (note, ret) => F.push({ stack: stack.map(f => ({ ...f })), note, ret });
      const fact = k => { stack.push({ call: `factorial(${k})`, local: `k = ${k}` }); snap(`Call factorial(${k})`); let r; if (k <= 1) { r = 1; snap('Base case: return 1', r); } else { const sub = fact(k - 1); r = k * sub; stack.at(-1).local = `k = ${k}, got ${sub}`; snap(`${k} × ${sub} = ${r}`, r); } stack.pop(); snap(`Return ${r}`, r); return r; };
      const sum = (xs) => { stack.push({ call: `total([${xs.join(', ')}])`, local: xs.length ? `first = ${xs[0]}` : 'empty' }); snap(`Call total of ${xs.length} items`); let r; if (!xs.length) { r = 0; snap('Base case: an empty list sums to 0', r); } else { const s = sum(xs.slice(1)); r = xs[0] + s; stack.at(-1).local = `${xs[0]} + ${s}`; snap(`${xs[0]} + ${s} = ${r}`, r); } stack.pop(); snap(`Return ${r}`, r); return r; };
      const fib = k => { stack.push({ call: `fib(${k})`, local: `k = ${k}` }); snap(`Call fib(${k})`); let r; if (k < 2) { r = k; snap(`Base case: fib(${k}) = ${k}`, r); } else { const a = fib(k - 1); stack.at(-1).local = `fib(${k - 1}) = ${a}`; const b = fib(k - 2); r = a + b; stack.at(-1).local = `${a} + ${b}`; snap(`fib(${k}) = ${a} + ${b} = ${r}`, r); } stack.pop(); snap(`Return ${r}`, r); return r; };
      if (fn === 'factorial') fact(n); else if (fn === 'sum') sum([3, 1, 4, 1, 5].slice(0, n)); else fib(Math.min(n, 5));
      return F;
    };
    const draw = (ctx, w, h, A, B, t) => {
      const F = t < 0.5 ? A : B;
      const rows = Math.max(A.stack.length, B.stack.length);
      for (let i = 0; i < rows; i++) {
        const inA = i < A.stack.length, inB = i < B.stack.length;
        const a = inA && inB ? 1 : inB ? t : inA ? 1 - t : 0;
        const f = (inB ? B : A).stack[i];
        const y = h - 34 - i * 36 - (1 - a) * 18;
        ctx.globalAlpha = a;
        roundRect(ctx, 20, y - 15, w - 40, 30, 4);
        ctx.fillStyle = i === rows - 1 ? 'rgba(63,182,201,.22)' : 'rgba(217,181,108,.12)'; ctx.fill();
        ctx.strokeStyle = i === rows - 1 ? C.glow : C.brass; ctx.lineWidth = 1.4; ctx.stroke();
        text(ctx, f.call, 32, y + 5, { size: 13.5, color: C.ink, mono: true });
        text(ctx, f.local, w - 32, y + 5, { size: 12.5, color: C.amber, align: 'right', mono: true });
        ctx.globalAlpha = 1;
      }
      text(ctx, 'call stack (newest on top)', 14, 22, { size: 14, color: C.brassHi, weight: 600 });
      if (F.ret !== undefined) text(ctx, `returns ${F.ret}`, w - 14, 22, { size: 13, color: C.green, align: 'right', mono: true });
    };
    controls(host, [
      { key: 'fn', type: 'select', value: fn, options: [['factorial', 'factorial(n)'], ['sum', 'total(list)'], ['fib', 'fib(n)']], onChange: v => { fn = v; tl.set(build()); } },
      { key: 'n', type: 'slider', label: 'n', min: 1, max: 6, value: n, onInput: v => { n = v; tl.set(build()); } },
    ]);
    const tl = timeline(host, st2, { frames: build(), draw, speed: 1.3 });
  }
}
