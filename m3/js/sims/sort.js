// Sorting engine: watch selection, insertion, quick and merge sort move the bars,
// with comparisons and swaps counted. Scrub back and forth through every step.
export default function sort(host, { mode, kit }) {
  const { stage, text, roundRect, controls, timeline, C, lerp } = kit;
  const st = stage(host, { height: 250 });
  let algo = ['selection', 'insertion', 'quick', 'merge'].includes(mode) ? mode : 'selection';
  let n = 14;

  const shuffled = () => {
    const a = Array.from({ length: n }, (_, i) => ({ id: i, v: 1 + Math.round(((i + 1) / n) * 98) }));
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  function run(start) {
    const a = start.slice(), frames = [];
    let cmp = 0, sw = 0;
    const snap = (marks = {}, note = '', sorted = new Set()) => frames.push({ order: a.map(x => x.id), vals: Object.fromEntries(a.map(x => [x.id, x.v])), marks, note, cmp, sw, sorted: new Set(sorted) });
    const done = new Set();
    snap({}, 'Unsorted');
    if (algo === 'selection') {
      for (let i = 0; i < a.length; i++) {
        let m = i;
        for (let j = i + 1; j < a.length; j++) { cmp++; snap({ [a[j].id]: 'cmp', [a[m].id]: 'min' }, `Looking for the smallest from position ${i}`, done); if (a[j].v < a[m].v) m = j; }
        if (m !== i) { [a[i], a[m]] = [a[m], a[i]]; sw++; }
        done.add(a[i].id);
        snap({ [a[i].id]: 'swap' }, `Smallest goes to position ${i}`, done);
      }
    } else if (algo === 'insertion') {
      for (let i = 1; i < a.length; i++) {
        let j = i;
        while (j > 0) { cmp++; snap({ [a[j].id]: 'key', [a[j - 1].id]: 'cmp' }, `Sliding ${a[j].v} left into the sorted part`, done); if (a[j - 1].v <= a[j].v) break; [a[j], a[j - 1]] = [a[j - 1], a[j]]; sw++; j--; }
      }
      a.forEach(x => done.add(x.id));
    } else if (algo === 'quick') {
      const qs = (lo, hi) => {
        if (lo > hi) return;
        if (lo === hi) { done.add(a[lo].id); return; }
        const p = a[hi];
        let i = lo;
        for (let j = lo; j < hi; j++) {
          cmp++; snap({ [p.id]: 'pivot', [a[j].id]: 'cmp', ...(i < hi ? { [a[i].id]: a[i].id === a[j].id ? 'cmp' : 'wall' } : {}) }, `Pivot ${p.v}: smaller values go left of the wall`, done);
          if (a[j].v < p.v) { [a[i], a[j]] = [a[j], a[i]]; sw++; i++; }
        }
        [a[i], a[hi]] = [a[hi], a[i]]; sw++;
        done.add(a[i].id);
        snap({ [a[i].id]: 'pivot' }, `Pivot ${p.v} is in its final place`, done);
        qs(lo, i - 1); qs(i + 1, hi);
      };
      qs(0, a.length - 1);
    } else {
      const ms = (lo, hi) => {
        if (hi - lo < 1) return;
        const mid = (lo + hi) >> 1;
        ms(lo, mid); ms(mid + 1, hi);
        // merge by moving each next-smallest element into place
        let i = lo, j = mid + 1;
        while (i <= j - 1 && j <= hi) {
          cmp++;
          snap({ [a[i].id]: 'cmp', [a[j].id]: 'cmp' }, `Merging ${lo}–${mid} with ${mid + 1}–${hi}`, done);
          if (a[i].v <= a[j].v) i++;
          else { const x = a.splice(j, 1)[0]; a.splice(i, 0, x); sw++; i++; j++; }
        }
        if (lo === 0 && hi === a.length - 1) a.forEach(x => done.add(x.id));
      };
      ms(0, a.length - 1);
    }
    a.forEach(x => done.add(x.id));
    snap({}, `Sorted: ${cmp} comparisons, ${sw} ${algo === 'merge' ? 'moves' : 'swaps'}`, done);
    return frames;
  }

  const COLORS = { cmp: C.glow, min: C.amber, swap: C.green, key: C.amber, pivot: C.red, wall: C.violet };
  const draw = (ctx, w, h, A, B, t) => {
    const pad = 16, top = 40, base = h - 26, bw = (w - pad * 2) / n;
    const posA = Object.fromEntries(A.order.map((id, i) => [id, i])), posB = Object.fromEntries(B.order.map((id, i) => [id, i]));
    for (const id of A.order) {
      const i = lerp(posA[id], posB[id], t);
      const v = A.vals[id];
      const x = pad + i * bw + 2, bh = ((base - top) * v) / 100;
      const mark = (t < 0.5 ? A : B).marks[id];
      const sorted = (t < 0.5 ? A : B).sorted.has(id);
      const g = ctx.createLinearGradient(x, base - bh, x + bw, base);
      const col = mark ? COLORS[mark] : sorted ? '#5fbf9a' : C.brass;
      g.addColorStop(0, col); g.addColorStop(1, sorted && !mark ? '#2f6e5a' : mark ? col : '#7a5622');
      ctx.fillStyle = g;
      if (mark) { ctx.shadowColor = col; ctx.shadowBlur = 10; }
      roundRect(ctx, x, base - bh, bw - 4, bh, 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (bw > 16) text(ctx, String(v), x + (bw - 4) / 2, base + 14, { size: 11, color: C.dim, align: 'center', mono: true });
    }
    text(ctx, `${algo} sort`, 14, 22, { size: 15, color: C.brassHi, weight: 600 });
    text(ctx, `comparisons ${B.cmp}   ${algo === 'merge' ? 'moves' : 'swaps'} ${B.sw}`, w - 14, 22, { size: 12, color: C.dim, align: 'right', mono: true });
  };

  controls(host, [
    { key: 'algo', type: 'select', value: algo, options: [['selection', 'Selection sort'], ['insertion', 'Insertion sort'], ['quick', 'Quicksort'], ['merge', 'Merge sort']], onChange: v => { algo = v; reset(); } },
    { key: 'n', type: 'slider', label: 'items', min: 6, max: 32, value: n, onInput: v => { n = v; reset(); } },
    { key: 'shuffle', label: 'Shuffle', onClick: () => reset() },
  ]);
  let data = shuffled();
  const tl = timeline(host, st, { frames: run(data), draw, speed: 3 });
  function reset() { data = shuffled(); tl.set(run(data)); }
}
