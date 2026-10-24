// Slope machine: shrink a secant into a tangent, sweep a tangent along a curve while the
// derivative draws itself underneath, and roll gradient descent down a loss curve, a bowl,
// or a line being fitted to points.
export default function calculus(host, { mode, kit }) {
  const { stage, plate, text, arrow, loop, controls, caption, C, clamp, fmt } = kit;
  const st = stage(host, { height: 300 });
  let kind = ['secant', 'tangent', 'descent'].includes(mode) ? mode : 'tangent';
  const FN = {
    sq: { f: x => x * x, d: x => 2 * x, label: 'f(x) = x²', xr: [-3, 3] },
    cubic: { f: x => x * x * x - 3 * x, d: x => 3 * x * x - 3, label: 'f(x) = x³ − 3x', xr: [-2.6, 2.6] },
    sin: { f: Math.sin, d: Math.cos, label: 'f(x) = sin x', xr: [-6.3, 6.3] },
    exp: { f: Math.exp, d: Math.exp, label: 'f(x) = eˣ  (its own slope)', xr: [-3, 2] },
    chain: { f: x => Math.sin(x * x), d: x => 2 * x * Math.cos(x * x), label: 'f(x) = sin(x²): chain rule 2x·cos(x²)', xr: [-2.5, 2.5] },
  };
  let fk = mode === 'tangent' ? 'chain' : 'cubic';
  const s = { x: 0.8, h: 1.5, th: 1.5, sweep: false, trail: [], lr: 0.1, sub: 'curve', gd: null, gdT: 0 };
  const fn = () => FN[fk];
  // plotting box
  const box = () => { const top = 34, bottom = st.h - (kind === 'tangent' ? 96 : 24); return { l: 20, r: st.w - 16, t: top, b: bottom }; };
  const yr = () => { const { f, xr } = fn(); let lo = Infinity, hi = -Infinity; for (let i = 0; i <= 80; i++) { const y = f(xr[0] + ((xr[1] - xr[0]) * i) / 80); lo = Math.min(lo, y); hi = Math.max(hi, y); } const p = (hi - lo) * 0.12 || 1; return [lo - p, hi + p]; };
  const X = x => { const b = box(), [a, c] = fn().xr; return b.l + ((x - a) / (c - a)) * (b.r - b.l); };
  const Y = (y, r = yr()) => { const b = box(); return b.b - ((y - r[0]) / (r[1] - r[0])) * (b.b - b.t); };
  const Xinv = px => { const b = box(), [a, c] = fn().xr; return a + ((px - b.l) / (b.r - b.l)) * (c - a); };
  const curve = (g, color, width = 2.2, r) => { const { ctx } = st; const [a, c] = fn().xr; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); for (let i = 0; i <= 160; i++) { const x = a + ((c - a) * i) / 160; const y = g(x); i ? ctx.lineTo(X(x), Y(y, r)) : ctx.moveTo(X(x), Y(y, r)); } ctx.stroke(); };
  const line = (x0, y0, m, color, w = 2) => { const { ctx } = st; const [a, c] = fn().xr; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(X(a), Y(y0 + m * (a - x0))); ctx.lineTo(X(c), Y(y0 + m * (c - x0))); ctx.stroke(); };
  const dot = (x, y, color, r = 6) => { const { ctx } = st; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; };
  const axes = () => { const { ctx } = st; const b = box(); ctx.strokeStyle = 'rgba(216,246,251,.3)'; ctx.lineWidth = 1; ctx.beginPath(); const y0 = Y(0), x0 = X(0); if (y0 > b.t && y0 < b.b) { ctx.moveTo(b.l, y0); ctx.lineTo(b.r, y0); } if (x0 > b.l && x0 < b.r) { ctx.moveTo(x0, b.t); ctx.lineTo(x0, b.b); } ctx.stroke(); };

  // ---------- gradient descent ----------
  const loss1 = x => 0.25 * (x - 1.2) ** 2 * (1 + 0.4 * Math.sin(2.4 * x)) + 0.4;
  const pts = Array.from({ length: 12 }, (_, i) => { const x = i / 11 * 4 - 2; return [x, 0.8 * x + 0.5 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.6]; });
  const startGD = () => {
    if (s.sub === 'curve') s.gd = { x: -2.4, path: [-2.4] };
    if (s.sub === 'bowl') s.gd = { p: [-2.2, 1.8], path: [[-2.2, 1.8]] };
    if (s.sub === 'fit') s.gd = { m: -0.5, b: 2, losses: [] };
    s.gdT = 0;
  };
  const stepGD = () => {
    const g = s.gd;
    if (s.sub === 'curve') { const d = (loss1(g.x + 1e-4) - loss1(g.x - 1e-4)) / 2e-4; g.x -= s.lr * 10 * d; g.x = clamp(g.x, -3, 3); g.path.push(g.x); }
    if (s.sub === 'bowl') { const [x, y] = g.p; g.p = [x - s.lr * 2 * x * 1, y - s.lr * 2 * 4 * y * 0.5]; g.path.push(g.p); }
    if (s.sub === 'fit') { let dm = 0, db = 0, L = 0; for (const [x, y] of pts) { const e = g.m * x + g.b - y; dm += 2 * e * x; db += 2 * e; L += e * e; } g.m -= (s.lr * dm) / pts.length; g.b -= (s.lr * db) / pts.length; g.losses.push(L / pts.length); }
  };
  const drawDescent = () => {
    const { ctx, w, h } = st;
    const g = s.gd;
    if (s.sub === 'curve') {
      const save = fk; FN.loss = { f: loss1, d: x => (loss1(x + 1e-4) - loss1(x - 1e-4)) / 2e-4, label: 'loss', xr: [-3, 3] }; fk = 'loss';
      axes(); curve(loss1, C.brass, 2.4);
      g.path.forEach((x, i) => { if (i) arrow(ctx, X(g.path[i - 1]), Y(loss1(g.path[i - 1])), X(x), Y(loss1(x)), { color: 'rgba(127,230,247,.5)', width: 1.2, head: 5 }); });
      dot(X(g.x), Y(loss1(g.x)), C.glow, 8);
      const d = FN.loss.d(g.x);
      line(g.x, loss1(g.x), d, 'rgba(231,176,75,.6)', 1.4);
      text(ctx, `step ${g.path.length - 1}   x = ${fmt(g.x)}`, 14, 22, { size: 12.5, color: C.ink, mono: true });
      text(ctx, `slope = ${fmt(d)}   loss = ${fmt(loss1(g.x))}`, 14, 40, { size: 12.5, color: C.amber, mono: true });
      fk = save;
    } else if (s.sub === 'bowl') {
      const cx = w / 2, cy = h / 2 + 6, k = Math.min(w, h) / 6.4;
      for (let r = 8; r >= 1; r--) { ctx.strokeStyle = `rgba(217,181,108,${0.08 + (8 - r) * 0.04})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(cx, cy, Math.sqrt(r) * k * 0.9, Math.sqrt(r / 2) * k * 0.9, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.strokeStyle = C.glow; ctx.lineWidth = 2; ctx.beginPath(); g.path.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x * k, cy - y * k) : ctx.moveTo(cx + x * k, cy - y * k))); ctx.stroke();
      dot(cx + g.p[0] * k, cy - g.p[1] * k, C.glow, 7);
      text(ctx, `loss = x² + 2y²   step ${g.path.length - 1}`, 14, 22, { size: 12.5, color: C.ink, mono: true });
      text(ctx, `at (${fmt(g.p[0])}, ${fmt(g.p[1])})`, 14, 40, { size: 12.5, color: C.amber, mono: true });
      if (s.lr > 0.5) text(ctx, 'Learning rate too big: it overshoots and zig-zags', 14, h - 12, { size: 13, color: C.red, italic: true });
    } else {
      const L = 30, R = w - 140, T = 40, B = h - 24, sx = x => L + ((x + 2.4) / 4.8) * (R - L), sy = y => B - ((y + 1.6) / 5) * (B - T);
      ctx.strokeStyle = 'rgba(216,246,251,.2)'; ctx.strokeRect(L, T, R - L, B - T);
      pts.forEach(([x, y]) => { const e = g.m * x + g.b - y; ctx.strokeStyle = 'rgba(236,106,94,.5)'; ctx.beginPath(); ctx.moveTo(sx(x), sy(y)); ctx.lineTo(sx(x), sy(y + e)); ctx.stroke(); dot(sx(x), sy(y), C.amber, 4); });
      ctx.strokeStyle = C.glow; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(sx(-2.4), sy(g.m * -2.4 + g.b)); ctx.lineTo(sx(2.4), sy(g.m * 2.4 + g.b)); ctx.stroke();
      // loss chart
      const lx = R + 16, lw = w - lx - 12, lh = 70, ly = T + 20;
      ctx.strokeStyle = 'rgba(216,246,251,.2)'; ctx.strokeRect(lx, ly, lw, lh);
      const ls = g.losses, mx = Math.max(...ls, 1e-9);
      ctx.strokeStyle = C.green; ctx.lineWidth = 1.6; ctx.beginPath(); ls.forEach((v, i) => { const x = lx + (i / Math.max(1, ls.length - 1)) * lw, y = ly + lh - (v / mx) * lh; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      text(ctx, 'loss', lx, ly - 6, { size: 12, color: C.green });
      text(ctx, `y = ${fmt(g.m)}x + ${fmt(g.b)}`, 14, 22, { size: 13, color: C.ink, mono: true });
      if (ls.length) text(ctx, `${fmt(ls.at(-1))}`, lx, ly + lh + 16, { size: 12, color: C.green, mono: true });
    }
  };

  const frame = dt => {
    const { ctx, w, h } = st;
    plate(ctx, w, h);
    if (kind === 'descent') {
      if (s.running) { s.gdT += dt; if (s.gdT > 0.28) { s.gdT = 0; stepGD(); if ((s.sub === 'fit' ? s.gd.losses.length : s.gd.path.length) > 60) s.running = false; } }
      drawDescent();
      return s.running;
    }
    const { f, d, label } = fn();
    axes();
    curve(f, C.brass, 2.4);
    if (kind === 'secant') {
      s.h += (s.th - s.h) * (1 - Math.exp(-dt * 3));
      const h2 = Math.max(1e-3, s.h), x1 = s.x + h2, m = (f(x1) - f(s.x)) / h2;
      line(s.x, f(s.x), m, C.amber, 2);
      dot(X(s.x), Y(f(s.x)), C.glow); dot(X(x1), Y(f(x1)), C.amber, 5);
      text(ctx, `h = ${fmt(h2)}   secant slope = ${fmt(m)}`, 14, 22, { size: 12.5, color: C.ink, mono: true });
      text(ctx, `true slope f′(x) = ${fmt(d(s.x))}`, 14, 40, { size: 12.5, color: C.green, mono: true });
      return Math.abs(s.th - s.h) > 1e-4;
    }
    // tangent with the derivative traced below
    if (s.sweep) { s.x += dt * 0.8 * (fn().xr[1] - fn().xr[0]) / 6; if (s.x > fn().xr[1]) { s.x = fn().xr[1]; s.sweep = false; } s.trail.push(s.x); }
    const m = d(s.x);
    line(s.x, f(s.x), m, C.glow, 2);
    dot(X(s.x), Y(f(s.x)), C.glow);
    // derivative strip
    const b = box(), top = b.b + 18, bot = h - 16;
    let lo = Infinity, hi = -Infinity; const [a, c] = fn().xr;
    for (let i = 0; i <= 80; i++) { const v = d(a + ((c - a) * i) / 80); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const DY = v => bot - ((v - lo) / (hi - lo || 1)) * (bot - top);
    ctx.strokeStyle = 'rgba(216,246,251,.15)'; ctx.strokeRect(b.l, top, b.r - b.l, bot - top);
    if (lo < 0 && hi > 0) { ctx.beginPath(); ctx.moveTo(b.l, DY(0)); ctx.lineTo(b.r, DY(0)); ctx.stroke(); }
    ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.beginPath();
    s.trail.forEach((x, i) => (i ? ctx.lineTo(X(x), DY(d(x))) : ctx.moveTo(X(x), DY(d(x))))); ctx.stroke();
    dot(X(s.x), DY(m), C.green, 4);
    text(ctx, "f′(x)", b.l + 4, top + 14, { size: 12.5, color: C.green, italic: true });
    text(ctx, label, 14, 22, { size: 12.5, color: C.ink, mono: true });
    text(ctx, `x = ${fmt(s.x)}   slope = ${fmt(m)}`, 14, 40, { size: 12.5, color: C.amber, mono: true });
    return s.sweep;
  };

  let dragging = false;
  st.pointer({
    down: p => { if (kind !== 'descent') { dragging = true; s.x = clamp(Xinv(p.x), fn().xr[0], fn().xr[1]); s.sweep = false; s.trail.push(s.x); kick(); } },
    move: (p, down) => { if (down && dragging) { s.x = clamp(Xinv(p.x), fn().xr[0], fn().xr[1]); s.trail.push(s.x); kick(); } },
    up: () => { dragging = false; },
  });
  const wrap = document.createElement('div');
  host.append(wrap);
  const cap = caption(host, '');
  const kick = loop(host, st, frame);
  function refresh() {
    wrap.innerHTML = '';
    const list = [{ key: 'k', type: 'select', value: kind, options: [['secant', 'Secant → tangent'], ['tangent', 'Tangent and derivative'], ['descent', 'Gradient descent']], onChange: v => { kind = v; refresh(); } }];
    if (kind !== 'descent') list.push({ key: 'f', type: 'select', value: fk, options: Object.entries(FN).filter(([k]) => k !== 'loss').map(([k, v]) => [k, v.label.split(':')[0]]), onChange: v => { fk = v; s.x = 0.8; s.trail = []; kick(); } });
    if (kind === 'secant') list.push({ key: 'h', type: 'slider', label: 'h', min: 0.01, max: 2, step: 0.01, value: s.th, onInput: v => { s.th = v; kick(); } }, { key: 'shrink', label: 'Shrink h', primary: true, onClick: () => { s.th = 0.001; kick(); } });
    if (kind === 'tangent') list.push({ key: 'sw', label: 'Sweep', primary: true, onClick: () => { s.x = fn().xr[0]; s.trail = []; s.sweep = true; kick(); } });
    if (kind === 'descent') list.push(
      { key: 'sub', type: 'select', value: s.sub, options: [['curve', 'Down a loss curve'], ['bowl', 'Down a bowl (2D)'], ['fit', 'Fit a line']], onChange: v => { s.sub = v; startGD(); s.running = true; kick(); } },
      { key: 'lr', type: 'slider', label: 'learning rate', min: 0.01, max: 0.9, step: 0.01, value: s.lr, onInput: v => { s.lr = v; } },
      { key: 'go', label: 'Run', primary: true, onClick: () => { startGD(); s.running = true; kick(); } },
      { key: 'st', label: 'One step', onClick: () => { s.running = false; stepGD(); kick(); } },
    );
    controls(wrap, list);
    cap.textContent = { secant: 'Drag the point, then tap Shrink h: the secant swings into the tangent and its slope becomes the derivative.', tangent: 'Drag along the curve or tap Sweep: the green line below is the slope at every point, the derivative.', descent: 'Each step moves against the slope, by learning rate × slope. Try a big learning rate in the bowl.' }[kind];
    if (kind === 'descent') { startGD(); s.running = true; }
    s.trail = [];
    kick();
  }
  refresh();
}
