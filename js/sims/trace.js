// Code tracer: runs the lesson's Python example in the browser (Pyodide, loaded on the first
// tap) and records every line it executes with the variables and printed output at that
// moment. The timeline then walks through the run: a brass bar slides to each line, changed
// variables light up and the output tape grows.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let loading = null;

function loadPy() {
  if (loading) return loading;
  const base = window.YAVER_PYODIDE || PYODIDE;
  loading = new Promise((ok, bad) => {
    const go = () => window.loadPyodide({ indexURL: base }).then(async py => { await py.runPythonAsync(TRACER); ok(py); }, bad);
    if (window.loadPyodide) return go();
    const s = document.createElement('script');
    s.src = base + 'pyodide.js';
    s.onload = go;
    s.onerror = () => bad(new Error('Python could not be downloaded. Check the connection and try again.'));
    document.head.append(s);
  }).catch(e => { loading = null; throw e; });
  return loading;
}

const TRACER = `
import sys, io, json, types
def __yaver_trace(src, inputs):
    steps, out, err = [], io.StringIO(), None
    feed = iter(inputs)
    def fake_input(prompt=''):
        v = next(feed, '3')
        out.write(str(prompt) + v + '\\n')
        return v
    def fake_print(*a, **k):
        k.pop('file', None)
        print(*a, file=out, **k)
    g = {'__name__': '__main__', 'input': fake_input, 'print': fake_print}
    hide = set(g)
    def show(v):
        r = repr(v)
        return r if len(r) <= 44 else r[:41] + '...'
    def snap(frame):
        res = {}
        for k, v in list(frame.f_locals.items()):
            if k.startswith('__') or k in hide: continue
            if isinstance(v, (types.ModuleType, types.FunctionType, type)): continue
            res[k] = show(v)
        return res
    def depth(frame):
        d = 0
        while frame and frame.f_code.co_filename == '<lesson>':
            d += 1; frame = frame.f_back
        return d
    def tr(frame, event, arg):
        if frame.f_code.co_filename != '<lesson>': return None
        if event in ('line', 'return'):
            if len(steps) >= 400: raise RuntimeError('stopped after 400 steps')
            st = {'line': frame.f_lineno, 'ev': event, 'fn': frame.f_code.co_name, 'depth': depth(frame), 'vars': snap(frame), 'out': out.getvalue()}
            if event == 'return' and frame.f_code.co_name != '<module>': st['ret'] = show(arg)
            if event == 'line' or st.get('ret') is not None: steps.append(st)
        return tr
    try:
        code = compile(src, '<lesson>', 'exec')
        sys.settrace(tr)
        exec(code, g)
    except BaseException as e:
        err = type(e).__name__ + ': ' + str(e)
    finally:
        sys.settrace(None)
    return json.dumps({'steps': steps, 'error': err, 'out': out.getvalue()})
`;

export default function trace(host, { code, kit }) {
  const { stage, plate, text, roundRect, controls, caption, timeline, C, lerp } = kit;
  let src = (code || 'total = 0\nfor n in range(1, 5):\n    total = total + n\n    print(n, total)\nprint("done", total)').replace(/\t/g, '    ');
  const lines = () => src.split('\n');
  const LH = 17, TOPC = 16;
  const height = () => Math.min(460, Math.max(240, TOPC + Math.min(lines().length, 16) * LH + 150));
  const st = stage(host, { height: height() });
  let run = null, tl = null, status = 'idle', message = '';

  const editor = document.createElement('textarea');
  editor.className = 'sim-code';
  editor.spellcheck = false; editor.hidden = true; editor.value = src;
  editor.setAttribute('autocapitalize', 'off');
  const inputs = document.createElement('input');
  inputs.className = 'sim-inputs'; inputs.placeholder = 'answers for input(), comma-separated'; inputs.value = '5, 3';
  inputs.hidden = !/input\(/.test(src);

  // ---------- drawing ----------
  function drawCode(ctx, w, h, A, B, t) {
    const L = lines();
    const visible = Math.min(L.length, 16);
    const codeH = visible * LH;
    const la = A ? A.line : 0, lb = B ? B.line : la;
    const cur = lerp(la, lb, t);
    const first = Math.max(0, Math.min(L.length - visible, Math.round(cur) - Math.floor(visible / 2)));
    // brass bar on the current line
    if (A) {
      const y = TOPC + (cur - 1 - first) * LH;
      ctx.fillStyle = 'rgba(231,176,75,.18)'; roundRect(ctx, 8, y - 1, w - 16, LH, 3); ctx.fill();
      ctx.fillStyle = C.amber; ctx.fillRect(8, y - 1, 3, LH);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(0, TOPC - 2, w, codeH + 4); ctx.clip();
    L.slice(first, first + visible).forEach((ln, i) => {
      const n = first + i + 1;
      text(ctx, String(n), 30, TOPC + i * LH + 12, { size: 10.5, color: C.faint, align: 'right', mono: true });
      text(ctx, ln, 38, TOPC + i * LH + 12, { size: 11.5, color: Math.round(cur) === n && A ? C.brassHi : C.ink, mono: true });
    });
    ctx.restore();
    return TOPC + codeH + 8;
  }

  function drawState(ctx, w, h, y0, A, B, t) {
    const S = t < 0.5 ? A : B;
    ctx.strokeStyle = 'rgba(217,181,108,.35)'; ctx.beginPath(); ctx.moveTo(10, y0); ctx.lineTo(w - 10, y0); ctx.stroke();
    // variables
    let x = 12, y = y0 + 10;
    const prev = A && B && t >= 0.5 ? A.vars : null;
    const vars = Object.entries(S.vars || {});
    if (S.fn && S.fn !== '<module>') { text(ctx, `in ${S.fn}()${S.depth > 2 ? ` · depth ${S.depth - 1}` : ''}`, w - 12, y0 + 14, { size: 11, color: C.violet, align: 'right', italic: true }); }
    if (!vars.length) text(ctx, 'no variables yet', 12, y + 14, { size: 12, color: C.dim, italic: true });
    ctx.font = `500 11.5px ${kit.MONO}`;
    for (const [k, v] of vars) {
      const label = `${k} = ${v}`;
      const wd = Math.min(w - 24, ctx.measureText(label).width + 16);
      if (x + wd > w - 12) { x = 12; y += 26; }
      if (y > h - 70) break;
      const changed = prev && prev[k] !== v;
      const glow = changed ? 1 - Math.min(1, (t - 0.5) * 2) * 0.6 : 0;
      ctx.fillStyle = changed ? `rgba(127,230,247,${0.12 + 0.3 * glow})` : 'rgba(216,246,251,.06)';
      roundRect(ctx, x, y, wd, 21, 4); ctx.fill();
      ctx.strokeStyle = changed ? C.glow : 'rgba(217,181,108,.4)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, wd, 21); ctx.clip();
      text(ctx, label, x + 8, y + 15, { size: 11.5, color: changed ? C.glow : C.ink, mono: true });
      ctx.restore();
      x += wd + 6;
    }
    if (S.ret !== undefined) text(ctx, `returns ${S.ret}`, w - 12, y + 40, { size: 11.5, color: C.amber, align: 'right', mono: true });
    // output tape
    const out = (S.out || '').split('\n').filter((l, i, a) => l || i < a.length - 1);
    const ty = h - 58;
    ctx.fillStyle = '#e9dfc6'; roundRect(ctx, 10, ty, w - 20, 48, 3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.12)'; for (let px = 18; px < w - 16; px += 14) { ctx.beginPath(); ctx.arc(px, ty + 4, 1.4, 0, Math.PI * 2); ctx.fill(); }
    const last = out.slice(-2);
    if (!last.length) text(ctx, 'output appears here', 18, ty + 30, { size: 12, color: '#8a7f68', italic: true });
    last.forEach((l, i) => text(ctx, l, 18, ty + 22 + i * 16, { size: 12, color: '#2c4a7a', mono: true }));
  }

  function idle() {
    const { ctx, w, h } = st;
    plate(ctx, w, h);
    const y = drawCode(ctx, w, h, null, null, 0);
    ctx.strokeStyle = 'rgba(217,181,108,.35)'; ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(w - 10, y); ctx.stroke();
    const msg = status === 'loading' ? 'Starting Python… (a one-time download)' : status === 'error' ? message : 'Tap Trace to run it line by line';
    text(ctx, msg, 14, y + 26, { size: 13, color: status === 'error' ? C.red : C.dim, italic: true });
  }

  const draw = (ctx, w, h, A, B, t) => {
    const y = drawCode(ctx, w, h, A, B, t);
    drawState(ctx, w, h, y, A, B, t);
  };

  async function go() {
    src = editor.value.replace(/\t/g, '    ');
    status = 'loading'; idle();
    try {
      const py = await loadPy();
      try { await py.loadPackagesFromImports(src); } catch { /* the run reports a missing module */ }
      const answers = inputs.value.split(',').map(s => s.trim()).filter(Boolean);
      const fn = py.globals.get('__yaver_trace');
      const res = JSON.parse(fn(src, py.toPy(answers)));
      fn.destroy?.();
      run = res;
      if (res.error) res.steps.push({ ...(res.steps.at(-1) || { line: 1, vars: {} }), out: (res.steps.at(-1)?.out || '') + res.error, err: true });
      else if (res.steps.length) res.steps.push({ ...res.steps.at(-1), out: res.out, ret: undefined, fn: '<module>', done: true });
      if (!res.steps.length) res.steps.push({ line: 1, vars: {}, out: res.out });
      status = 'ran';
      if (!tl) {
        tl = timeline(stepsHost, st, { frames: res.steps, draw, speed: 1.6, label: f => (f.err ? `<span style="color:#b33">${esc(res.error)}</span>` : f.done ? 'finished' : `line ${f.line}${f.ret !== undefined ? `: returns ${esc(f.ret)}` : ''}`) });
      } else tl.set(res.steps);
    } catch (e) {
      status = 'error'; message = e.message || String(e); idle();
    }
  }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const ui = controls(host, [
    { key: 'go', label: 'Trace', primary: true, onClick: go },
    { key: 'edit', label: 'Edit code', onClick: b => { editor.hidden = !editor.hidden; b.textContent = editor.hidden ? 'Edit code' : 'Hide editor'; if (!editor.hidden) editor.focus(); } },
  ]);
  ui.go.el.parentElement.after(editor, inputs);
  editor.addEventListener('input', () => { src = editor.value; if (status !== 'ran') idle(); });
  const stepsHost = document.createElement('div');
  host.append(stepsHost);
  caption(host, 'Your own copy: edit the code and trace again. Python runs on this phone; nothing is sent anywhere.');
  idle();
  new ResizeObserver(() => { if (status !== 'ran') idle(); }).observe(st.wrap);
}
