// Memory map for C++: variables as labelled boxes on the stack and the heap, pointers as
// arrows, references as second names on the same box, and a std::vector that doubles its
// capacity by moving every element to a bigger block.
export default function memory(host, { mode, kit }) {
  const { stage, plate, text, roundRect, arrow, loop, controls, caption, timeline, C, lerp, ease } = kit;
  let kind = ['pointers', 'heap', 'vector'].includes(mode) ? mode : 'pointers';
  const st = stage(host, { height: 330 });

  // ---------- programs for the timeline ----------
  const PROGRAMS = {
    pointers: {
      code: ['int a = 5;', 'int* p = &a;', '*p = 9;', 'int& r = a;', 'r = 12;', 'int b = *p + 1;', 'p = &b;'],
      steps: [
        { line: 0, boxes: [], note: 'main() starts with an empty stack frame' },
        { line: 1, boxes: [{ id: 'a', r: 's', slot: 0, name: 'a', val: '5', addr: '0x7ffc10' }], note: 'a gets a box on the stack, holding 5' },
        { line: 2, boxes: [{ id: 'a', r: 's', slot: 0, name: 'a', val: '5', addr: '0x7ffc10' }, { id: 'p', r: 's', slot: 1, name: 'p', val: '0x7ffc10', addr: '0x7ffc18' }], arrows: [['p', 'a']], note: 'p stores the address of a: it points at a' },
        { line: 3, boxes: [{ id: 'a', r: 's', slot: 0, name: 'a', val: '9', addr: '0x7ffc10', hot: 1 }, { id: 'p', r: 's', slot: 1, name: 'p', val: '0x7ffc10', addr: '0x7ffc18' }], arrows: [['p', 'a', 1]], note: '*p follows the arrow: writing through p changes a' },
        { line: 4, boxes: [{ id: 'a', r: 's', slot: 0, name: 'a  (also r)', val: '9', addr: '0x7ffc10' }, { id: 'p', r: 's', slot: 1, name: 'p', val: '0x7ffc10', addr: '0x7ffc18' }], arrows: [['p', 'a']], note: 'A reference is a second name for the same box: no new memory' },
        { line: 5, boxes: [{ id: 'a', r: 's', slot: 0, name: 'a  (also r)', val: '12', addr: '0x7ffc10', hot: 1 }, { id: 'p', r: 's', slot: 1, name: 'p', val: '0x7ffc10', addr: '0x7ffc18' }], arrows: [['p', 'a']], note: 'r = 12 writes straight into a' },
        { line: 6, boxes: [{ id: 'a', r: 's', slot: 0, name: 'a  (also r)', val: '12', addr: '0x7ffc10' }, { id: 'p', r: 's', slot: 1, name: 'p', val: '0x7ffc10', addr: '0x7ffc18' }, { id: 'b', r: 's', slot: 2, name: 'b', val: '13', addr: '0x7ffc20', hot: 1 }], arrows: [['p', 'a', 1]], note: '*p reads a (12), so b = 13' },
        { line: 7, boxes: [{ id: 'a', r: 's', slot: 0, name: 'a  (also r)', val: '12', addr: '0x7ffc10' }, { id: 'p', r: 's', slot: 1, name: 'p', val: '0x7ffc20', addr: '0x7ffc18', hot: 1 }, { id: 'b', r: 's', slot: 2, name: 'b', val: '13', addr: '0x7ffc20' }], arrows: [['p', 'b', 1]], note: 'A pointer can be re-aimed; a reference never can' },
      ],
    },
    heap: {
      code: ['int* p = new int(7);', 'int* q = p;', '*q = 8;', 'delete p;', 'p = nullptr;', '{ auto u = std::make_unique<int>(3);', '} // u goes out of scope'],
      steps: [
        { line: 0, boxes: [], note: 'Stack on the left, heap on the right' },
        { line: 1, boxes: [{ id: 'h1', r: 'h', slot: 0, name: 'int', val: '7', addr: '0x55a0' }, { id: 'p', r: 's', slot: 0, name: 'p', val: '0x55a0' }], arrows: [['p', 'h1']], note: 'new makes a box on the heap; p on the stack points at it' },
        { line: 2, boxes: [{ id: 'h1', r: 'h', slot: 0, name: 'int', val: '7', addr: '0x55a0' }, { id: 'p', r: 's', slot: 0, name: 'p', val: '0x55a0' }, { id: 'q', r: 's', slot: 1, name: 'q', val: '0x55a0' }], arrows: [['p', 'h1'], ['q', 'h1']], note: 'Copying a pointer copies the address: two arrows, one box' },
        { line: 3, boxes: [{ id: 'h1', r: 'h', slot: 0, name: 'int', val: '8', addr: '0x55a0', hot: 1 }, { id: 'p', r: 's', slot: 0, name: 'p', val: '0x55a0' }, { id: 'q', r: 's', slot: 1, name: 'q', val: '0x55a0' }], arrows: [['p', 'h1'], ['q', 'h1', 1]], note: 'Writing through q changes what p sees too' },
        { line: 4, boxes: [{ id: 'h1', r: 'h', slot: 0, name: 'freed', val: '?', addr: '0x55a0', dead: 1 }, { id: 'p', r: 's', slot: 0, name: 'p', val: '0x55a0' }, { id: 'q', r: 's', slot: 1, name: 'q', val: '0x55a0' }], arrows: [['p', 'h1', 2], ['q', 'h1', 2]], note: 'delete frees the box, but both pointers still hold its address: dangling' },
        { line: 5, boxes: [{ id: 'h1', r: 'h', slot: 0, name: 'freed', val: '?', addr: '0x55a0', dead: 1 }, { id: 'p', r: 's', slot: 0, name: 'p', val: 'nullptr', hot: 1 }, { id: 'q', r: 's', slot: 1, name: 'q', val: '0x55a0' }], arrows: [['q', 'h1', 2]], note: 'p is safe now; q still dangles. Using *q is undefined behaviour' },
        { line: 6, boxes: [{ id: 'p', r: 's', slot: 0, name: 'p', val: 'nullptr' }, { id: 'q', r: 's', slot: 1, name: 'q', val: '0x55a0' }, { id: 'u', r: 's', slot: 2, name: 'u (unique_ptr)', val: '0x55c8' }, { id: 'h2', r: 'h', slot: 1, name: 'int', val: '3', addr: '0x55c8' }], arrows: [['u', 'h2']], note: 'A unique_ptr owns its heap box' },
        { line: 7, boxes: [{ id: 'p', r: 's', slot: 0, name: 'p', val: 'nullptr' }, { id: 'q', r: 's', slot: 1, name: 'q', val: '0x55a0' }], arrows: [], note: 'When u leaves its scope it deletes the box itself: RAII, no leak, no delete to forget' },
      ],
    },
  };

  const CODE_LH = 15;
  const layout = (w, h, code) => {
    const top = 16 + code.length * CODE_LH + 22;
    return { top, colW: (w - 36) / 2, sx: 12, hx: 24 + (w - 36) / 2, bh: 40 };
  };
  const xy = (L, b) => ({ x: b.r === 's' ? L.sx : L.hx, y: L.top + 20 + b.slot * (L.bh + 10) });

  function drawRegions(ctx, w, h, L) {
    for (const [x, label] of [[L.sx, 'stack'], [L.hx, 'heap']]) {
      ctx.strokeStyle = 'rgba(255,181,71,.3)'; ctx.setLineDash([4, 4]); roundRect(ctx, x - 4, L.top, L.colW + 8, h - L.top - 10, 6); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, label, x + 2, L.top + 14, { size: 12, color: C.brass, italic: true });
    }
  }
  function drawBox(ctx, L, b, x, y, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = b.dead ? 'rgba(239,122,109,.12)' : b.hot ? 'rgba(127,178,217,.2)' : 'rgba(233,237,241,.07)';
    roundRect(ctx, x, y, L.colW, L.bh, 4); ctx.fill();
    ctx.strokeStyle = b.dead ? C.red : b.hot ? C.glow : C.brass; ctx.lineWidth = 1.4;
    if (b.dead) ctx.setLineDash([3, 3]);
    ctx.stroke(); ctx.setLineDash([]);
    text(ctx, b.name, x + 6, y + 14, { size: 11, color: C.dim, italic: true });
    text(ctx, b.val, x + 6, y + 32, { size: 13, color: b.dead ? C.red : C.ink, mono: true, weight: 600 });
    if (b.addr) text(ctx, b.addr, x + L.colW - 6, y + 14, { size: 9.5, color: C.faint, align: 'right', mono: true });
    ctx.globalAlpha = 1;
  }

  function drawProgram(ctx, w, h, A, B, t, prog) {
    const L = layout(w, h, prog.code);
    // code with sliding bar
    const ln = lerp(A.line, B.line, t);
    if (ln > 0) { ctx.fillStyle = 'rgba(255,181,71,.18)'; roundRect(ctx, 8, 16 + (ln - 1) * CODE_LH - 2, w - 16, CODE_LH, 3); ctx.fill(); ctx.fillStyle = C.amber; ctx.fillRect(8, 16 + (ln - 1) * CODE_LH - 2, 3, CODE_LH); }
    prog.code.forEach((c, i) => text(ctx, c, 18, 16 + i * CODE_LH + 9, { size: 11.5, color: Math.round(ln) === i + 1 ? C.brassHi : C.ink, mono: true }));
    drawRegions(ctx, w, h, L);
    const S = t < 0.5 ? A : B;
    const ids = [...new Set([...A.boxes.map(b => b.id), ...B.boxes.map(b => b.id)])];
    const at = {};
    for (const id of ids) {
      const a = A.boxes.find(b => b.id === id), b = B.boxes.find(x => x.id === id);
      const pa = a && xy(L, a), pb = b && xy(L, b);
      const x = pa && pb ? lerp(pa.x, pb.x, t) : (pa || pb).x, y = pa && pb ? lerp(pa.y, pb.y, t) : (pa || pb).y + (a ? 0 : (1 - t) * 14);
      const alpha = a && b ? 1 : a ? 1 - t : t;
      const box = t < 0.5 ? a || b : b || a;
      // a value change flips like a split-flap: squash at the midpoint
      drawBox(ctx, L, box, x, y, alpha);
      at[id] = { x, y, alpha };
    }
    for (const [from, to, style] of S.arrows || []) {
      const p = at[from], q = at[to];
      if (!p || !q) continue;
      const fromSide = xy(L, { r: S.boxes.find(b => b.id === from).r, slot: 0 }).x === L.sx;
      const x1 = p.x + (fromSide ? L.colW : 0) - 8, y1 = p.y + L.bh / 2;
      const toLeft = q.x > p.x;
      const x2 = toLeft ? q.x - 2 : q.x + L.colW + 2, y2 = q.y + L.bh / 2;
      const col = style === 2 ? C.red : style === 1 ? C.glow : C.brass;
      ctx.globalAlpha = Math.min(p.alpha, q.alpha) * (t < 0.5 ? (A.arrows || []).some(r => r[0] === from && r[1] === to) ? 1 : 1 - (0.5 - t) * 2 : 1);
      if (q.x === p.x) {
        // same column: loop out to the right
        ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x1, y1);
        const ox = p.x + L.colW + 14;
        ctx.bezierCurveTo(ox, y1, ox, y2, p.x + L.colW + 2, y2); ctx.stroke();
        arrow(ctx, p.x + L.colW + 8, y2, p.x + L.colW + 1, y2, { color: col });
      } else arrow(ctx, x1, y1, x2, y2, { color: col, width: 1.8, dash: style === 2 ? [4, 3] : null });
      ctx.globalAlpha = 1;
    }
  }

  // ---------- vector: interactive ----------
  const V = { items: [], cap: 1, moving: null, anim: 0, nextVal: 10 };
  function push() {
    if (V.moving) return;
    if (V.items.length === V.cap) { V.moving = { from: V.cap, to: V.cap * 2, t: 0, pending: V.nextVal }; V.nextVal += 10; }
    else { V.items.push({ v: V.nextVal, born: 0 }); V.nextVal += 10; }
    kick();
  }
  function pop() { if (!V.moving && V.items.length) { V.items.pop(); kick(); } }
  function drawVector(ctx, w, h) {
    const cell = Math.min(34, (w - 30) / Math.max(8, (V.moving ? V.moving.to : V.cap)));
    const row = (cap, y, alpha, label) => {
      ctx.globalAlpha = alpha;
      text(ctx, label, 14, y - 8, { size: 11.5, color: C.dim, italic: true });
      for (let i = 0; i < cap; i++) { ctx.strokeStyle = C.brass; ctx.lineWidth = 1.2; roundRect(ctx, 14 + i * cell, y, cell - 4, cell - 4, 3); ctx.stroke(); }
      ctx.globalAlpha = 1;
    };
    text(ctx, `std::vector<int> v;   size ${V.items.length}   capacity ${V.cap}`, 14, 22, { size: 12.5, color: C.ink, mono: true });
    text(ctx, 'heap block', 14, 46, { size: 11.5, color: C.brass, italic: true });
    const y0 = 70, y1 = 160;
    const m = V.moving;
    if (m) {
      const k = ease(Math.min(1, m.t));
      row(m.from, y0, 1 - Math.max(0, (m.t - 1)) , `old block (${m.from})`);
      row(m.to, y1, Math.min(1, m.t * 3), `new block (${m.to}): every element is copied over`);
      V.items.forEach((it, i) => {
        const sk = Math.max(0, Math.min(1, k * 1.6 - i * 0.12));
        const x = 14 + i * cell, y = lerp(y0, y1, ease(sk));
        drawCell(ctx, x, y, cell, it.v, sk > 0 && sk < 1);
      });
    } else {
      row(V.cap, y0, 1, '');
      V.items.forEach((it, i) => drawCell(ctx, 14 + i * cell, y0 - (1 - ease(Math.min(1, it.born))) * 30, cell, it.v, it.born < 1));
    }
    text(ctx, 'full? it moves to a block twice as big', 14, h - 40, { size: 12, color: C.dim, italic: true });
    text(ctx, `copies so far: ${V.copies || 0}  (≈ 1 per element on average)`, 14, h - 20, { size: 12, color: C.amber, mono: true });
  }
  function drawCell(ctx, x, y, cell, v, hot) {
    ctx.fillStyle = hot ? 'rgba(127,178,217,.35)' : 'rgba(255,181,71,.3)';
    roundRect(ctx, x, y, cell - 4, cell - 4, 3); ctx.fill();
    text(ctx, String(v), x + (cell - 4) / 2, y + cell / 2 + 2, { size: Math.min(12, cell * 0.36), color: C.ink, align: 'center', mono: true });
  }

  // ---------- wiring ----------
  const wrap = document.createElement('div'); host.append(wrap);
  const tlHost = document.createElement('div'); host.append(tlHost);
  const note = caption(host, '');
  // One timeline for both programs; in vector mode it just paints the vector.
  const draw = (ctx, w, h, A, B, t) => (kind === 'vector' ? drawVector(ctx, w, h) : drawProgram(ctx, w, h, A, B, t, PROGRAMS[kind]));
  let tl = null, kick = () => {};
  function build() {
    wrap.innerHTML = '';
    const sel = { key: 'kind', type: 'select', value: kind, options: [['pointers', 'Pointers and references'], ['heap', 'Heap, delete and smart pointers'], ['vector', 'Vector growth']], onChange: v => { kind = v; build(); } };
    if (kind === 'vector') {
      controls(wrap, [sel, { key: 'push', label: 'push_back', primary: true, onClick: push }, { key: 'pop', label: 'pop_back', onClick: pop }, { key: 'clr', label: 'Clear', onClick: () => { V.items = []; V.cap = 1; V.copies = 0; V.nextVal = 10; kick(); } }]);
      note.innerHTML = 'Tap push_back again and again: most pushes are instant, a few move everything. That is why push_back is fast on average.';
      tlHost.hidden = true;
      tl?.set([{}], false);
      kick();
    } else {
      controls(wrap, [sel]);
      note.innerHTML = kind === 'pointers' ? 'Boxes are variables, arrows are pointers. Step through and watch which box each line changes.' : 'new puts a box on the heap that lives until delete. Smart pointers delete for you.';
      tlHost.hidden = false;
      if (!tl) tl = timeline(tlHost, st, { frames: PROGRAMS[kind].steps, draw, speed: 0.9 });
      else tl.set(PROGRAMS[kind].steps);
    }
  }
  kick = loop(host, st, dt => {
    if (kind !== 'vector') return false;
    let busy = false;
    if (V.moving) {
      V.moving.t += dt * 0.8; busy = true;
      if (V.moving.t >= 1.3) { V.copies = (V.copies || 0) + V.items.length; V.cap = V.moving.to; V.items.push({ v: V.moving.pending, born: 0 }); V.moving = null; }
    }
    V.items.forEach(it => { if (it.born < 1) { it.born = Math.min(1, it.born + dt * 3); busy = true; } });
    plate(st.ctx, st.w, st.h); drawVector(st.ctx, st.w, st.h);
    return busy;
  });
  if (kind === 'vector') { tl = timeline(tlHost, st, { frames: [{}], draw, autoplay: false }); }
  build();
}
