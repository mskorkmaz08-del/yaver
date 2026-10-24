// Probability mill: dice sums piling into a histogram that settles on the true shape, sample
// means turning into a bell curve (the central limit theorem), bootstrap resampling, and a
// Bayes grid for "how likely am I sick, given a positive test".
export default function probability(host, { mode, kit }) {
  const { stage, plate, text, roundRect, loop, controls, caption, C, lerp, clamp, fmt } = kit;
  const st = stage(host, { height: 300 });
  let kind = ['dice', 'clt', 'bootstrap', 'conditional'].includes(mode) ? mode : 'dice';
  const balls = []; // falling balls: { x, y, vy, tx, ty, bin, color, life }
  let s;

  // ---------- shared histogram ----------
  const bins = (lo, hi, n) => ({ lo, hi, n, c: new Array(n).fill(0), total: 0 });
  const binOf = (H, v) => clamp(Math.floor(((v - H.lo) / (H.hi - H.lo)) * H.n), 0, H.n - 1);
  function drawHist(ctx, H, box, { color = C.brass, expect, curve, shade } = {}) {
    const max = Math.max(1, ...H.c, ...(expect ? expect.map(e => e * H.total) : []));
    const bw = (box.r - box.l) / H.n;
    if (shade) { ctx.fillStyle = 'rgba(127,178,217,.08)'; ctx.fillRect(box.l + ((shade[0] - H.lo) / (H.hi - H.lo)) * (box.r - box.l), box.t, ((shade[1] - shade[0]) / (H.hi - H.lo)) * (box.r - box.l), box.b - box.t); }
    H.c.forEach((c, i) => {
      const h = H.shown ? H.shown[i] : c;
      const y = box.b - (h / max) * (box.b - box.t);
      ctx.fillStyle = color; ctx.globalAlpha = 0.85; roundRect(ctx, box.l + i * bw + 1, y, bw - 2, box.b - y, 2); ctx.fill(); ctx.globalAlpha = 1;
    });
    if (expect && H.total) {
      ctx.strokeStyle = C.glow; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath();
      expect.forEach((e, i) => { const y = box.b - ((e * H.total) / max) * (box.b - box.t); ctx.moveTo(box.l + i * bw + 3, y); ctx.lineTo(box.l + (i + 1) * bw - 3, y); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (curve && H.total) {
      ctx.strokeStyle = C.glow; ctx.lineWidth = 2; ctx.beginPath();
      for (let k = 0; k <= 80; k++) {
        const x = H.lo + ((H.hi - H.lo) * k) / 80;
        const y = box.b - ((curve(x) * H.total * ((H.hi - H.lo) / H.n)) / max) * (box.b - box.t);
        k ? ctx.lineTo(box.l + (k / 80) * (box.r - box.l), y) : ctx.moveTo(box.l, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = C.faint; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(box.l, box.b + 0.5); ctx.lineTo(box.r, box.b + 0.5); ctx.stroke();
  }
  // Bars grow smoothly toward their counts.
  const settle = (H, dt) => {
    H.shown = H.shown || H.c.map(() => 0);
    let moving = false;
    H.c.forEach((c, i) => { const d = c - H.shown[i]; if (Math.abs(d) > 0.01) { H.shown[i] += d * Math.min(1, dt * 10); moving = true; } else H.shown[i] = c; });
    return moving;
  };
  const drop = (x, y, tx, ty, onLand, color = C.amber) => balls.push({ x, y, vx: (tx - x) * 1.6, vy: -60, tx, ty, onLand, color, t: 0 });

  // ---------- modes ----------
  const normal = (m, sd) => x => Math.exp(-0.5 * ((x - m) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
  const POPS = {
    skewed: { name: 'Waiting times (skewed)', draw: () => -Math.log(1 - Math.random()) * 2, lo: 0, hi: 10, mean: 2, sd: 2 },
    uniform: { name: 'Uniform 0–10', draw: () => Math.random() * 10, lo: 0, hi: 10, mean: 5, sd: 10 / Math.sqrt(12) },
    humps: { name: 'Two humps', draw: () => (Math.random() < 0.5 ? 2.5 : 7.5) + (Math.random() - 0.5) * 2.4, lo: 0, hi: 10, mean: 5, sd: Math.sqrt(2.5 ** 2 + 2.4 ** 2 / 12) },
  };
  const SAMPLE = [3.1, 4.7, 2.2, 5.9, 4.1, 3.8, 6.4, 2.9, 5.2, 4.4, 7.1, 3.5];

  function reset() {
    balls.length = 0;
    if (kind === 'dice') s = { dice: s?.dice || 2, H: null, last: [] };
    if (kind === 'clt') s = { pop: s?.pop || 'skewed', n: s?.n || 5, picks: [], P: null, M: null };
    if (kind === 'bootstrap') s = { picks: [], M: bins(2, 7, 25), means: [] };
    if (kind === 'conditional') s = { prev: s?.prev ?? 0.05, sens: s?.sens ?? 0.9, fpr: s?.fpr ?? 0.08, tested: 0, people: [] };
    if (kind === 'dice') { const n = s.dice; s.H = bins(n - 0.5, 6 * n + 0.5, 5 * n + 1); }
    if (kind === 'clt') {
      const P = POPS[s.pop];
      s.P = bins(P.lo, P.hi, 30);
      for (let i = 0; i < 3000; i++) s.P.c[binOf(s.P, P.draw())]++;
      s.P.total = 3000; s.P.shown = [...s.P.c];
      s.M = bins(P.lo, P.hi, 40);
    }
    if (kind === 'conditional') {
      // 400 people, sick ones placed at random; each has fixed random draws so sliders move smoothly.
      s.people = Array.from({ length: 400 }, (_, i) => ({ i, r: Math.random(), q: Math.random(), glow: 0 }));
    }
    build(); st.kick?.();
  }

  // ---------- actions ----------
  function rollDice(times) {
    for (let k = 0; k < times; k++) {
      const faces = Array.from({ length: s.dice }, () => 1 + Math.floor(Math.random() * 6));
      const sum = faces.reduce((a, b) => a + b, 0);
      if (k === times - 1) s.last = faces.map(f => ({ f, spin: 1 }));
      const i = binOf(s.H, sum);
      if (times <= 20) {
        const b = box(); const bw = (b.r - b.l) / s.H.n;
        setTimeout(() => drop(st.w / 2, 70, b.l + (i + 0.5) * bw, b.b - 6, () => { s.H.c[i]++; s.H.total++; }), k * 90);
      } else { s.H.c[i]++; s.H.total++; }
    }
    st.kick();
  }
  const diceExpect = () => {
    let dist = [1];
    for (let d = 0; d < s.dice; d++) { const nd = new Array(dist.length + 6).fill(0); dist.forEach((p, i) => { for (let f = 1; f <= 6; f++) nd[i + f] += p / 6; }); dist = nd; }
    return Array.from({ length: s.H.n }, (_, i) => dist[i + s.dice] || 0);
  };
  function sampleMean(times) {
    const P = POPS[s.pop];
    for (let k = 0; k < times; k++) {
      const xs = Array.from({ length: s.n }, P.draw);
      const m = xs.reduce((a, b) => a + b, 0) / s.n;
      if (times === 1) {
        s.picks = xs.map(x => ({ x, life: 1 }));
        const tb = lower();
        setTimeout(() => drop(xOn(tb, m), upper().b + 4, xOn(tb, m), tb.b - 4, () => { s.M.c[binOf(s.M, m)]++; s.M.total++; s.lastMean = m; }, C.glow), 380);
      } else { s.M.c[binOf(s.M, m)]++; s.M.total++; s.lastMean = m; }
    }
    st.kick();
  }
  function resample(times) {
    for (let k = 0; k < times; k++) {
      const idx = Array.from({ length: SAMPLE.length }, () => Math.floor(Math.random() * SAMPLE.length));
      const m = idx.reduce((a, i) => a + SAMPLE[i], 0) / idx.length;
      s.means.push(m);
      if (times === 1) {
        s.picks = idx.map((i, j) => ({ i, j, life: 1 }));
        const tb = lower();
        setTimeout(() => drop(xOn(tb, m), upper().b + 4, xOn(tb, m), tb.b - 4, () => { s.M.c[binOf(s.M, m)]++; s.M.total++; }, C.glow), 420);
      } else { s.M.c[binOf(s.M, m)]++; s.M.total++; }
    }
    st.kick();
  }

  // ---------- layout ----------
  const box = () => ({ l: 20, r: st.w - 20, t: 120, b: st.h - 30 });
  const upper = () => ({ l: 20, r: st.w - 20, t: 40, b: st.h * 0.42 });
  const lower = () => ({ l: 20, r: st.w - 20, t: st.h * 0.55, b: st.h - 28 });
  const xOn = (b, v) => b.l + ((v - s.M.lo) / (s.M.hi - s.M.lo)) * (b.r - b.l);

  function die(ctx, x, y, size, f, spin) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(spin * 6);
    const g = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
    g.addColorStop(0, '#eef1f4'); g.addColorStop(1, '#c4ccd4');
    ctx.fillStyle = g; roundRect(ctx, -size / 2, -size / 2, size, size, size * 0.18); ctx.fill();
    ctx.strokeStyle = C.brass; ctx.lineWidth = 2; ctx.stroke();
    const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[spin > 0.15 ? 1 + Math.floor(Math.random() * 6) : f];
    ctx.fillStyle = '#2c2a26';
    for (const [a, b] of P) { ctx.beginPath(); ctx.arc(a * size * 0.26, b * size * 0.26, size * 0.08, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function draw(ctx, w, h) {
    if (kind === 'dice') {
      const b = box();
      text(ctx, `Sum of ${s.dice} ${s.dice > 1 ? 'dice' : 'die'}   rolls: ${s.H.total}`, 14, 22, { size: 13, color: C.ink, mono: true });
      s.last.forEach((d, i) => die(ctx, w / 2 + (i - (s.last.length - 1) / 2) * 46, 70, 34, d.f, d.spin));
      if (s.last.length && s.last.every(d => d.spin <= 0)) text(ctx, `= ${s.last.reduce((a, d) => a + d.f, 0)}`, w / 2 + (s.last.length / 2) * 46 + 4, 76, { size: 18, color: C.amber, mono: true });
      drawHist(ctx, s.H, b, { expect: diceExpect() });
      const bw = (b.r - b.l) / s.H.n, step = s.H.n > 12 ? 2 : 1;
      for (let i = 0; i < s.H.n; i += step) text(ctx, String(i + s.dice), b.l + (i + 0.5) * bw, b.b + 15, { size: 11, color: C.dim, align: 'center', mono: true });
      text(ctx, '- - - expected share', w - 14, 42, { size: 11.5, color: C.glow, align: 'right', mono: true });
    } else if (kind === 'clt' || kind === 'bootstrap') {
      const u = upper(), lb = lower();
      if (kind === 'clt') {
        const P = POPS[s.pop];
        text(ctx, 'population', 14, 22, { size: 13, color: C.dim, italic: true });
        drawHist(ctx, s.P, u, { color: 'rgba(255,181,71,.55)' });
        s.picks.forEach(p => { const x = u.l + ((p.x - P.lo) / (P.hi - P.lo)) * (u.r - u.l); ctx.fillStyle = `rgba(255,181,71,${p.life})`; ctx.beginPath(); ctx.arc(x, u.b - 6 - (1 - p.life) * 30, 5, 0, Math.PI * 2); ctx.fill(); });
        text(ctx, `means of ${s.n} draws: ${s.M.total}`, 14, lb.t - 10, { size: 13, color: C.ink, mono: true });
        const sd = P.sd / Math.sqrt(s.n);
        drawHist(ctx, s.M, lb, { color: C.teal, curve: s.M.total > 30 ? normal(P.mean, sd) : null });
        if (s.M.total > 30) text(ctx, `bell: spread ${fmt(P.sd)}/√${s.n} = ${fmt(sd)}`, w - 14, lb.t + 8, { size: 11, color: C.glow, align: 'right', mono: true });
      } else {
        text(ctx, 'your one sample of 12', 14, 22, { size: 13, color: C.dim, italic: true });
        const cw = (u.r - u.l) / 6;
        SAMPLE.forEach((v, i) => {
          const row = Math.floor(i / 6), col = i % 6, top = u.t + 4 + row * 40;
          const hits = s.picks.filter(p => p.i === i);
          const lit = hits.length ? hits[0].life : 0;
          ctx.fillStyle = lit ? `rgba(255,181,71,${0.25 + 0.6 * lit})` : 'rgba(255,181,71,.12)';
          roundRect(ctx, u.l + col * cw + 3, top, cw - 6, 30, 4); ctx.fill();
          ctx.strokeStyle = C.brass; ctx.lineWidth = 1; ctx.stroke();
          text(ctx, String(v), u.l + (col + 0.5) * cw, top + 20, { size: 12, color: C.ink, align: 'center', mono: true });
          if (hits.length > 1) text(ctx, `×${hits.length}`, u.l + (col + 1) * cw - 8, top + 10, { size: 10.5, color: C.amber, align: 'right', mono: true, weight: 700 });
        });
        text(ctx, 'pick 12 with replacement, take the mean, repeat', 14, u.b + 2, { size: 12, color: C.dim, italic: true });
        let shade = null;
        if (s.means.length >= 40) { const m = [...s.means].sort((a, b) => a - b); shade = [m[Math.floor(m.length * 0.025)], m[Math.ceil(m.length * 0.975) - 1]]; }
        text(ctx, `resampled means: ${s.M.total}`, 14, lb.t - 10, { size: 13, color: C.ink, mono: true });
        drawHist(ctx, s.M, lb, { color: C.teal, shade });
        if (shade) text(ctx, `95%: ${fmt(shade[0])} – ${fmt(shade[1])}`, w - 14, lb.t + 8, { size: 11.5, color: C.glow, align: 'right', mono: true });
      }
      for (const v of [s.M.lo, (s.M.lo + s.M.hi) / 2, s.M.hi]) text(ctx, fmt(v), xOn(lb, v), lb.b + 15, { size: 11, color: C.dim, align: 'center', mono: true });
    } else {
      // Bayes grid: 20 × 20 people.
      const n = 20, top = 34, side = Math.min((w - 40) / n, (h - top - 70) / n), ox = (w - side * n) / 2;
      let tp = 0, fp = 0;
      s.people.forEach(p => {
        const sick = p.r < s.prev, pos = sick ? p.q < s.sens : p.q < s.fpr;
        const shown = s.tested > p.i;
        if (shown && pos) sick ? tp++ : fp++;
        const x = ox + (p.i % n) * side + side / 2, y = top + Math.floor(p.i / n) * side + side / 2;
        ctx.beginPath(); ctx.arc(x, y, side * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = sick ? C.red : 'rgba(233,237,241,.22)'; ctx.fill();
        if (shown && pos) { ctx.strokeStyle = C.glow; ctx.lineWidth = 2; ctx.shadowColor = C.glow; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0; }
      });
      text(ctx, '● sick   ○ ringed = tested positive', 14, 22, { size: 12, color: C.dim, mono: true });
      const yb = top + side * n + 22;
      if (s.tested >= 400) {
        const p = tp / (tp + fp || 1);
        text(ctx, `positives: ${tp} sick + ${fp} healthy`, 14, yb, { size: 13, color: C.ink, mono: true });
        text(ctx, `P(sick | positive) = ${tp}/${tp + fp} = ${Math.round(p * 100)}%`, 14, yb + 20, { size: 14, color: C.amber, mono: true, weight: 600 });
      } else text(ctx, 'Tap Test everyone', 14, yb, { size: 13, color: C.dim, italic: true });
    }
    // falling balls
    balls.forEach(b => { ctx.fillStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; });
  }

  // ---------- controls ----------
  const wrap = document.createElement('div');
  host.append(wrap);
  const note = caption(host, '');
  const NOTES = {
    dice: 'Each roll drops into its bar. Few rolls look random; many rolls settle onto the dashed expected shape. That is the law of large numbers.',
    clt: 'Draw n values, average them, drop the average below. Whatever the population looks like, the averages pile into a bell, narrower as n grows.',
    bootstrap: 'You only have one sample. Resampling it with replacement shows how much its mean could wobble: the middle 95% is the interval.',
    conditional: 'A good test on a rare illness: most positives are still healthy people. Move the rarity and watch the answer change.',
  };
  function build() {
    wrap.innerHTML = '';
    const items = [{ key: 'kind', type: 'select', value: kind, options: [['dice', 'Dice and the law of large numbers'], ['clt', 'Central limit theorem'], ['bootstrap', 'Bootstrap'], ['conditional', 'Conditional probability (Bayes)']], onChange: v => { kind = v; s = null; reset(); } }];
    if (kind === 'dice') items.push(
      { key: 'n', type: 'slider', label: 'dice', min: 1, max: 4, value: s.dice, onInput: v => { s.dice = v; reset(); } },
      { key: 'r1', label: 'Roll', primary: true, onClick: () => rollDice(1) },
      { key: 'r10', label: '×10', onClick: () => rollDice(10) },
      { key: 'r500', label: '×500', onClick: () => rollDice(500) });
    if (kind === 'clt') items.push(
      { key: 'pop', type: 'select', value: s.pop, options: Object.entries(POPS).map(([k, p]) => [k, p.name]), onChange: v => { s.pop = v; reset(); } },
      { key: 'n', type: 'slider', label: 'n', min: 1, max: 30, value: s.n, onInput: v => { s.n = v; s.M = bins(POPS[s.pop].lo, POPS[s.pop].hi, 40); s.picks = []; st.kick(); } },
      { key: 'd1', label: 'Draw', primary: true, onClick: () => sampleMean(1) },
      { key: 'd200', label: '×200', onClick: () => sampleMean(200) });
    if (kind === 'bootstrap') items.push(
      { key: 'b1', label: 'Resample', primary: true, onClick: () => resample(1) },
      { key: 'b500', label: '×500', onClick: () => resample(500) },
      { key: 'clr', label: 'Clear', onClick: () => reset() });
    if (kind === 'conditional') items.push(
      { key: 'prev', type: 'slider', label: 'sick', min: 0.01, max: 0.5, step: 0.01, value: s.prev, format: v => `${Math.round(v * 100)}%`, onInput: v => { s.prev = v; st.kick(); } },
      { key: 'sens', type: 'slider', label: 'test catches', min: 0.5, max: 1, step: 0.01, value: s.sens, format: v => `${Math.round(v * 100)}%`, onInput: v => { s.sens = v; st.kick(); } },
      { key: 'fpr', type: 'slider', label: 'false alarms', min: 0, max: 0.3, step: 0.01, value: s.fpr, format: v => `${Math.round(v * 100)}%`, onInput: v => { s.fpr = v; st.kick(); } },
      { key: 't', label: 'Test everyone', primary: true, onClick: () => { s.tested = 0; s.testing = true; st.kick(); } });
    controls(wrap, items);
    note.innerHTML = NOTES[kind];
  }

  reset();
  loop(host, st, dt => {
    let busy = false;
    for (const b of [...balls]) {
      b.t += dt; b.vy += 900 * dt; b.x = lerp(b.x, b.tx, Math.min(1, dt * 6)); b.y += b.vy * dt;
      if (b.y >= b.ty) { balls.splice(balls.indexOf(b), 1); b.onLand?.(); }
      busy = true;
    }
    if (kind === 'dice') { s.last.forEach(d => { if (d.spin > 0) { d.spin = Math.max(0, d.spin - dt * 1.8); busy = true; } }); busy = settle(s.H, dt) || busy; }
    if (kind === 'clt' || kind === 'bootstrap') { s.picks.forEach(p => { if (p.life > 0) { p.life = Math.max(0, p.life - dt * 1.2); busy = true; } }); busy = settle(s.M, dt) || busy; }
    if (kind === 'conditional' && s.testing) { s.tested += dt * 260; if (s.tested >= 400) { s.tested = 400; s.testing = false; } busy = true; }
    plate(st.ctx, st.w, st.h);
    draw(st.ctx, st.w, st.h);
    return busy;
  });
}
