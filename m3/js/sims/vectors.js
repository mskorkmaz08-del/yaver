// Vector loom: drag vectors and basis arrows and watch the whole plane respond: linear
// combinations and span, matrices bending the grid, determinant as area, eigenvectors that keep
// their direction, dot products as projection, change of basis, and a 3D rotation you can orbit.
export default function vectors(host, { mode, kit }) {
  const { stage, plate, text, arrow, loop, controls, caption, C, clamp, lerp, ease, fmt } = kit;
  const st = stage(host, { height: 300 });
  let kind = ['span', 'transform', 'det', 'eigen', 'dot', 'basis', '3d'].includes(mode) ? mode : 'transform';
  const v = { a: [2, 1], b: [-1, 2], i: [1, 0.5], j: [-0.5, 1], x: [1.5, 1], p: [2, 1.5] };
  const s = { ca: 1, cb: 1, t: 1, tt: 1, rx: -0.5, ry: 0.6, rz: 0, cross: false };
  const S = () => clamp(Math.min(st.w, st.h) / 9, 24, 48); // pixels per unit
  const O = () => [st.w / 2, st.h / 2 + 8];
  const toPx = ([x, y]) => { const [ox, oy] = O(), k = S(); return [ox + x * k, oy - y * k]; };
  const toU = (px, py) => { const [ox, oy] = O(), k = S(); return [Math.round(((px - ox) / k) * 4) / 4, Math.round(((oy - py) / k) * 4) / 4]; };
  const M = () => { const t = ease(s.t); return [lerp(1, v.i[0], t), lerp(0, v.i[1], t), lerp(0, v.j[0], t), lerp(1, v.j[1], t)]; }; // [a b c d]: i=(a,b), j=(c,d)
  const apply = (m, [x, y]) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
  const vec = (from, to, color, label, width = 2.4) => { const [x1, y1] = toPx(from), [x2, y2] = toPx(to); arrow(st.ctx, x1, y1, x2, y2, { color, width, head: 9 }); if (label) text(st.ctx, label, x2 + 6, y2 - 6, { size: 15, color, weight: 600, italic: true }); };
  const grid = (m, color = 'rgba(127,178,217,.22)', range = 8) => {
    const { ctx } = st;
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -range; k <= range; k++) {
      let [x1, y1] = toPx(apply(m, [k, -range])), [x2, y2] = toPx(apply(m, [k, range])); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      [x1, y1] = toPx(apply(m, [-range, k])); [x2, y2] = toPx(apply(m, [range, k])); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  };
  const axes = () => { const { ctx, w, h } = st; const [ox, oy] = O(); ctx.strokeStyle = 'rgba(233,237,241,.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.moveTo(ox, 0); ctx.lineTo(ox, h); ctx.stroke(); };
  const handles = {
    span: ['a', 'b'], transform: ['i', 'j', 'x'], det: ['i', 'j'], eigen: ['i', 'j'], dot: ['a', 'b'], basis: ['i', 'j', 'p'], '3d': [],
  };

  const frame = dt => {
    const { ctx, w, h } = st;
    plate(ctx, w, h);
    s.t += (s.tt - s.t) * (1 - Math.exp(-dt * 4));
    const moving = Math.abs(s.tt - s.t) > 0.002;
    if (kind === '3d') return draw3d(dt) || moving;
    if (kind === 'span') {
      grid([1, 0, 0, 1], 'rgba(127,178,217,.1)'); axes();
      const ra = [v.a[0] * s.ca, v.a[1] * s.ca], r = [ra[0] + v.b[0] * s.cb, ra[1] + v.b[1] * s.cb];
      const det = v.a[0] * v.b[1] - v.a[1] * v.b[0];
      if (Math.abs(det) < 1e-6) { const [x1, y1] = toPx([-v.a[0] * 9, -v.a[1] * 9]), [x2, y2] = toPx([v.a[0] * 9, v.a[1] * 9]); ctx.strokeStyle = C.amber; ctx.lineWidth = 6; ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1; }
      vec([0, 0], ra, 'rgba(255,181,71,.7)', '', 2); vec(ra, r, 'rgba(169,155,240,.8)', '', 2);
      vec([0, 0], v.a, C.amber, 'a'); vec([0, 0], v.b, C.violet, 'b'); vec([0, 0], r, C.glow, '', 3);
      text(ctx, `${fmt(s.ca)}·a + ${fmt(s.cb)}·b = (${fmt(r[0])}, ${fmt(r[1])})`, 14, 22, { size: 14, color: C.ink, mono: true });
      text(ctx, Math.abs(det) < 1e-6 ? 'a and b line up: their span is only a line' : 'a and b point different ways: they span the whole plane', 14, h - 12, { size: 13, color: Math.abs(det) < 1e-6 ? C.amber : C.dim, italic: true });
    } else if (kind === 'dot') {
      grid([1, 0, 0, 1], 'rgba(127,178,217,.1)'); axes();
      const d = v.a[0] * v.b[0] + v.a[1] * v.b[1], la = Math.hypot(...v.a) || 1, lb = Math.hypot(...v.b) || 1;
      const proj = [(d / (la * la)) * v.a[0], (d / (la * la)) * v.a[1]];
      const [px1, py1] = toPx(v.b), [px2, py2] = toPx(proj);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = C.dim; ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke(); ctx.setLineDash([]);
      vec([0, 0], proj, d >= 0 ? C.green : C.red, '', 5);
      vec([0, 0], v.a, C.amber, 'a'); vec([0, 0], v.b, C.violet, 'b');
      text(ctx, `a·b = ${fmt(d)}   cos θ = ${fmt(d / (la * lb))}   θ = ${Math.round((Math.acos(clamp(d / (la * lb), -1, 1)) * 180) / Math.PI)}°`, 14, 22, { size: 13.5, color: C.ink, mono: true });
      text(ctx, d > 0 ? 'Positive: they point the same general way' : d < 0 ? 'Negative: they point apart' : 'Zero: perpendicular', 14, h - 12, { size: 13, color: C.dim, italic: true });
    } else if (kind === 'basis') {
      grid([1, 0, 0, 1], 'rgba(233,237,241,.08)'); grid([v.i[0], v.i[1], v.j[0], v.j[1]], 'rgba(255,181,71,.3)'); axes();
      const det = v.i[0] * v.j[1] - v.i[1] * v.j[0];
      const c = Math.abs(det) > 1e-6 ? [(v.p[0] * v.j[1] - v.p[1] * v.j[0]) / det, (v.i[0] * v.p[1] - v.i[1] * v.p[0]) / det] : [NaN, NaN];
      vec([0, 0], v.i, C.amber, 'b₁'); vec([0, 0], v.j, C.violet, 'b₂');
      const [px, py] = toPx(v.p); ctx.fillStyle = C.glow; ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
      text(ctx, `standard (${fmt(v.p[0])}, ${fmt(v.p[1])})`, 14, 22, { size: 13.5, color: C.ink, mono: true });
      text(ctx, `in b₁,b₂: (${isNaN(c[0]) ? '—' : fmt(c[0])}, ${isNaN(c[1]) ? '—' : fmt(c[1])})`, 14, 42, { size: 13.5, color: C.amber, mono: true });
    } else {
      const m = M();
      grid([1, 0, 0, 1], 'rgba(233,237,241,.06)');
      grid(m);
      axes();
      const det = m[0] * m[3] - m[1] * m[2];
      if (kind === 'det' || kind === 'transform') {
        const pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(p => toPx(apply(m, p)));
        ctx.fillStyle = det >= 0 ? 'rgba(125,211,168,.22)' : 'rgba(239,122,109,.25)'; ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
      }
      if (kind === 'eigen') {
        // eigenvectors of the full matrix: directions that only stretch
        const [a, b, c, d] = [v.i[0], v.i[1], v.j[0], v.j[1]];
        const tr = a + d, dt2 = a * d - b * c, disc = tr * tr / 4 - dt2;
        if (disc >= 0) {
          for (const lam of [tr / 2 + Math.sqrt(disc), tr / 2 - Math.sqrt(disc)]) {
            // (A − λI)e = 0 with A = [a c; b d]
            let e = Math.abs(c) > 1e-9 ? [c, lam - a] : Math.abs(b) > 1e-9 ? [lam - d, b] : Math.abs(lam - a) < 1e-9 ? [1, 0] : [0, 1];
            const L = Math.hypot(...e) || 1; e = [e[0] / L, e[1] / L];
            const [x1, y1] = toPx([-e[0] * 9, -e[1] * 9]), [x2, y2] = toPx([e[0] * 9, e[1] * 9]);
            ctx.strokeStyle = C.green; ctx.globalAlpha = 0.35; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1;
            vec([0, 0], apply(m, e), C.green, `λ=${fmt(lam)}`, 3);
          }
        } else text(ctx, 'No real eigenvectors: this matrix rotates every direction', 14, h - 12, { size: 13, color: C.amber, italic: true });
        // a ring of sample vectors and where they go
        for (let k = 0; k < 16; k++) { const a0 = (k / 16) * Math.PI * 2; vec([0, 0], apply(m, [Math.cos(a0), Math.sin(a0)]), 'rgba(233,237,241,.35)', '', 1.2); }
      }
      vec([0, 0], apply(m, [1, 0]), C.amber, 'î'); vec([0, 0], apply(m, [0, 1]), C.violet, 'ĵ');
      if (kind === 'transform') { vec([0, 0], apply(m, v.x), C.glow, 'x', 2.6); }
      text(ctx, `[ ${fmt(v.i[0])}  ${fmt(v.j[0])} ]`, 14, 22, { size: 14, color: C.ink, mono: true });
      text(ctx, `[ ${fmt(v.i[1])}  ${fmt(v.j[1])} ]`, 14, 40, { size: 14, color: C.ink, mono: true });
      if (kind !== 'eigen') text(ctx, `det = ${fmt(det)}${det < 0 ? ' (flipped)' : Math.abs(det) < 1e-6 ? ' (squashed flat)' : ''}`, w - 14, 22, { size: 13.5, color: det < 0 ? C.red : C.green, align: 'right', mono: true });
    }
    // drag handles
    for (const k of handles[kind]) { const p = kind === 'transform' || kind === 'det' || kind === 'eigen' ? (k === 'x' ? apply(M(), v.x) : apply(M(), k === 'i' ? [1, 0] : [0, 1])) : v[k]; const [x, y] = toPx(p); ctx.strokeStyle = C.brassHi; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); }
    return moving;
  };

  // ---------- 3D ----------
  const cube = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const rot = ([x, y, z]) => {
    const { rx, ry, rz } = s;
    let [a, b, c] = [x, y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [a, c] = [a * Math.cos(ry) + c * Math.sin(ry), -a * Math.sin(ry) + c * Math.cos(ry)];
    [a, b] = [a * Math.cos(rz) - b * Math.sin(rz), a * Math.sin(rz) + b * Math.cos(rz)];
    return [a, b, c];
  };
  const view = { yaw: 0.6, pitch: -0.4 };
  const proj = p => {
    let [x, y, z] = p;
    [x, z] = [x * Math.cos(view.yaw) + z * Math.sin(view.yaw), -x * Math.sin(view.yaw) + z * Math.cos(view.yaw)];
    [y, z] = [y * Math.cos(view.pitch) - z * Math.sin(view.pitch), y * Math.sin(view.pitch) + z * Math.cos(view.pitch)];
    const f = 5 / (5 + z), k = S() * 1.1;
    return [st.w / 2 + x * k * f, st.h / 2 + 10 - y * k * f, z];
  };
  let spin = 0;
  function draw3d(dt) {
    const { ctx, w, h } = st;
    if (!dragging3) view.yaw += dt * 0.25 * spin;
    // axes
    [[[2.4, 0, 0], C.red, 'x'], [[0, 2.4, 0], C.green, 'y'], [[0, 0, 2.4], C.glow, 'z']].forEach(([p, col, l]) => { const [x1, y1] = proj([0, 0, 0]), [x2, y2] = proj(p); arrow(ctx, x1, y1, x2, y2, { color: col, width: 1.5, head: 7 }); text(ctx, l, x2 + 4, y2 - 4, { size: 13, color: col, italic: true }); });
    if (s.cross) {
      const a = [1.6, 0.3, 0], b = [0.4, 1.4, 0.2];
      const ra = rot(a), rb = rot(b);
      const c = [ra[1] * rb[2] - ra[2] * rb[1], ra[2] * rb[0] - ra[0] * rb[2], ra[0] * rb[1] - ra[1] * rb[0]];
      const P = [[0, 0, 0], ra, [ra[0] + rb[0], ra[1] + rb[1], ra[2] + rb[2]], rb].map(proj);
      ctx.fillStyle = 'rgba(255,181,71,.18)'; ctx.beginPath(); P.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
      for (const [p, col, l] of [[ra, C.amber, 'a'], [rb, C.violet, 'b'], [c, C.glow, 'a×b']]) { const [x1, y1] = proj([0, 0, 0]), [x2, y2] = proj(p); arrow(ctx, x1, y1, x2, y2, { color: col, width: 2.6, head: 9 }); text(ctx, l, x2 + 5, y2 - 5, { size: 14, color: col, weight: 600, italic: true }); }
      text(ctx, `|a×b| = ${fmt(Math.hypot(...c))} = the shaded area`, 14, 22, { size: 13.5, color: C.ink, mono: true });
    } else {
      const P = cube.map(p => proj(rot(p.map(q => q * 0.9))));
      edges.forEach(([a, b]) => { const z = (P[a][2] + P[b][2]) / 2; ctx.strokeStyle = z > 0 ? 'rgba(255,181,71,.45)' : C.brassHi; ctx.lineWidth = z > 0 ? 1.2 : 2.2; ctx.beginPath(); ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]); ctx.stroke(); });
      P.forEach(([x, y]) => { ctx.fillStyle = C.glow; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill(); });
      const r = rot([1, 0, 0]), u = rot([0, 1, 0]), f = rot([0, 0, 1]);
      [0, 1, 2].forEach(row => text(ctx, `[ ${[r, u, f].map(c => fmt(c[row]).padStart(5)).join(' ')} ]`, 14, 22 + row * 17, { size: 12.5, color: C.ink, mono: true }));
    }
    text(ctx, 'drag to orbit', w - 14, h - 12, { size: 12, color: C.faint, align: 'right', italic: true });
    return spin > 0 || dragging3;
  }

  // ---------- dragging ----------
  let drag = null, dragging3 = false, last = null;
  st.pointer({
    down: p => {
      if (kind === '3d') { dragging3 = true; last = p; spin = 0; return; }
      drag = null;
      for (const k of handles[kind]) {
        const q = kind === 'transform' || kind === 'det' || kind === 'eigen' ? (k === 'x' ? apply(M(), v.x) : apply(M(), k === 'i' ? [1, 0] : [0, 1])) : v[k];
        const [x, y] = toPx(q);
        if (Math.hypot(x - p.x, y - p.y) < 22) drag = k;
      }
      if (drag && (kind === 'transform' || kind === 'det' || kind === 'eigen')) { s.t = s.tt = 1; }
    },
    move: (p, down) => {
      if (!down) return;
      if (kind === '3d' && last) { view.yaw += (p.x - last.x) * 0.01; view.pitch = clamp(view.pitch + (p.y - last.y) * 0.01, -1.4, 1.4); last = p; kick(); return; }
      if (!drag) return;
      let u = toU(p.x, p.y);
      if (drag === 'x' && kind === 'transform') { const m = M(), det = m[0] * m[3] - m[1] * m[2]; if (Math.abs(det) > 1e-6) u = [(u[0] * m[3] - u[1] * m[2]) / det, (m[0] * u[1] - m[1] * u[0]) / det]; }
      v[drag] = u; kick();
    },
    up: () => { drag = null; dragging3 = false; last = null; spin = kind === '3d' ? 1 : 0; kick(); },
  });

  const PRESETS = { rotate: [[0, 1], [-1, 0]], shear: [[1, 0], [1, 1]], scale: [[2, 0], [0, 0.5]], reflect: [[1, 0], [0, -1]], squash: [[1, 0.5], [2, 1]], custom: null };
  const items = [{ key: 'k', type: 'select', value: kind, options: [['span', 'Span: a·a + b·b'], ['transform', 'Matrix as a transformation'], ['det', 'Determinant as area'], ['eigen', 'Eigenvectors'], ['dot', 'Dot product and projection'], ['basis', 'Change of basis'], ['3d', '3D rotation and cross product']], onChange: k => { kind = k; refresh(); } }];
  controls(host, items);
  const extra = document.createElement('div');
  host.append(extra);
  const cap = caption(host, '');
  const kick = loop(host, st, frame);
  function refresh() {
    extra.innerHTML = '';
    const add = list => extra.append(...[...(() => { const d = document.createElement('div'); controls(d, list); return d.children; })()]);
    if (kind === 'span') add([{ key: 'ca', type: 'slider', label: 'a', min: -3, max: 3, step: 0.25, value: s.ca, onInput: x => { s.ca = x; kick(); } }, { key: 'cb', type: 'slider', label: 'b', min: -3, max: 3, step: 0.25, value: s.cb, onInput: x => { s.cb = x; kick(); } }]);
    if (kind === 'transform' || kind === 'det' || kind === 'eigen') add([
      { key: 'p', type: 'select', value: 'custom', options: [['custom', 'Your own (drag î and ĵ)'], ['rotate', 'Rotate 90°'], ['shear', 'Shear'], ['scale', 'Stretch'], ['reflect', 'Reflect'], ['squash', 'Squash flat']], onChange: k => { if (PRESETS[k]) { v.i = [...PRESETS[k][0]]; v.j = [...PRESETS[k][1]]; } s.t = 0; s.tt = 1; kick(); } },
      { key: 'go', label: 'Replay', primary: true, onClick: () => { s.t = 0; s.tt = 1; kick(); } },
    ]);
    if (kind === '3d') add([
      { key: 'rx', type: 'slider', label: 'turn x', min: -3.14, max: 3.14, step: 0.01, value: s.rx, format: x => `${Math.round((x * 180) / Math.PI)}°`, onInput: x => { s.rx = x; kick(); } },
      { key: 'ry', type: 'slider', label: 'turn y', min: -3.14, max: 3.14, step: 0.01, value: s.ry, format: x => `${Math.round((x * 180) / Math.PI)}°`, onInput: x => { s.ry = x; kick(); } },
      { key: 'cr', label: s.cross ? 'Show the cube' : 'Show a × b', onClick: b => { s.cross = !s.cross; b.textContent = s.cross ? 'Show the cube' : 'Show a × b'; kick(); } },
    ]);
    cap.textContent = {
      span: 'Drag the tips of a and b, then slide the amounts. Line them up and the span collapses to a line.',
      transform: 'Drag î and ĵ: they are the matrix’s columns, and the whole grid follows. x moves with them.',
      det: 'The shaded square is the unit square after the matrix: its area is the determinant. Flip ĵ past î and it turns red.',
      eigen: 'Green lines are eigenvectors: directions the matrix only stretches, by λ.',
      dot: 'Drag a and b. The green arrow is b projected onto a; a·b is its length times |a|.',
      basis: 'Drag the new basis b₁, b₂ and the point: the same point gets different coordinates.',
      '3d': 'Drag to orbit. The sliders build a rotation matrix whose columns are where x, y and z land.',
    }[kind];
    spin = kind === '3d' ? 1 : 0;
    if (kind === 'eigen') { v.i = [1.5, 0.5]; v.j = [0.5, 1]; }
    s.t = 0; s.tt = 1;
    kick();
  }
  refresh();
}
