// Branch loom: a commit graph you drive with buttons. Commit, branch, switch and merge, and
// watch commits pop onto their branch's thread, labels slide forward and merges tie threads.
export default function git(host, { kit }) {
  const { stage, plate, text, roundRect, loop, controls, caption, C, lerp, ease } = kit;
  const st = stage(host, { height: 270 });
  const LANES = { main: 0 }, COLORS = [C.amber, C.glow, C.violet, C.green, C.red];
  let commits, branches, head, nextLane, log, counter, anim;

  function reset() {
    commits = [{ id: 'a1f', parents: [], lane: 0, msg: 'first notes', born: 1 }, { id: 'b72', parents: ['a1f'], lane: 0, msg: 'add week 1', born: 1 }];
    branches = { main: 'b72' }; head = 'main'; nextLane = 1; counter = 0;
    for (const k of Object.keys(LANES)) if (k !== 'main') delete LANES[k];
    log = ['git init', 'git commit -m "first notes"', 'git commit -m "add week 1"'];
    anim = { labels: {} };
    kick();
  }
  const hash = () => (Math.random().toString(16) + '000').slice(2, 5);
  const MSGS = ['fix typo', 'add quiz', 'new lesson', 'refactor', 'add test', 'update readme', 'try idea'];
  function commit() {
    const id = hash();
    commits.push({ id, parents: [branches[head]], lane: LANES[head], msg: MSGS[counter++ % MSGS.length], born: 0 });
    branches[head] = id;
    say(`git commit -m "${commits.at(-1).msg}"`);
  }
  function branch() {
    const names = ['feature', 'experiment', 'fix', 'idea'];
    const name = names.find(n => !(n in branches));
    if (!name) return say('# enough branches for now');
    LANES[name] = nextLane++;
    branches[name] = branches[head];
    head = name;
    say(`git switch -c ${name}`);
  }
  function switchTo() {
    const names = Object.keys(branches);
    head = names[(names.indexOf(head) + 1) % names.length];
    say(`git switch ${head}`);
  }
  const ancestors = id => { const out = new Set(), stack = [id]; while (stack.length) { const c = stack.pop(); if (out.has(c)) continue; out.add(c); stack.push(...commits.find(x => x.id === c).parents); } return out; };
  function merge() {
    const others = Object.keys(branches).filter(b => b !== head && branches[b] !== branches[head]);
    if (!others.length) return say('# nothing to merge: switch to a branch with new commits');
    const other = others.find(b => !ancestors(branches[head]).has(branches[b])) || others[0];
    const mine = branches[head], theirs = branches[other];
    if (ancestors(mine).has(theirs)) return say(`git merge ${other}   # already up to date`);
    if (ancestors(theirs).has(mine)) { branches[head] = theirs; return say(`git merge ${other}   # fast-forward: ${head} just slides up`); }
    const id = hash();
    commits.push({ id, parents: [mine, theirs], lane: LANES[head], msg: `merge ${other}`, born: 0, merge: true });
    branches[head] = id;
    say(`git merge ${other}   # a merge commit ties both lines`);
  }
  function say(cmd) { log.push(cmd); kick(); }

  function draw(ctx, w, h, dt) {
    const sp = 44, left = 26, top = 68, laneH = 44;
    const scroll = Math.max(0, (commits.length - 1) * sp + left + 70 - w);
    anim.scroll = lerp(anim.scroll ?? scroll, scroll, Math.min(1, dt * 6));
    const X = i => left + i * sp - anim.scroll, Y = lane => top + lane * laneH;
    // lane threads
    Object.entries(LANES).forEach(([name, lane]) => {
      ctx.strokeStyle = COLORS[lane % COLORS.length]; ctx.globalAlpha = 0.12; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(0, Y(lane)); ctx.lineTo(w, Y(lane)); ctx.stroke(); ctx.globalAlpha = 1;
    });
    // edges
    commits.forEach((c, i) => c.parents.forEach(pid => {
      const j = commits.findIndex(x => x.id === pid), p = commits[j];
      const k = ease(Math.min(1, c.born));
      ctx.strokeStyle = COLORS[c.lane % COLORS.length]; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(X(j), Y(p.lane));
      const x2 = lerp(X(j), X(i), k), y2 = lerp(Y(p.lane), Y(c.lane), k);
      if (p.lane === c.lane) ctx.lineTo(x2, y2);
      else ctx.bezierCurveTo(X(j) + sp * 0.6, Y(p.lane), x2 - sp * 0.6, y2, x2, y2);
      ctx.stroke();
    }));
    // nodes
    commits.forEach((c, i) => {
      const k = Math.min(1, c.born), r = 9 * (k < 1 ? 1 + 0.4 * Math.sin(k * Math.PI) : 1) * Math.min(1, k * 2);
      const x = X(i), y = Y(c.lane), col = COLORS[c.lane % COLORS.length];
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = C.bg; ctx.fill(); ctx.lineWidth = c.merge ? 4 : 2.5; ctx.strokeStyle = col; ctx.stroke();
      if (Object.values(branches).includes(c.id) && branches[head] === c.id) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
      text(ctx, c.id, x, y + 24, { size: 9.5, color: C.dim, align: 'center', mono: true });
    });
    // branch labels slide to their commit
    Object.entries(branches).forEach(([name, id]) => {
      const i = commits.findIndex(c => c.id === id), c = commits[i];
      const tx = X(i), ty = Y(c.lane) - 22 - (Object.entries(branches).filter(([n, v]) => v === id && n < name).length) * 18;
      const L = anim.labels[name] || (anim.labels[name] = { x: tx, y: ty });
      L.x = lerp(L.x, tx, Math.min(1, dt * 8)); L.y = lerp(L.y, ty, Math.min(1, dt * 8));
      ctx.font = `600 11px ${kit.MONO}`;
      const label = name === head ? `HEAD → ${name}` : name, wd = ctx.measureText(label).width + 12;
      const col = COLORS[LANES[name] % COLORS.length];
      ctx.fillStyle = name === head ? col : 'rgba(12,24,32,.9)';
      roundRect(ctx, L.x - wd / 2, L.y - 12, wd, 17, 8); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
      text(ctx, label, L.x, L.y + 1, { size: 11, color: name === head ? '#14120e' : col, align: 'center', mono: true, weight: 600 });
    });
    // terminal
    const ty = h - 64;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; roundRect(ctx, 8, ty, w - 16, 56, 4); ctx.fill();
    log.slice(-3).forEach((l, i, a) => text(ctx, `$ ${l}`, 16, ty + 16 + i * 16, { size: 11.5, color: i === a.length - 1 ? C.green : C.dim, mono: true }));
    text(ctx, `on branch ${head}`, w - 14, 22, { size: 12, color: C.brassHi, align: 'right', italic: true });
    text(ctx, 'git log --graph', 14, 22, { size: 12, color: C.dim, mono: true });
  }

  let kick = () => {};
  controls(host, [
    { key: 'c', label: 'Commit', primary: true, onClick: commit },
    { key: 'b', label: 'New branch', onClick: branch },
    { key: 's', label: 'Switch', onClick: switchTo },
    { key: 'm', label: 'Merge', onClick: merge },
    { key: 'r', label: 'Reset', onClick: reset },
  ]);
  caption(host, 'Try: New branch, Commit twice, Switch back to main, Commit, then Merge. Labels are just sticky notes on commits; HEAD is where you are.');
  reset();
  kick = loop(host, st, dt => {
    let busy = false;
    commits.forEach(c => { if (c.born < 1) { c.born = Math.min(1, c.born + dt * 2.2); busy = true; } });
    plate(st.ctx, st.w, st.h);
    draw(st.ctx, st.w, st.h, dt || 0.016);
    // labels and scroll ease for a moment after each action
    return busy || anim.settling-- > 0;
  });
  const k0 = kick; kick = () => { anim.settling = 40; k0(); };
  kick();
}
