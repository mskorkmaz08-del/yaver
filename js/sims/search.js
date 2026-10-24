// Search rig: binary search halving the range, two pointers closing in from both ends,
// and a sliding window gliding along the array. Pointers move smoothly between steps.
export default function search(host, { mode, kit }) {
  const { stage, text, roundRect, controls, timeline, C, lerp } = kit;
  const st = stage(host, { height: 230 });
  let kind = ['binary', 'twopointers', 'window'].includes(mode) ? mode : 'binary';
  let target = 0, k = 3;
  let arr = [];
  const sortedArr = () => { const s = new Set(); while (s.size < 15) s.add(2 + Math.floor(Math.random() * 60)); return [...s].sort((a, b) => a - b); };
  const randArr = () => Array.from({ length: 14 }, () => 1 + Math.floor(Math.random() * 9));

  function framesFor() {
    const F = [];
    if (kind === 'binary') {
      let lo = 0, hi = arr.length - 1, steps = 0;
      F.push({ p: { lo, hi }, range: [lo, hi], note: `Looking for ${target} in ${arr.length} sorted numbers` });
      while (lo <= hi) {
        const mid = (lo + hi) >> 1; steps++;
        F.push({ p: { lo, hi, mid }, range: [lo, hi], note: `Step ${steps}: check the middle, ${arr[mid]}` });
        if (arr[mid] === target) { F.push({ p: { mid }, range: [mid, mid], found: mid, note: `Found ${target} in ${steps} steps (a linear scan needs up to ${arr.length})` }); return F; }
        if (arr[mid] < target) lo = mid + 1; else hi = mid - 1;
        F.push({ p: { lo, hi, mid }, range: [lo, hi], note: arr[mid] < target ? `${arr[mid]} < ${target}: drop the left half` : `${arr[mid]} > ${target}: drop the right half` });
      }
      F.push({ p: { lo, hi }, range: [lo, lo - 1], note: `${target} isn't there: ${steps} steps, about log₂(${arr.length}) ≈ ${Math.ceil(Math.log2(arr.length))}` });
    } else if (kind === 'twopointers') {
      let L = 0, R = arr.length - 1;
      while (L < R) {
        const s = arr[L] + arr[R];
        F.push({ p: { L, R }, range: [L, R], note: `${arr[L]} + ${arr[R]} = ${s}${s === target ? ' ✓' : s < target ? ' too small: move L right' : ' too big: move R left'}` });
        if (s === target) { F.push({ p: { L, R }, range: [L, R], found: [L, R], note: `Pair found: ${arr[L]} + ${arr[R]} = ${target}` }); return F; }
        if (s < target) L++; else R--;
      }
      F.push({ p: { L, R }, range: [L, R], note: `No pair adds up to ${target}` });
    } else {
      let sum = 0, best = -1, bestAt = 0;
      for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
        if (i >= k) sum -= arr[i - k];
        if (i >= k - 1) {
          const at = i - k + 1;
          if (sum > best) { best = sum; bestAt = at; }
          F.push({ win: at, range: [at, i], note: `Window ${at}–${i}: add ${arr[i]}${i >= k ? `, drop ${arr[i - k]}` : ''} → sum ${sum}`, best, bestAt });
        }
      }
      F.push({ win: bestAt, range: [bestAt, bestAt + k - 1], found: true, note: `Best window of ${k}: sum ${best}, found in one pass`, best, bestAt });
    }
    return F;
  }

  const draw = (ctx, w, h, A, B, t) => {
    const n = arr.length, pad = 12, cw = Math.min(46, (w - pad * 2) / n), x0 = (w - cw * n) / 2, y = 92, ch = cw * 0.95;
    const F = t < 0.5 ? A : B;
    for (let i = 0; i < n; i++) {
      const inRange = i >= F.range[0] && i <= F.range[1];
      const hit = F.found !== undefined && (F.found === i || (Array.isArray(F.found) && F.found.includes(i)) || (F.found === true && inRange));
      roundRect(ctx, x0 + i * cw + 2, y, cw - 4, ch, 3);
      ctx.fillStyle = hit ? 'rgba(127,210,138,.35)' : inRange ? 'rgba(217,181,108,.22)' : 'rgba(216,246,251,.04)';
      ctx.fill();
      ctx.strokeStyle = hit ? C.green : inRange ? C.brass : C.faint; ctx.lineWidth = 1.2; ctx.stroke();
      text(ctx, String(arr[i]), x0 + i * cw + cw / 2, y + ch / 2 + 5, { size: Math.min(16, cw * 0.42), color: inRange ? C.ink : C.dim, align: 'center', mono: true });
      if (cw > 24) text(ctx, String(i), x0 + i * cw + cw / 2, y - 6, { size: 10, color: C.faint, align: 'center', mono: true });
    }
    // pointers glide between steps
    const ptr = (name, row, color) => {
      const a = A.p?.[name], b = B.p?.[name];
      if (a === undefined && b === undefined) return;
      const i = lerp(a ?? b, b ?? a, t);
      const x = x0 + i * cw + cw / 2, yy = y + ch + 12 + row * 26;
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, yy - 10); ctx.lineTo(x - 6, yy); ctx.lineTo(x + 6, yy); ctx.closePath(); ctx.fill();
      text(ctx, name, x, yy + 14, { size: 13, color, align: 'center', weight: 600 });
    };
    if (kind === 'binary') { ptr('lo', 0, C.teal); ptr('hi', 0, C.violet); ptr('mid', 1, C.amber); }
    if (kind === 'twopointers') { ptr('L', 0, C.teal); ptr('R', 0, C.violet); }
    if (kind === 'window' && A.win !== undefined) {
      const at = lerp(A.win, B.win ?? A.win, t);
      ctx.strokeStyle = C.glow; ctx.lineWidth = 2.5; ctx.shadowColor = C.glow; ctx.shadowBlur = 10;
      roundRect(ctx, x0 + at * cw - 1, y - 5, cw * k + 2, ch + 10, 6); ctx.stroke(); ctx.shadowBlur = 0;
      text(ctx, `best so far ${F.best}`, w - 14, h - 18, { size: 13, color: C.amber, align: 'right', mono: true });
    }
    text(ctx, { binary: `binary search for ${target}`, twopointers: `two numbers that add to ${target}`, window: `largest sum of ${k} in a row` }[kind], 14, 24, { size: 15, color: C.brassHi, weight: 600 });
  };

  const ui = controls(host, [
    { key: 'kind', type: 'select', value: kind, options: [['binary', 'Binary search'], ['twopointers', 'Two pointers'], ['window', 'Sliding window']], onChange: v => { kind = v; reset(); } },
    { key: 'target', type: 'slider', label: 'target', min: 2, max: 120, value: 30, onInput: v => { target = v; tl.set(framesFor()); } },
    { key: 'new', label: 'New numbers', onClick: () => reset() },
  ]);
  function reset() {
    arr = kind === 'window' ? randArr() : sortedArr();
    target = kind === 'binary' ? arr[Math.floor(Math.random() * arr.length)] : kind === 'twopointers' ? arr[2] + arr[arr.length - 4] : 0;
    ui.target.el.closest('label').hidden = kind === 'window';
    ui.target.el.max = kind === 'binary' ? 62 : 120;
    ui.target.set(target);
    tl.set(framesFor());
  }
  arr = kind === 'window' ? randArr() : sortedArr();
  target = kind === 'binary' ? arr[9] : arr[2] + arr[arr.length - 4];
  ui.target.set(target);
  ui.target.el.closest('label').hidden = kind === 'window';
  const tl = timeline(host, st, { frames: framesFor(), draw, speed: 1.2 });
}
