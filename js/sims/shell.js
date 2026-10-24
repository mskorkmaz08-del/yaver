// Shell workshop: a folder tree with a "you are here" marker that glides as commands run,
// and a pipeline where lines of a log flow through grep, sort and uniq one stage at a time.
export default function shell(host, { mode, kit }) {
  const { stage, text, roundRect, controls, timeline, C, lerp } = kit;
  let kind = mode === 'pipes' ? 'pipes' : 'tree';
  const st = stage(host, { height: 300 });

  // ---------- tree ----------
  const TREE_STEPS = (() => {
    const F = [];
    let tree = [
      { p: '~', d: 0, dir: 1 }, { p: '~/Desktop', d: 1, dir: 1 }, { p: '~/Documents', d: 1, dir: 1 }, { p: '~/Documents/cv.pdf', d: 2 },
      { p: '~/projects', d: 1, dir: 1 }, { p: '~/projects/learning-log', d: 2, dir: 1 }, { p: '~/projects/learning-log/README.md', d: 3 },
    ];
    const snap = (cwd, cmd, out, hl) => F.push({ tree: tree.map(n => ({ ...n })), cwd, cmd, out, hl });
    const add = (n, after) => { const i = tree.findIndex(x => x.p === after); tree.splice(i + 1, 0, n); };
    snap('~', 'pwd', '/Users/mustafa');
    snap('~', 'ls', 'Desktop  Documents  projects', ['~/Desktop', '~/Documents', '~/projects']);
    snap('~/projects', 'cd projects', '');
    snap('~/projects', 'mkdir yaver-notes', '', ['~/projects/yaver-notes']);
    add({ p: '~/projects/yaver-notes', d: 2, dir: 1, born: 1 }, '~/projects/learning-log/README.md');
    F[F.length - 1].tree = tree.map(n => ({ ...n }));
    snap('~/projects/yaver-notes', 'cd yaver-notes', '');
    add({ p: '~/projects/yaver-notes/day1.md', d: 3, born: 1 }, '~/projects/yaver-notes');
    snap('~/projects/yaver-notes', 'touch day1.md', '', ['~/projects/yaver-notes/day1.md']);
    snap('~/projects', 'cd ..', '');
    snap('~/projects/learning-log', 'cd learning-log', '');
    snap('~/projects/learning-log', 'ls -a', '.  ..  .git  README.md', ['~/projects/learning-log/README.md']);
    snap('~', 'cd ~', '');
    return F;
  })();

  function drawTree(ctx, w, h, A, B, t) {
    const S = t < 0.5 ? A : B, rowH = 22, top = 22;
    const ids = S.tree.map(n => n.p);
    const yOf = (F, p) => { const i = F.tree.findIndex(n => n.p === p); return i < 0 ? null : top + i * rowH; };
    // the "you are here" marker glides between folders
    const ya = yOf(A, A.cwd), yb = yOf(B, B.cwd);
    const my = lerp(ya, yb, t);
    const da = A.tree.find(n => n.p === A.cwd).d, db = B.tree.find(n => n.p === B.cwd).d;
    const mx = 14 + lerp(da, db, t) * 18;
    ctx.fillStyle = 'rgba(127,230,247,.12)'; roundRect(ctx, mx - 6, my - 15, w - mx - 4, rowH - 2, 4); ctx.fill();
    ctx.strokeStyle = C.glow; ctx.lineWidth = 1; ctx.stroke();
    ids.forEach((p, i) => {
      const n = S.tree[i];
      const yA = yOf(A, p), y = yA == null ? top + i * rowH : lerp(yA, top + i * rowH, t);
      const appear = yA == null ? t : 1;
      const x = 14 + n.d * 18;
      ctx.globalAlpha = appear;
      // tree lines
      if (n.d) { ctx.strokeStyle = C.faint; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 11, y - 14); ctx.lineTo(x - 11, y - 4); ctx.lineTo(x - 3, y - 4); ctx.stroke(); }
      const name = p === '~' ? '~  (home)' : p.split('/').pop() + (n.dir ? '/' : '');
      const hl = S.hl?.includes(p);
      if (n.dir) { ctx.fillStyle = hl ? C.amber : C.brass; roundRect(ctx, x, y - 12, 13, 10, 2); ctx.fill(); ctx.fillRect(x, y - 14, 6, 3); }
      else { ctx.strokeStyle = hl ? C.amber : C.dim; ctx.lineWidth = 1.2; roundRect(ctx, x + 2, y - 14, 9, 12, 1); ctx.stroke(); }
      text(ctx, name, x + 19, y - 3, { size: 12.5, color: hl ? C.amber : n.dir ? C.ink : C.dim, mono: true, weight: hl ? 700 : 500 });
      ctx.globalAlpha = 1;
    });
    text(ctx, 'you are here', w - 14, my - 3, { size: 11, color: C.glow, align: 'right', italic: true });
    terminal(ctx, w, h, S.cwd, S.cmd, S.out);
  }

  // ---------- pipes ----------
  const LOG = ['INFO start', 'ERROR disk', 'INFO save', 'ERROR net', 'WARN slow', 'ERROR disk', 'INFO stop', 'ERROR disk', 'ERROR net'].map((t, i) => ({ id: i, t }));
  const PIPE_STEPS = (() => {
    const F = [];
    const grep = LOG.filter(l => l.t.startsWith('ERROR'));
    const sorted = [...grep].sort((a, b) => a.t.localeCompare(b.t) || a.id - b.id);
    const groups = [];
    sorted.forEach(l => { const g = groups.find(x => x.t === l.t); g ? g.n++ : groups.push({ id: l.id, t: l.t, n: 1 }); });
    const counted = groups.map(g => ({ id: g.id, t: `${String(g.n).padStart(3)} ${g.t}` }));
    const top = [...counted].sort((a, b) => parseInt(b.t) - parseInt(a.t));
    F.push({ cmd: 'cat app.log', left: [], right: LOG, note: 'cat prints the file: nine lines' });
    F.push({ cmd: 'cat app.log | grep ERROR', left: LOG, right: grep, drop: true, note: 'grep keeps only the lines containing ERROR' });
    F.push({ cmd: '… | grep ERROR | sort', left: grep, right: sorted, note: 'sort puts equal lines next to each other' });
    F.push({ cmd: '… | sort | uniq -c', left: sorted, right: counted, fold: true, note: 'uniq -c folds neighbouring repeats into one line with a count' });
    F.push({ cmd: '… | uniq -c | sort -rn', left: counted, right: top, note: 'sort -rn: most frequent first. Disk errors are the problem' });
    return F;
  })();

  function drawPipes(ctx, w, h, A, B, t) {
    const S = t < 0.5 ? A : B, rowH = 21, top = 40, colW = (w - 44) / 2, lx = 12, rx = 32 + colW;
    text(ctx, 'input', lx, 22, { size: 11.5, color: C.dim, italic: true });
    text(ctx, 'output', rx, 22, { size: 11.5, color: C.dim, italic: true });
    // pipe in the middle
    ctx.strokeStyle = C.brass; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lx + colW + 4, top + 60); ctx.lineTo(rx - 4, top + 60); ctx.stroke();
    text(ctx, '|', (lx + colW + rx) / 2, top + 52, { size: 16, color: C.brassHi, align: 'center', mono: true, weight: 700 });
    const line = (x, y, s, a, col) => { ctx.globalAlpha = a; ctx.fillStyle = 'rgba(216,246,251,.06)'; roundRect(ctx, x, y - 14, colW, rowH - 3, 3); ctx.fill(); ctx.save(); ctx.beginPath(); ctx.rect(x, y - 14, colW, rowH); ctx.clip(); text(ctx, s, x + 5, y, { size: 11.5, color: col, mono: true }); ctx.restore(); ctx.globalAlpha = 1; };
    // Going from A to B: first A's output slides over to become the input, then B's output
    // comes out of the pipe. Lines the command drops stay behind, faded.
    const yAt = i => top + i * rowH;
    if (A === B || t >= 0.5) {
      const k = A === B ? 1 : (t - 0.5) * 2;
      B.left.forEach((l, i) => line(lx, yAt(i), l.t, B.right.some(r => r.id === l.id) || k < 0.3 ? 1 : 0.35, C.ink));
      B.right.forEach((r, i) => {
        const j = B.left.findIndex(l => l.id === r.id);
        const sy = j >= 0 ? yAt(j) : yAt(i);
        line(lerp(lx, rx, k), lerp(sy, yAt(i), k), r.t, Math.min(1, k * 1.5 + (j >= 0 ? 0.3 : 0)), r.t.includes('ERROR') ? C.amber : C.ink);
      });
    } else {
      const k = t * 2;
      A.left.forEach((l, i) => line(lx, yAt(i), l.t, (A.right.some(r => r.id === l.id) ? 1 : 0.35) * (1 - k), C.ink));
      A.right.forEach((r, i) => line(lerp(rx, lx, k), yAt(i), r.t, 1, r.t.includes('ERROR') ? C.amber : C.ink));
    }
    terminal(ctx, w, h, '~/logs', S.cmd, `${S.right.length} line${S.right.length === 1 ? '' : 's'} out`);
  }

  function terminal(ctx, w, h, cwd, cmd, out) {
    const ty = h - 54;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; roundRect(ctx, 8, ty, w - 16, 46, 4); ctx.fill();
    text(ctx, `${cwd.replace(/^~\/projects\//, '…/')} $ ${cmd}`, 16, ty + 18, { size: 11.5, color: C.green, mono: true });
    if (out) text(ctx, out, 16, ty + 36, { size: 11.5, color: C.ink, mono: true });
  }

  const draw = (ctx, w, h, A, B, t) => (kind === 'tree' ? drawTree(ctx, w, h, A, B, t) : drawPipes(ctx, w, h, A, B, t));
  controls(host, [{ key: 'kind', type: 'select', value: kind, options: [['tree', 'Moving around folders'], ['pipes', 'Pipes: | grep | sort | uniq']], onChange: v => { kind = v; tl.set(kind === 'tree' ? TREE_STEPS : PIPE_STEPS); } }]);
  const tl = timeline(host, st, { frames: kind === 'tree' ? TREE_STEPS : PIPE_STEPS, draw, speed: 0.7, label: f => f.note || `<code>${f.cmd}</code>` });
}
