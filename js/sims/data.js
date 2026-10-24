// Table press: a small study table goes through the same moves as SQL and pandas. Rows are
// physical strips that slide, fade, regroup and fold together, so WHERE, ORDER BY, GROUP BY,
// joins, cleaning and charting each show what happens to the rows.
export default function data(host, { mode, kit }) {
  const { stage, text, roundRect, controls, timeline, C, lerp } = kit;
  const st = stage(host, { height: 310 });
  let kind = ['filter', 'group', 'join', 'clean', 'chart'].includes(mode) ? mode : 'filter';

  // Virtual 320 × 310 space, scaled to the canvas.
  const VW = 320, VH = 310, RH = 24, TOP = 66;
  const COLS = ['name', 'track', 'min', 'score'];
  const CW = 72, X0 = 16;
  const DATA = [
    { id: 1, name: 'Aru', track: 'python', min: 45, score: 82 },
    { id: 2, name: 'Ben', track: 'math', min: 30, score: 64 },
    { id: 3, name: 'Dana', track: 'python', min: 60, score: 91 },
    { id: 4, name: 'Erlan', track: 'ai', min: 20, score: 70 },
    { id: 5, name: 'Mira', track: 'math', min: 50, score: 77 },
    { id: 6, name: 'Timur', track: 'ai', min: 40, score: 88 },
    { id: 7, name: 'Zhan', track: 'python', min: 25, score: 58 },
  ];
  const TINT = { python: C.amber, math: C.violet, ai: C.teal };
  const cellsOf = r => COLS.map(c => (r[c] == null ? 'NaN' : String(r[c])));

  // An item is a rectangle that may carry cells: { id, x, y, w, h, cells, widths, a, fill, ring, bar }
  const row = (r, i, extra = {}) => ({ id: `r${r.id}`, x: X0, y: TOP + i * RH, w: CW * 4, h: RH - 3, cells: cellsOf(r), a: 1, ...extra });
  const header = (cols = COLS, x = X0, y = TOP - RH, cw = CW, id = 'h') => ({ id, x, y, w: cw * cols.length, h: RH - 3, cells: cols, head: true, a: 1, cw });
  const frame = (items, query, note) => ({ items, query, note });

  function framesFor() {
    const F = [];
    if (kind === 'filter') {
      const q = ['SELECT * FROM study'];
      F.push(frame([header(), ...DATA.map(row)], q.join('\n'), 'The whole table: one strip per row'));
      q.push('WHERE min >= 30');
      F.push(frame([header(), ...DATA.map((r, i) => row(r, i, r.min < 30 ? { ring: C.red, fill: 'rgba(239,122,109,.18)' } : { ring: C.green }))], q.join('\n'), 'WHERE checks each row: Erlan and Zhan studied under 30 minutes'));
      const kept = DATA.filter(r => r.min >= 30);
      F.push(frame([header(), ...kept.map(row), ...DATA.filter(r => r.min < 30).map(r => row(r, DATA.indexOf(r), { x: VW + 20, a: 0 }))], q.join('\n'), 'Rows that fail the test leave; the rest close up'));
      q.push('ORDER BY score DESC');
      const sorted = [...kept].sort((a, b) => b.score - a.score);
      F.push(frame([header(), ...sorted.map((r, i) => row(r, i, { ring: i === 0 ? C.amber : undefined }))], q.join('\n'), 'ORDER BY slides them into score order, highest first'));
      q.push('LIMIT 3');
      F.push(frame([header(), ...sorted.map((r, i) => row(r, i, i >= 3 ? { a: 0.12 } : {}))], q.join('\n'), 'LIMIT keeps the first three'));
      F.push(frame([header(), ...sorted.slice(0, 3).map((r, i) => row(r, i))], q.join('\n'), 'pandas: df[df["min"] >= 30].sort_values("score", ascending=False).head(3)'));
    } else if (kind === 'group') {
      const q = "df.groupby('track').agg(minutes=('min','sum'), avg=('score','mean'))";
      F.push(frame([header(), ...DATA.map(row)], q, 'Each row belongs to one track'));
      F.push(frame([header(), ...DATA.map((r, i) => row(r, i, { ring: TINT[r.track], fill: TINT[r.track] + '22' }))], q, 'Colour the rows by their group key: track'));
      const order = ['ai', 'math', 'python'];
      let y = 0; const pos = {}, gy = {};
      for (const g of order) { gy[g] = y; DATA.filter(r => r.track === g).forEach(r => { pos[r.id] = y++; }); y += 0.4; }
      F.push(frame([header(), ...DATA.map(r => row(r, pos[r.id], { ring: TINT[r.track], fill: TINT[r.track] + '22' }))], q, 'Split: rows with the same key gather together'));
      const H2 = ['track', 'minutes', 'avg'];
      const sum = order.map(g => { const rs = DATA.filter(r => r.track === g); return { g, rs, m: rs.reduce((a, r) => a + r.min, 0), s: rs.reduce((a, r) => a + r.score, 0) / rs.length }; });
      // fold: each group's rows slide into the group's first slot
      F.push(frame([header(), ...DATA.map(r => row(r, gy[r.track], { ring: TINT[r.track], fill: TINT[r.track] + '22', a: 0.5 }))], q, 'Apply: fold each group into one row'));
      F.push(frame([header(H2, X0, TOP - RH, 96, 'h'), ...sum.map((g, i) => ({ id: `r${g.rs[0].id}`, x: X0, y: TOP + i * RH, w: 288, h: RH - 3, cells: [g.g, String(g.m), String(Math.round(g.s * 10) / 10)], cw: 96, ring: TINT[g.g], fill: TINT[g.g] + '22', a: 1 })), ...DATA.filter(r => !sum.some(g => g.rs[0] === r)).map(r => row(r, gy[r.track], { a: 0 }))], q, 'Combine: one row per track with total minutes and average score'));
    } else if (kind === 'join') {
      const L = DATA.slice(0, 5).map(r => ({ id: r.id, name: r.name, track: r.track === 'ai' ? 'cpp' : r.track }));
      const R = [{ id: 'm', track: 'python', mentor: 'Mustafa' }, { id: 'n', track: 'math', mentor: 'Aigerim' }, { id: 'o', track: 'robo', mentor: 'Sanzhar' }];
      const cw = 68, lx = 10, rx = 166;
      const lrow = (r, i, ex = {}) => ({ id: `l${r.id}`, x: lx, y: TOP + i * RH, w: cw * 2, h: RH - 3, cells: [r.name, r.track], cw, a: 1, ...ex });
      const rrow = (r, i, ex = {}) => ({ id: `t${r.id}`, x: rx, y: TOP + i * RH, w: cw * 2, h: RH - 3, cells: [r.track, r.mentor], cw, a: 1, ...ex });
      const heads = [header(['name', 'track'], lx, TOP - RH, cw, 'hl'), header(['track', 'mentor'], rx, TOP - RH, cw, 'hr')];
      const q = "pd.merge(students, mentors, on='track')";
      const base = (ex = {}) => [...heads, ...L.map((r, i) => lrow(r, i, ex[`l${r.id}`])), ...R.map((r, i) => rrow(r, i, ex[`t${r.id}`]))];
      F.push(frame(base(), q, 'Two tables share a column: track'));
      const out = [];
      const resY = TOP + 5 * RH + 30;
      const rhead = header(['name', 'track', 'mentor'], X0, resY - RH, 96, 'hres');
      L.forEach((r, i) => {
        const j = R.findIndex(m => m.track === r.track);
        const ex = { [`l${r.id}`]: { ring: j >= 0 ? C.glow : C.red } };
        if (j >= 0) {
          ex[`t${R[j].id}`] = { ring: C.glow };
          out.push({ id: `j${r.id}`, x: X0, y: resY + out.length * RH, w: 288, h: RH - 3, cells: [r.name, r.track, R[j].mentor], cw: 96, a: 1, ring: C.green });
          F.push({ ...frame([...base(ex), rhead, ...out.map(o => ({ ...o }))], q, `${r.name}: track ${r.track} matches, so a joined row is made`), link: [`l${r.id}`, `t${R[j].id}`] });
        } else {
          F.push(frame([...base(ex), rhead, ...out.map(o => ({ ...o }))], q, `${r.name}: no mentor for ${r.track}, so an inner join drops this row`));
        }
      });
      F.push(frame([...base({ to: { ring: C.dim } }), rhead, ...out], q, "Done. how='left' would keep Erlan with mentor NaN; robo has no student"));
    } else if (kind === 'clean') {
      const raw = [
        { id: 1, name: 'Aru', track: 'python', min: 45, score: 82 },
        { id: 2, name: 'Ben', track: ' Math', min: 30, score: null },
        { id: 3, name: 'Dana', track: 'python', min: 60, score: 91 },
        { id: 8, name: 'Dana', track: 'python', min: 60, score: 91 },
        { id: 4, name: 'Erlan', track: 'AI ', min: 20, score: 70 },
        { id: 5, name: 'Mira', track: 'math', min: null, score: 77 },
      ];
      const rr = (r, i, ex = {}, over = {}) => row({ ...r, ...over }, i, ex);
      F.push(frame([header(), ...raw.map((r, i) => rr(r, i))], 'df = pd.read_csv("study.csv")', 'Real data arrives messy'));
      F.push(frame([header(), ...raw.map((r, i) => rr(r, i, r.score == null || r.min == null ? { ring: C.red, bad: r.score == null ? 3 : 2 } : {}))], 'df.isna().sum()', 'Missing values: Ben has no score, Mira has no minutes'));
      F.push(frame([header(), ...raw.map((r, i) => rr(r, i, r.id === 8 || r.id === 3 ? { ring: C.amber } : {}))], 'df.duplicated()', 'Dana appears twice, an exact duplicate'));
      const nodup = raw.filter(r => r.id !== 8);
      F.push(frame([header(), ...nodup.map((r, i) => rr(r, i)), rr(raw[3], 3, { x: VW + 20, a: 0 })], 'df = df.drop_duplicates()', 'The copy slides out'));
      F.push(frame([header(), ...nodup.map((r, i) => rr(r, i, /^ |[A-Z]| $/.test(r.track) ? { ring: C.amber, bad: 1 } : {}))], 'df["track"].unique()', "' Math' and 'AI ' are the same tracks written differently"));
      const fixed = nodup.map(r => ({ ...r, track: r.track.trim().toLowerCase() }));
      F.push(frame([header(), ...fixed.map((r, i) => rr(r, i, r.id === 2 || r.id === 4 ? { ring: C.green } : {}))], 'df["track"] = df["track"].str.strip().str.lower()', 'Strip spaces and lower-case: now they group correctly'));
      const meanMin = Math.round(fixed.filter(r => r.min != null).reduce((a, r) => a + r.min, 0) / fixed.filter(r => r.min != null).length);
      F.push(frame([header(), ...fixed.map((r, i) => rr(r, i, r.id === 5 ? { ring: C.green, good: 2 } : r.id === 2 ? { ring: C.red, x: VW + 20, a: 0 } : {}, r.id === 5 ? { min: meanMin } : {}))], `df["min"] = df["min"].fillna(df["min"].mean())\ndf = df.dropna(subset=["score"])`, `Fill Mira's minutes with the mean (${meanMin}); drop Ben, whose score we can't guess`));
      F.push(frame([header(), ...fixed.filter(r => r.id !== 2).map((r, i) => rr(r, i, {}, r.id === 5 ? { min: meanMin } : {}))], 'df.info()', 'Clean: no duplicates, no gaps, one spelling per track'));
    } else {
      const base = 250, top = 70, bw = 34, gap = (288 - 7 * bw) / 6;
      const bar = (r, i, lo = 0, ex = {}) => { const hgt = ((r.score - lo) / (100 - lo)) * (base - top); return { id: `r${r.id}`, x: X0 + i * (bw + gap), y: base - hgt, w: bw, h: hgt, bar: r.name, val: r.score, a: 1, fill: TINT[r.track], ...ex }; };
      F.push(frame([header(), ...DATA.map(row)], 'plt.bar(df["name"], df["score"])', 'Start from the table'));
      F.push({ ...frame(DATA.map((r, i) => bar(r, i)), 'plt.bar(df["name"], df["score"])', 'Each score becomes a bar; height is the value'), axis: 0 });
      const sorted = [...DATA].sort((a, b) => b.score - a.score);
      F.push({ ...frame(sorted.map((r, i) => bar(r, i)), 'df.sort_values("score", ascending=False)', 'Sorted bars are easier to read'), axis: 0 });
      F.push({ ...frame(sorted.map((r, i) => bar(r, i, 50)), 'plt.ylim(50, 100)', 'Cut the axis at 50 and Zhan suddenly looks hopeless: a misleading chart'), axis: 50, warn: true });
      F.push({ ...frame(sorted.map((r, i) => bar(r, i)), 'plt.ylim(0, 100)', 'Bars must start at zero to compare honestly'), axis: 0 });
    }
    return F;
  }

  const draw = (ctx, w, h, A, B, t) => {
    const sx = w / VW, sy = h / VH;
    ctx.save();
    // query strip
    const q = (t < 0.5 ? A : B).query || '';
    // at most two lines: the earlier clauses, then the newest one in amber
    const ql = q.split('\n'), lines = ql.length > 1 ? [ql.slice(0, -1).join(' '), ql.at(-1)] : ql;
    lines.forEach((line, k) => text(ctx, line, 12, 20 + k * 15, { size: 11.5, color: k === lines.length - 1 ? C.amber : C.dim, mono: true }));
    const byId = new Map(), ids = [];
    for (const it of A.items) { byId.set(it.id, [it, null]); ids.push(it.id); }
    for (const it of B.items) { if (byId.has(it.id)) byId.get(it.id)[1] = it; else { byId.set(it.id, [null, it]); ids.push(it.id); } }
    // chart axis
    const ax = t < 0.5 ? A.axis : B.axis;
    if (ax !== undefined) {
      ctx.strokeStyle = (t < 0.5 ? A : B).warn ? C.red : C.faint; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X0 * sx - 2, 70 * sy); ctx.lineTo(X0 * sx - 2, 250 * sy); ctx.lineTo((X0 + 288) * sx, 250 * sy); ctx.stroke();
      text(ctx, String(ax), X0 * sx - 4, 250 * sy + 4, { size: 10, color: (t < 0.5 ? A : B).warn ? C.red : C.dim, align: 'right', mono: true });
    }
    for (const id of ids) {
      let [a, b] = byId.get(id);
      if (!a) a = { ...b, a: 0, x: b.x + 30 };
      if (!b) b = { ...a, a: 0 };
      const x = lerp(a.x, b.x, t) * sx, y = lerp(a.y, b.y, t) * sy, wd = lerp(a.w, b.w, t) * sx, ht = lerp(a.h, b.h, t) * (a.bar || b.bar ? sy : 1);
      const alpha = lerp(a.a ?? 1, b.a ?? 1, t);
      if (alpha < 0.02) continue;
      const S = t < 0.5 ? a : b;
      ctx.globalAlpha = alpha;
      const isBar = a.bar && b.bar, toBar = !a.bar && b.bar, fromBar = a.bar && !b.bar;
      const barness = isBar ? 1 : toBar ? t : fromBar ? 1 - t : 0;
      ctx.fillStyle = S.head ? 'rgba(255,181,71,.16)' : barness > 0 ? (b.fill || a.fill || C.brass) : S.fill || 'rgba(233,237,241,.05)';
      if (barness > 0) ctx.globalAlpha = alpha * (0.35 + 0.5 * barness);
      roundRect(ctx, x, y, Math.max(2, wd), Math.max(2, ht), 3); ctx.fill();
      ctx.globalAlpha = alpha;
      const ring = lerpRing(a.ring, b.ring, t);
      if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (barness < 0.5 && S.cells) {
        ctx.globalAlpha = alpha * (1 - barness * 2);
        const cw = (S.cw || CW) * sx;
        S.cells.forEach((c, k) => {
          const bad = S.bad === k, good = S.good === k;
          text(ctx, c, x + k * cw + 6, y + ht / 2 + 4, { size: 11.5, mono: true, weight: S.head ? 700 : 500, color: S.head ? C.brassHi : bad || c === 'NaN' ? C.red : good ? C.green : C.ink });
        });
      }
      if (barness > 0.5 && S.bar) {
        ctx.globalAlpha = alpha * (barness - 0.5) * 2;
        text(ctx, S.bar, x + wd / 2, 250 * sy + 16, { size: 10.5, color: C.dim, align: 'center' });
        text(ctx, String(S.val), x + wd / 2, y - 5, { size: 10.5, color: C.ink, align: 'center', mono: true });
      }
      ctx.globalAlpha = 1;
    }
    // join link
    const link = (t < 0.5 ? A : B).link;
    if (link) {
      const [p, q2] = link.map(id => (t < 0.5 ? A : B).items.find(i => i.id === id));
      if (p && q2) { ctx.strokeStyle = C.glow; ctx.lineWidth = 2; ctx.shadowColor = C.glow; ctx.shadowBlur = 8; ctx.beginPath(); ctx.moveTo((p.x + p.w) * sx, (p.y + 10) * sy); ctx.bezierCurveTo((p.x + p.w + 14) * sx, (p.y + 10) * sy, (q2.x - 14) * sx, (q2.y + 10) * sy, q2.x * sx, (q2.y + 10) * sy); ctx.stroke(); ctx.shadowBlur = 0; }
    }
    ctx.restore();
  };
  const lerpRing = (a, b, t) => (t < 0.5 ? a : b);

  controls(host, [{ key: 'kind', type: 'select', value: kind, options: [['filter', 'WHERE, ORDER BY, LIMIT'], ['group', 'Group by and aggregate'], ['join', 'Join two tables'], ['clean', 'Clean messy data'], ['chart', 'From table to chart']], onChange: v => { kind = v; tl.set(framesFor()); } }]);
  const tl = timeline(host, st, { frames: framesFor(), draw, speed: 0.8 });
}
