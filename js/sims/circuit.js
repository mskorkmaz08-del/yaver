// Circuit bench: live circuits with flowing charge, meters and parts that react
// (LEDs glow and burn out, resistors heat, capacitors charge, a motor spins).
export default function circuit(host, { mode, kit }) {
  const { stage, plate, text, roundRect, gauge, loop, controls, caption, C, clamp, fmt } = kit;
  const st = stage(host, { height: 300 });
  const s = { V: 9, R: 330, R2: 470, C: 100, rating: 0.25, on: true, diode: true, burnt: false, t: 0, vc: 0, phase: 0, flow: 0, flow2: 0, angle: 0, spark: 0, sub: 'blink', btn: false, pot: 0.5, delay: 500, base: 4.7 };
  const MODES = {
    ohm: 'Ohm’s law: I = V ÷ R', series: 'Series: one path, the current is the same everywhere', parallel: 'Parallel: each branch takes its own current',
    divider: 'Voltage divider: Vout = V × R2 ÷ (R1 + R2)', led: 'LED with a current-limiting resistor', rc: 'RC charging: 63% at one time constant (τ = R·C)',
    transistor: 'NPN transistor as a switch', power: 'Power: P = V × I, and the resistor’s rating', arduino: 'Arduino pin 13',
  };
  // ---------- circuit maths ----------
  const solve = () => {
    const { V, R, R2 } = s;
    if (mode === 'series' || mode === 'divider') { const I = V / (R + R2); return { I, V1: I * R, V2: I * R2 }; }
    if (mode === 'parallel') { const I1 = V / R, I2 = V / R2; return { I: I1 + I2, I1, I2 }; }
    if (mode === 'led') { const I = s.burnt ? 0 : Math.max(0, (V - 2) / R); return { I, VR: I * R, P: I * I * R }; }
    if (mode === 'transistor') {
      const Ib = s.on ? Math.max(0, (5 - 0.7) / (s.base * 1000)) : 0;
      const Ic = Math.min(Ib * 100, V / 60);
      return { Ib, I: Ic };
    }
    if (mode === 'rc') { const I = s.on ? Math.max(0, (V - s.vc) / (R * 1000)) : 0; return { I }; }
    const I = V / R;
    return { I, P: V * I };
  };

  // ---------- drawing helpers ----------
  const wire = pts => { st.ctx.strokeStyle = C.brass; st.ctx.lineWidth = 2.2; st.ctx.lineJoin = 'round'; st.ctx.beginPath(); pts.forEach(([x, y], i) => (i ? st.ctx.lineTo(x, y) : st.ctx.moveTo(x, y))); st.ctx.stroke(); };
  const polyLen = pts => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  const along = (pts, d) => {
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], L = Math.hypot(x2 - x1, y2 - y1);
      if (d <= L) return [x1 + ((x2 - x1) * d) / L, y1 + ((y2 - y1) * d) / L];
      d -= L;
    }
    return pts[pts.length - 1];
  };
  // Charge carriers: glowing dots spaced along the path, moving with the current.
  const charges = (pts, offset, amount) => {
    if (amount <= 0) return;
    const L = polyLen(pts), gap = 16, ctx = st.ctx;
    ctx.fillStyle = C.glow;
    ctx.shadowColor = C.glow; ctx.shadowBlur = 6;
    for (let d = offset % gap; d < L; d += gap) { const [x, y] = along(pts, d); ctx.globalAlpha = clamp(0.35 + amount, 0.35, 1); ctx.beginPath(); ctx.arc(x, y, 2.3, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  };
  const battery = (x, y, h, label) => {
    const ctx = st.ctx;
    ctx.fillStyle = C.bg; ctx.fillRect(x - 14, y - h / 2, 28, h);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5;
    for (let i = 0; i < 2; i++) {
      const yy = y - 10 + i * 14;
      ctx.beginPath(); ctx.moveTo(x - 13, yy); ctx.lineTo(x + 13, yy); ctx.stroke();
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 7, yy + 6); ctx.lineTo(x + 7, yy + 6); ctx.stroke(); ctx.lineWidth = 2.5;
    }
    text(ctx, '+', x + 16, y - 12, { size: 13, color: C.red });
    text(ctx, label, x - 20, y + 4, { size: 13, color: C.brassHi, align: 'right', mono: true });
  };
  const resistor = (x1, y1, x2, y2, label, heat = 0) => {
    const ctx = st.ctx, L = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1);
    ctx.save(); ctx.translate(x1, y1); ctx.rotate(a);
    const bw = Math.min(54, L * 0.6), bx = (L - bw) / 2;
    ctx.fillStyle = C.bg; ctx.fillRect(bx - 2, -9, bw + 4, 18);
    ctx.strokeStyle = heat > 0.05 ? `rgb(${236},${Math.round(200 - heat * 140)},${Math.round(150 - heat * 120)})` : C.ink;
    if (heat > 0.05) { ctx.shadowColor = C.red; ctx.shadowBlur = 14 * heat; }
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, 0);
    for (let i = 0; i <= 6; i++) ctx.lineTo(bx + (bw / 6) * i, i === 0 || i === 6 ? 0 : i % 2 ? -7 : 7);
    ctx.stroke(); ctx.shadowBlur = 0;
    ctx.restore();
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, vertical = Math.abs(y2 - y1) > Math.abs(x2 - x1);
    const onRight = mx > st.w * 0.6;
    text(ctx, label, mx + (vertical ? (onRight ? -14 : 14) : 0), my + (vertical ? 4 : -14), { size: 12.5, color: C.brassHi, align: vertical ? (onRight ? 'right' : 'left') : 'center', mono: true });
  };
  const led = (x, y, bright, burnt) => {
    const ctx = st.ctx;
    if (bright > 0.02 && !burnt) {
      const g = ctx.createRadialGradient(x, y, 2, x, y, 18 + 30 * bright);
      g.addColorStop(0, `rgba(255,120,90,${0.9 * bright})`); g.addColorStop(1, 'rgba(255,90,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 18 + 30 * bright, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = burnt ? '#3a3a3a' : `rgb(${Math.round(120 + 135 * bright)},${Math.round(50 + 60 * bright)},${Math.round(40 + 40 * bright)})`;
    ctx.beginPath(); ctx.moveTo(x - 9, y - 9); ctx.lineTo(x - 9, y + 9); ctx.lineTo(x + 7, y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 8, y - 9); ctx.lineTo(x + 8, y + 9); ctx.stroke();
    if (burnt) text(ctx, 'burnt out', x, y + 26, { size: 13, color: C.red, align: 'center', italic: true });
  };
  const meterRow = items => {
    const n = items.length, r = clamp(st.w / (n * 4.2), 18, 28), y = st.h - r - 26;
    items.forEach(([v, max, label, unit, color], i) => gauge(st.ctx, (st.w / n) * (i + 0.5), y, r, v, max, label, unit, color));
  };

  // ---------- frame ----------
  const frame = dt => {
    const { ctx, w, h } = st;
    plate(ctx, w, h);
    const r = solve();
    s.t += dt;
    const speed = I => clamp(I * 900, 0, 260); // px/s for the charge carriers
    s.flow += speed(r.I) * dt;
    const top = 50, bot = h - 104, left = 46, right = w - 30;
    text(ctx, MODES[mode], 14, 20, { size: 13, color: C.dim, italic: true });
    if (mode === 'arduino') return arduino(dt);
    if (mode === 'parallel') {
      const mid = (left + right) / 2;
      const main = [[left, (top + bot) / 2 + 22], [left, bot], [right, bot], [right, top], [left, top], [left, (top + bot) / 2 - 22]];
      wire(main); wire([[mid, top], [mid, bot]]);
      s.flow2 += speed(r.I2) * dt;
      charges([[left, top], [mid, top], [mid, bot], [left, bot]], s.flow * (r.I1 / r.I), r.I1 * 30);
      charges([[mid, top], [right, top], [right, bot], [mid, bot]], s.flow2, r.I2 * 30);
      battery(left, (top + bot) / 2, 46, `${s.V} V`);
      resistor(mid, top + 8, mid, bot - 8, `R1 ${s.R}Ω`);
      resistor(right, top + 8, right, bot - 8, `R2 ${s.R2}Ω`);
      meterRow([[r.I * 1000, 120, 'I total', 'mA', C.glow], [r.I1 * 1000, 120, 'I1', 'mA', C.glow], [r.I2 * 1000, 120, 'I2', 'mA', C.glow]]);
      return true;
    }
    const loopPts = [[left, (top + bot) / 2 - 22], [left, top], [right, top], [right, bot], [left, bot], [left, (top + bot) / 2 + 22]];
    wire(loopPts);
    charges(loopPts, s.flow, r.I * 40);
    battery(left, (top + bot) / 2, 46, `${s.V} V`);
    const third = (right - left) / 3;
    if (mode === 'series' || mode === 'divider') {
      resistor(left + 14, top, left + third * 1.5, top, `R1 ${s.R}Ω`);
      resistor(right, top + 10, right, bot - 10, `R2 ${s.R2}Ω`);
      if (mode === 'divider') { ctx.setLineDash([4, 4]); ctx.strokeStyle = C.glow; ctx.beginPath(); ctx.moveTo(right, top + 4); ctx.lineTo(right - 30, top + 4); ctx.moveTo(right, bot - 4); ctx.lineTo(right - 30, bot - 4); ctx.stroke(); ctx.setLineDash([]); text(ctx, 'Vout', right - 34, (top + bot) / 2, { size: 13, color: C.glow, align: 'right' }); }
      meterRow([[r.I * 1000, 50, 'I', 'mA'], [r.V1, 12, 'V1', 'V', C.amber], [r.V2, 12, mode === 'divider' ? 'Vout' : 'V2', 'V', C.amber]]);
    } else if (mode === 'led') {
      resistor(left + 14, top, left + third * 1.6, top, `${s.R}Ω`);
      led(right, (top + bot) / 2, clamp(r.I / 0.02, 0, 1.2), s.burnt);
      if (!s.burnt && r.I > 0.03) { s.burnt = true; navigator.vibrate?.(30); burnBtn.el.hidden = false; }
      meterRow([[r.I * 1000, 40, 'I', 'mA', r.I > 0.025 ? C.red : C.glow], [r.VR, 12, 'V across R', 'V', C.amber], [2, 5, 'V LED', 'V', C.amber]]);
    } else if (mode === 'rc') {
      const tau = (s.R * 1000 * s.C * 1e-6); // seconds (real)
      // Shown at real speed, kept between 0.4 s and 4 s per τ so it stays watchable.
      s.vc += ((s.on ? s.V : 0) - s.vc) * (1 - Math.exp(-dt / clamp(tau, 0.4, 4)));
      resistor(left + 14, top, left + third * 1.5, top, `${s.R}kΩ`);
      // capacitor plates with charge
      const cx = right, cy = (top + bot) / 2;
      ctx.fillStyle = C.bg; ctx.fillRect(cx - 18, cy - 8, 36, 16);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - 16, cy - 5); ctx.lineTo(cx + 16, cy - 5); ctx.moveTo(cx - 16, cy + 5); ctx.lineTo(cx + 16, cy + 5); ctx.stroke();
      const q = s.vc / Math.max(1, s.V);
      for (let i = 0; i < Math.round(q * 6); i++) { text(ctx, '+', cx - 14 + i * 5.5, cy - 9, { size: 10, color: C.red }); text(ctx, '−', cx - 14 + i * 5.5, cy + 16, { size: 10, color: C.glow }); }
      text(ctx, `${s.C}µF`, cx + 22, cy + 4, { size: 12.5, color: C.brassHi, mono: true });
      // chart of Vc against time
      hist.push(s.vc); if (hist.length > 240) hist.shift();
      const gx = left + 20, gy = top + 34, gw = third * 1.9 - 24, gh = bot - top - 54;
      ctx.strokeStyle = C.faint; ctx.strokeRect(gx, gy, gw, gh);
      ctx.strokeStyle = C.glow; ctx.lineWidth = 2; ctx.beginPath();
      hist.forEach((v, i) => { const x = gx + (i / 240) * gw, y = gy + gh - (v / 12) * gh; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      const y63 = gy + gh - (0.632 * s.V / 12) * gh;
      ctx.setLineDash([3, 4]); ctx.strokeStyle = C.amber; ctx.beginPath(); ctx.moveTo(gx, y63); ctx.lineTo(gx + gw, y63); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, '63%', gx + gw - 2, y63 - 4, { size: 11, color: C.amber, align: 'right' });
      meterRow([[s.vc, 12, 'Vc', 'V', C.glow], [r.I * 1000, Math.max(1, s.V / s.R), 'I', 'mA'], [tau, 2, 'τ = RC', 's', C.amber]]);
    } else if (mode === 'transistor') {
      // load (a motor) on the right, transistor bottom right, base switch
      resistor(left + 14, top, left + third * 1.4, top, 'load');
      const mx = right, my = (top + bot) / 2;
      s.angle += r.I * 3000 * dt;
      ctx.save(); ctx.translate(mx, my); ctx.rotate(s.angle);
      ctx.strokeStyle = C.brass; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 3; i++) { ctx.rotate((Math.PI * 2) / 3); ctx.beginPath(); ctx.ellipse(0, -9, 4, 9, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,181,71,.6)'; ctx.fill(); }
      ctx.restore();
      text(ctx, 'M', mx + 24, my + 5, { size: 14, color: C.brassHi });
      // the transistor symbol on the bottom wire
      const tx = left + third * 1.8, ty = bot;
      ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(tx, ty, 16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = s.on ? C.glow : C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, 16, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx - 5, ty - 9); ctx.lineTo(tx - 5, ty + 9); ctx.moveTo(tx - 5, ty - 3); ctx.lineTo(tx + 10, ty - 12); ctx.moveTo(tx - 5, ty + 3); ctx.lineTo(tx + 10, ty + 12); ctx.moveTo(tx - 5, ty); ctx.lineTo(tx - 22, ty + 26); ctx.stroke();
      text(ctx, s.on ? 'base on' : 'base off', tx - 24, ty + 40, { size: 12.5, color: s.on ? C.glow : C.dim, align: 'center' });
      if (s.spark > 0) { s.spark -= dt; ctx.strokeStyle = `rgba(255,240,180,${s.spark * 3})`; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28; ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(a) * 34, my + Math.sin(a) * 34); } ctx.stroke(); text(ctx, 'voltage spike: add a flyback diode', mx - 10, my - 32, { size: 12.5, color: C.red, align: 'right', italic: true }); }
      meterRow([[r.Ib * 1000, 2, 'Ib', 'mA', C.amber], [r.I * 1000, 200, 'Ic', 'mA'], [r.Ib ? r.I / r.Ib : 0, 120, 'gain', '×', C.amber]]);
    } else {
      const P = r.P ?? s.V * r.I;
      const heat = mode === 'power' ? clamp((P - s.rating) / s.rating, 0, 1) : 0;
      resistor(right, top + 10, right, bot - 10, `${s.R}Ω`, heat);
      if (mode === 'power' && P > s.rating) text(ctx, `over its ${s.rating} W rating`, right - 12, top + 22, { size: 13, color: C.red, align: 'right', italic: true });
      meterRow(mode === 'power' ? [[s.V, 12, 'V', 'V', C.amber], [r.I * 1000, 120, 'I', 'mA'], [P, 1, 'P', 'W', P > s.rating ? C.red : C.glow]] : [[s.V, 12, 'V', 'V', C.amber], [r.I * 1000, 120, 'I', 'mA'], [s.R, 1000, 'R', 'Ω', C.brassHi]]);
    }
    return true;
  };
  const hist = [];

  // ---------- Arduino ----------
  const PROGRAMS = {
    blink: () => [`void loop() {`, `  digitalWrite(13, HIGH);`, `  delay(${s.delay});`, `  digitalWrite(13, LOW);`, `  delay(${s.delay});`, `}`],
    button: () => [`pinMode(2, INPUT_PULLUP);`, `void loop() {`, `  int pressed = digitalRead(2) == LOW;`, `  digitalWrite(13, pressed);`, `}`],
    analog: () => [`void loop() {`, `  int v = analogRead(A0);    // 0–1023`, `  analogWrite(9, v / 4);     // 0–255`, `}`],
  };
  function arduino(dt) {
    const { ctx, w, h } = st;
    let ledOn = 0, line = 0;
    if (s.sub === 'blink') { s.phase += dt * 1000; const per = s.delay * 2; const p = s.phase % per; ledOn = p < s.delay ? 1 : 0; line = p < 30 ? 1 : p < s.delay ? 2 : p < s.delay + 30 ? 3 : 4; }
    else if (s.sub === 'button') { ledOn = s.btn ? 1 : 0; line = 2 + Math.floor((s.t * 4) % 2); }
    else { ledOn = s.pot; line = 1 + Math.floor((s.t * 4) % 2); }
    // board
    const bx = 14, by = 34, bw = Math.min(170, w * 0.46), bh = h - 70;
    roundRect(ctx, bx, by, bw, bh, 8); ctx.fillStyle = '#1b4e6b'; ctx.fill(); ctx.strokeStyle = C.brass; ctx.lineWidth = 1.5; ctx.stroke();
    for (let i = 0; i < 14; i++) { ctx.fillStyle = '#0b1a22'; ctx.fillRect(bx + 10 + i * ((bw - 20) / 14), by + 6, 6, 8); }
    text(ctx, 'pin 13', bx + bw - 12, by + 30, { size: 11, color: C.ink, align: 'right', mono: true });
    roundRect(ctx, bx + bw * 0.28, by + bh * 0.42, bw * 0.44, bh * 0.22, 3); ctx.fillStyle = '#0b1a22'; ctx.fill();
    text(ctx, 'ATmega', bx + bw / 2, by + bh * 0.55, { size: 11, color: C.dim, align: 'center', mono: true });
    // LED on a wire from pin 13
    const lx = bx + bw + 46, ly = by + 40;
    wire([[bx + bw - 14, by + 10], [bx + bw - 14, by - 8], [lx, by - 8], [lx, ly - 12]]);
    led(lx, ly, ledOn, false);
    if (s.sub === 'button') {
      const bx2 = lx, by2 = ly + 70;
      roundRect(ctx, bx2 - 18, by2 - 18, 36, 36, 6); ctx.fillStyle = s.btn ? C.brass : '#2a2f36'; ctx.fill(); ctx.strokeStyle = C.brass; ctx.stroke();
      text(ctx, s.btn ? 'pressed' : 'tap', bx2, by2 + 34, { size: 12.5, color: C.dim, align: 'center' });
      btnRect = [bx2 - 18, by2 - 18, 36, 36];
    } else if (s.sub === 'analog') {
      const px = lx, py = ly + 76;
      ctx.strokeStyle = C.brass; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(px, py, 20, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
      const a = Math.PI * (0.75 + 1.5 * s.pot);
      ctx.strokeStyle = C.glow; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * 18, py + Math.sin(a) * 18); ctx.stroke();
      text(ctx, `A0 = ${Math.round(s.pot * 1023)}`, px, py + 38, { size: 12.5, color: C.glow, align: 'center', mono: true });
      btnRect = [px - 26, py - 26, 52, 52];
    } else btnRect = null;
    // code with the running line lit
    const code = PROGRAMS[s.sub]();
    const cx = Math.min(w - 10, lx + 70), cy = by + 4;
    code.forEach((ln, i) => {
      if (cx > w - 60) return;
      if (i === line) { ctx.fillStyle = 'rgba(127,178,217,.14)'; ctx.fillRect(cx - 6, cy + i * 19 - 13, w - cx - 4, 18); }
      text(ctx, ln, cx, cy + i * 19, { size: 11.5, color: i === line ? C.glow : C.dim, mono: true });
    });
    if (cx > w - 60) code.forEach((ln, i) => { if (i === line) text(ctx, ln.trim(), w - 12, h - 14, { size: 11.5, color: C.glow, align: 'right', mono: true }); });
    return true;
  }
  let btnRect = null;
  st.pointer({
    down: p => {
      if (mode === 'arduino' && btnRect && p.x >= btnRect[0] && p.x <= btnRect[0] + btnRect[2] && p.y >= btnRect[1] && p.y <= btnRect[1] + btnRect[3]) { if (s.sub === 'button') s.btn = true; dragPot = s.sub === 'analog'; navigator.vibrate?.(6); }
      if (mode === 'transistor') toggleBase();
    },
    move: (p, down) => { if (dragPot && down && btnRect) { const a = Math.atan2(p.y - (btnRect[1] + 26), p.x - (btnRect[0] + 26)); let t = ((a / Math.PI - 0.75 + 4) % 2) / 1.5; s.pot = clamp(t > 1.17 ? 0 : t, 0, 1); } },
    up: () => { s.btn = false; dragPot = false; },
  });
  let dragPot = false;
  const toggleBase = () => { s.on = !s.on; if (!s.on && !s.diode) s.spark = 0.5; kick(); };

  // ---------- controls ----------
  const items = [];
  if (mode === 'arduino') {
    items.push({ key: 'sub', type: 'select', value: s.sub, options: [['blink', 'Blink'], ['button', 'Button + pull-up'], ['analog', 'Potentiometer + PWM']], onChange: v => { s.sub = v; s.phase = 0; kick(); } });
    items.push({ key: 'd', type: 'slider', label: 'delay', min: 100, max: 1500, step: 50, value: s.delay, format: v => `${v} ms`, onInput: v => { s.delay = v; } });
  } else {
    items.push({ key: 'v', type: 'slider', label: 'V', min: mode === 'transistor' ? 3 : 0, max: 12, step: 0.5, value: s.V, format: v => `${v} V`, onInput: v => { s.V = v; kick(); } });
    if (mode === 'rc') {
      items.push({ key: 'r', type: 'slider', label: 'R', min: 1, max: 100, value: 10, format: v => `${v} kΩ`, onInput: v => { s.R = v; } });
      items.push({ key: 'c', type: 'slider', label: 'C', min: 10, max: 470, step: 10, value: 100, format: v => `${v} µF`, onInput: v => { s.C = v; } });
      items.push({ key: 'sw', label: 'Discharge', onClick: b => { s.on = !s.on; b.textContent = s.on ? 'Discharge' : 'Charge'; } });
      s.R = 10;
    } else if (mode === 'transistor') {
      items.push({ key: 'b', type: 'slider', label: 'Rb', min: 1, max: 47, step: 0.1, value: s.base, format: v => `${v} kΩ`, onInput: v => { s.base = v; } });
      items.push({ key: 'sw', label: 'Toggle base', primary: true, onClick: toggleBase });
      items.push({ key: 'd', label: 'Flyback diode: on', onClick: b => { s.diode = !s.diode; b.textContent = `Flyback diode: ${s.diode ? 'on' : 'off'}`; } });
    } else {
      items.push({ key: 'r', type: 'slider', label: mode === 'ohm' || mode === 'led' || mode === 'power' ? 'R' : 'R1', min: 10, max: 1000, step: 10, value: s.R, format: v => `${v} Ω`, onInput: v => { s.R = v; kick(); } });
      if (['series', 'parallel', 'divider'].includes(mode)) items.push({ key: 'r2', type: 'slider', label: 'R2', min: 10, max: 1000, step: 10, value: s.R2, format: v => `${v} Ω`, onInput: v => { s.R2 = v; kick(); } });
      if (mode === 'power') items.push({ key: 'rt', type: 'select', value: '0.25', options: [['0.125', '⅛ W resistor'], ['0.25', '¼ W resistor'], ['0.5', '½ W resistor'], ['1', '1 W resistor']], onChange: v => { s.rating = Number(v); } });
    }
  }
  controls(host, items);
  const burnBtn = controls(host, [{ key: 'reset', label: 'Fit a new LED', onClick: b => { s.burnt = false; b.hidden = true; } }]).reset;
  burnBtn.el.hidden = true;
  caption(host, {
    ohm: 'Slide the voltage and resistance: the dots are the charge moving, faster when more current flows.',
    series: 'Both resistors share one current; the voltage splits in proportion to their resistance.',
    parallel: 'Each branch has the full voltage; the smaller resistor takes more current.',
    divider: 'Make R2 bigger and watch Vout climb towards the supply.',
    led: 'Turn the resistor down far enough and the LED burns out at about 30 mA.',
    rc: 'Tap Discharge and Charge: the curve is exponential, 63% of the way at τ = R·C.',
    transistor: 'Tap the stage or Toggle base. Turn the flyback diode off and switch the motor off to see the spike.',
    power: 'Raise the voltage until the resistor runs over its rating and starts to glow.',
    arduino: 'The highlighted line is the one running. Try the button and the potentiometer (drag the knob).',
  }[mode]);
  const kick = loop(host, st, frame);
}
