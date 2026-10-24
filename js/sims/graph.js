// Graph explorer: breadth-first and depth-first search spreading through a graph you can
// drag around, Dijkstra settling the shortest distances, and a binary search tree growing.
export default function graph(host, { mode, kit }) {
  const { stage, text, controls, timeline, C, lerp, clamp } = kit;
  const st = stage(host, { height: 290 });
  let kind = ['bfs', 'dfs', 'dijkstra', 'bst'].includes(mode) ? mode : 'bfs';

  // A fixed little map (positions in 0..1), edges with weights for Dijkstra.
  const NODES = [[0.1, 0.5], [0.28, 0.2], [0.3, 0.78], [0.5, 0.45], [0.55, 0.12], [0.62, 0.82], [0.75, 0.38], [0.9, 0.18], [0.9, 0.7]];
  const EDGES = [[0, 1, 4], [0, 2, 2], [1, 3, 5], [2, 3, 1], [1, 4, 6], [3, 4, 3], [2, 5, 7], [3, 6, 2], [4, 7, 4], [6, 7, 1], [5, 8, 3], [6, 8, 5], [3, 5, 4]];
  const pos = NODES.map(([x, y]) => ({ x, y }));
  const adj = NODES.map((_, i) => EDGES.filter(e => e[0] === i || e[1] === i).map(e => ({ to: e[0] === i ? e[1] : e[0], w: e[2] })).sort((a, b) => a.to - b.to));
  const label = i => String.fromCharCode(65 + i);

  function framesFor() {
    const F = [];
    if (kind === 'bfs' || kind === 'dfs') {
      const seen = new Set([0]), order = [], edges = [];
      const box = [0];
      F.push({ seen: new Set(seen), order: [], edges: [], box: [...box], cur: null, note: kind === 'bfs' ? 'Start at A; the queue holds what to visit next' : 'Start at A; the stack holds what to visit next' });
      while (box.length) {
        const u = kind === 'bfs' ? box.shift() : box.pop();
        if (kind === 'dfs' && order.includes(u)) continue;
        order.push(u);
        F.push({ seen: new Set(seen), order: [...order], edges: [...edges], box: [...box], cur: u, note: `Visit ${label(u)}` });
        const next = kind === 'bfs' ? adj[u] : [...adj[u]].reverse();
        for (const { to } of next) {
          if (kind === 'bfs' ? seen.has(to) : order.includes(to)) continue;
          if (kind === 'bfs') seen.add(to);
          box.push(to);
          edges.push([u, to]);
          F.push({ seen: new Set(kind === 'bfs' ? seen : [...order, ...box]), order: [...order], edges: [...edges], box: [...box], cur: u, note: `${kind === 'bfs' ? 'Queue' : 'Push'} ${label(to)}` });
        }
      }
      F.push({ seen: new Set(order), order, edges, box: [], cur: null, note: `Order: ${order.map(label).join(' → ')}` });
    } else if (kind === 'dijkstra') {
      const dist = NODES.map(() => Infinity), done = new Set(), prev = [];
      dist[0] = 0;
      F.push({ dist: [...dist], done: new Set(), cur: null, prev: [], note: 'Distances start at ∞, except A = 0' });
      while (done.size < NODES.length) {
        let u = -1;
        dist.forEach((d, i) => { if (!done.has(i) && (u < 0 || d < dist[u])) u = i; });
        if (dist[u] === Infinity) break;
        done.add(u);
        F.push({ dist: [...dist], done: new Set(done), cur: u, prev: [...prev], note: `Settle ${label(u)} at ${dist[u]}: nothing can reach it cheaper` });
        for (const { to, w } of adj[u]) {
          if (done.has(to)) continue;
          if (dist[u] + w < dist[to]) {
            dist[to] = dist[u] + w; prev[to] = u;
            F.push({ dist: [...dist], done: new Set(done), cur: u, relax: [u, to], prev: [...prev], note: `${label(to)}: ${dist[u]} + ${w} = ${dist[to]}, better than before` });
          }
        }
      }
      F.push({ dist, done, cur: null, prev, note: 'Every shortest distance from A is final' });
    } else {
      const vals = [50, 30, 70, 20, 40, 60, 80, 35, 65, 45];
      const tree = [];
      const place = (v) => {
        if (!tree.length) { tree.push({ v, x: 0.5, y: 0, d: 0, parent: -1 }); return [0]; }
        let i = 0; const path = [0];
        for (;;) {
          const n = tree[i], side = v < n.v ? 'l' : 'r';
          if (n[side] === undefined) { const d = n.d + 1; tree.push({ v, x: n.x + (side === 'l' ? -1 : 1) * 0.5 / 2 ** d, y: d, d, parent: i }); n[side] = tree.length - 1; path.push(tree.length - 1); return path; }
          i = n[side]; path.push(i);
        }
      };
      F.push({ tree: [], path: [], note: 'Insert numbers: smaller go left, larger go right' });
      for (const v of vals) {
        const snapshot = tree.map(n => ({ ...n }));
        const path = place(v);
        path.slice(0, -1).forEach((p, k) => F.push({ tree: snapshot, path: path.slice(0, k + 1), ins: v, note: `Insert ${v}: ${v} ${v < snapshot[p].v ? '<' : '>'} ${snapshot[p].v}, go ${v < snapshot[p].v ? 'left' : 'right'}` }));
        F.push({ tree: tree.map(n => ({ ...n })), path, ins: v, note: `${v} placed at depth ${tree[path.at(-1)].d}` });
      }
      const inorder = [];
      const walk = i => { if (i === undefined) return; walk(tree[i].l); inorder.push(i); walk(tree[i].r); };
      walk(0);
      inorder.forEach((i, k) => F.push({ tree: tree.map(n => ({ ...n })), path: inorder.slice(0, k + 1), note: `In-order walk: ${inorder.slice(0, k + 1).map(j => tree[j].v).join(', ')}` }));
    }
    return F;
  }

  const P = (i, w, h) => ({ x: 26 + pos[i].x * (w - 52), y: 46 + pos[i].y * (h - 92) });
  const node = (ctx, x, y, r, fill, ring, txt, sub) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = ring; ctx.stroke();
    text(ctx, txt, x, y + 5, { size: 14, color: C.ink, align: 'center', weight: 600 });
    if (sub !== undefined) text(ctx, sub, x, y - r - 6, { size: 12, color: C.amber, align: 'center', mono: true });
  };
  const draw = (ctx, w, h, A, B, t) => {
    const F = t < 0.5 ? A : B;
    if (kind === 'bst') return drawTree(ctx, w, h, A, B, t);
    for (const [a, b, wt] of EDGES) {
      const p = P(a, w, h), q = P(b, w, h);
      const hot = F.edges?.some(([u, v]) => (u === a && v === b) || (u === b && v === a)) || (F.prev && (F.prev[b] === a || F.prev[a] === b) && F.done?.has(a) && F.done?.has(b));
      const relax = F.relax && ((F.relax[0] === a && F.relax[1] === b) || (F.relax[0] === b && F.relax[1] === a));
      ctx.strokeStyle = relax ? C.amber : hot ? C.glow : C.faint; ctx.lineWidth = hot || relax ? 3 : 1.5;
      if (hot) { ctx.shadowColor = C.glow; ctx.shadowBlur = 8; }
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.shadowBlur = 0;
      if (kind === 'dijkstra') text(ctx, String(wt), (p.x + q.x) / 2 + 6, (p.y + q.y) / 2 - 4, { size: 11.5, color: C.brassHi, mono: true });
    }
    // the visit ripple travels with the step
    NODES.forEach((_, i) => {
      const { x, y } = P(i, w, h);
      const visited = F.order?.includes(i) || F.done?.has(i);
      const queued = F.box?.includes(i);
      const cur = F.cur === i;
      const pulse = cur ? 1 + 0.12 * Math.sin(t * Math.PI) : 1;
      node(ctx, x, y, 15 * pulse, visited ? 'rgba(63,182,201,.45)' : queued ? 'rgba(231,176,75,.3)' : C.bg, cur ? C.amber : visited ? C.glow : C.brass, label(i), kind === 'dijkstra' ? (F.dist[i] === Infinity ? '∞' : String(F.dist[i])) : undefined);
    });
    if (F.box) text(ctx, `${kind === 'bfs' ? 'queue' : 'stack'}: [ ${F.box.map(label).join(', ')} ]`, 14, h - 14, { size: 13, color: C.amber, mono: true });
    text(ctx, { bfs: 'Breadth-first search', dfs: 'Depth-first search', dijkstra: 'Dijkstra from A' }[kind], 14, 22, { size: 15, color: C.brassHi, weight: 600 });
    text(ctx, 'drag the nodes', w - 14, 22, { size: 12, color: C.faint, align: 'right', italic: true });
  };
  const drawTree = (ctx, w, h, A, B, t) => {
    const F = t < 0.5 ? A : B, T = F.tree;
    const xy = n => ({ x: 20 + n.x * (w - 40), y: 50 + n.d * ((h - 80) / 4) });
    T.forEach(n => { if (n.parent >= 0) { const a = xy(T[n.parent]), b = xy(n); ctx.strokeStyle = C.brass; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } });
    T.forEach((n, i) => { const p = xy(n); const on = F.path?.includes(i); node(ctx, p.x, p.y, 15, on ? 'rgba(63,182,201,.45)' : C.bg, on ? C.glow : C.brass, String(n.v)); });
    if (F.ins !== undefined && F.path?.length) {
      const last = T[F.path.at(-1)] ? xy(T[F.path.at(-1)]) : { x: w / 2, y: 50 };
      const prevP = A.path?.length && A.tree[A.path.at(-1)] ? xy(A.tree[A.path.at(-1)]) : last;
      const x = lerp(prevP.x, last.x, t) + 22, y = lerp(prevP.y, last.y, t) - 18;
      ctx.fillStyle = 'rgba(231,176,75,.9)'; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
      text(ctx, String(F.ins), x, y + 4, { size: 11, color: '#14120e', align: 'center', weight: 700 });
    }
    text(ctx, 'Binary search tree', 14, 22, { size: 15, color: C.brassHi, weight: 600 });
  };

  // drag nodes around
  let drag = -1;
  st.pointer({
    down: p => { if (kind === 'bst') return; drag = NODES.findIndex((_, i) => { const q = P(i, st.w, st.h); return Math.hypot(q.x - p.x, q.y - p.y) < 24; }); },
    move: (p, down) => { if (!down || drag < 0) return; pos[drag].x = clamp((p.x - 26) / (st.w - 52), 0, 1); pos[drag].y = clamp((p.y - 46) / (st.h - 92), 0, 1); tl.kick(); },
    up: () => { drag = -1; },
  });
  controls(host, [{ key: 'kind', type: 'select', value: kind, options: [['bfs', 'Breadth-first search'], ['dfs', 'Depth-first search'], ['dijkstra', 'Dijkstra'], ['bst', 'Binary search tree']], onChange: v => { kind = v; tl.set(framesFor()); } }]);
  const tl = timeline(host, st, { frames: framesFor(), draw, speed: 1.3 });
}
