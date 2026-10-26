// The ?v= number defeats browser caching after an update (GitHub Pages lets
// browsers keep files for 10 minutes). Bump it here and in index.html together.
import { Editor, SHAPES, COLORS } from "./editor.js?v=7";
import { HandTracker } from "./hands.js?v=7";
import { classify } from "./gestures.js?v=7";
import { Hands3D } from "./hand3d.js?v=7";

const STUDIO_VERSION = new URL(import.meta.url).searchParams.get("v") ?? "dev";
document.getElementById("version").textContent = `v${STUDIO_VERSION}`;

const PICK_SLOP = 70;      // px: how close a finger must be to an object to grab it
const ADD_HOLD_MS = 700;   // hold a peace sign this long to add a shape
const DELETE_HOLD_MS = 900; // hold a fist this long to delete
const SMOOTHING = 0.5;     // 0 = no smoothing, closer to 1 = smoother but laggier
const DEPTH_GAIN = 2.2;    // how strongly pushing your hand toward the camera sends objects away
const DEPTH_SMOOTHING = 0.75; // hand size is noisy, so depth gets extra smoothing
const REF_HAND_SIZE = 0.2; // typical hand size on camera at a comfortable reach

const editor = new Editor(document.getElementById("stage"));
const overlay = document.getElementById("hands-overlay");
const ctx = overlay.getContext("2d");
const video = document.getElementById("camera");
const statusEl = document.getElementById("status");
const tracker = new HandTracker(video);
const hands3d = new Hands3D(editor.scene);

window.yaver = { editor }; // handy from the console, and the hook for voice commands later

// ---- Starting scene -------------------------------------------------------

editor.addShape("cube", { x: -1.2, y: 0.5, z: 0 }, COLORS[0]);
editor.addShape("sphere", { x: 1.2, y: 0.5, z: 0 }, COLORS[1]);
editor.select(null);

// ---- Toolbar ---------------------------------------------------------------

const shapesEl = document.getElementById("shapes");
SHAPES.forEach((shape, i) => {
  const b = document.createElement("button");
  b.textContent = `${i + 1} ${shape}`;
  b.dataset.shape = shape;
  b.onclick = () => { setShape(shape); editor.addShape(shape); };
  shapesEl.appendChild(b);
});
function setShape(shape) {
  editor.currentShape = shape;
  shapesEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.shape === shape));
}
setShape("cube");

const colorsEl = document.getElementById("colors");
COLORS.forEach((c) => {
  const b = document.createElement("button");
  b.className = "swatch";
  b.style.background = c;
  b.title = c;
  b.onclick = () => editor.setColor(c);
  colorsEl.appendChild(b);
});
// ---- Help panel --------------------------------------------------------------

const legendEl = document.getElementById("legend");
const legendToggle = document.getElementById("legend-toggle");
function toggleLegend(collapsed = !legendEl.classList.contains("collapsed")) {
  legendEl.classList.toggle("collapsed", collapsed);
  legendToggle.textContent = collapsed ? "Show" : "Hide";
  try { localStorage.setItem("studio-legend-collapsed", collapsed ? "1" : ""); } catch {}
}
legendToggle.onclick = () => toggleLegend();
try { if (localStorage.getItem("studio-legend-collapsed")) toggleLegend(true); } catch {}

// ---- Trash bin ---------------------------------------------------------------

const trashEl = document.getElementById("trash");
trashEl.onclick = () => editor.remove();

function overTrash(x, y) {
  const r = trashEl.getBoundingClientRect();
  const pad = 28; // generous, since a fingertip wobbles more than a mouse
  return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
}

// The bin lights up while something is being dragged, and turns red when the
// dragged object is over it.
function updateTrash() {
  const dragging = [];
  if (mouse?.obj && mouse.pos) dragging.push(mouse.pos);
  if (!twoHand) for (const h of hands.values()) if (h.grab?.obj) dragging.push({ x: h.x, y: h.y });
  trashEl.classList.toggle("armed", dragging.length > 0);
  trashEl.classList.toggle("hot", dragging.some((p) => overTrash(p.x, p.y)));
}

window.addEventListener("keydown", (e) => {
  if (e.key >= "1" && e.key <= String(SHAPES.length)) {
    const shape = SHAPES[Number(e.key) - 1];
    setShape(shape);
    editor.addShape(shape);
  } else if (e.key === "Delete" || e.key === "Backspace") {
    editor.remove();
  } else if (e.key.toLowerCase() === "c") {
    video.classList.toggle("preview");
  } else if (e.key.toLowerCase() === "h") {
    toggleLegend();
  }
});

// ---- Mouse fallback (also useful without a camera) ------------------------

const canvas = editor.renderer.domElement;
let mouse = null;
canvas.addEventListener("pointerdown", (e) => {
  const obj = editor.pickAt(e.clientX, e.clientY);
  editor.select(obj);
  if (obj) {
    const dist = editor.distanceFromCamera(obj.position);
    const offset = obj.position.clone().sub(editor.screenToWorld(e.clientX, e.clientY, dist));
    mouse = { obj, dist, offset };
  } else {
    mouse = { orbit: true, x: e.clientX, y: e.clientY };
  }
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!mouse) {
    editor.setHovered([editor.pickAt(e.clientX, e.clientY), ...handHovered]);
    return;
  }
  if (mouse.obj) {
    mouse.pos = { x: e.clientX, y: e.clientY };
    const p = editor.screenToWorld(e.clientX, e.clientY, mouse.dist).add(mouse.offset);
    p.y = Math.max(p.y, 0);
    mouse.obj.position.copy(p);
  } else {
    editor.orbitBy(-(e.clientX - mouse.x) * 0.006, -(e.clientY - mouse.y) * 0.006);
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (mouse?.obj && overTrash(e.clientX, e.clientY)) editor.remove(mouse.obj);
  mouse = null;
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = Math.exp(e.deltaY * 0.001);
  if (e.shiftKey && editor.selected) {
    editor.setScale(editor.selected, editor.selected.scale.x / factor);
  } else {
    editor.zoomBy(factor);
  }
}, { passive: false });

// ---- Hand control ----------------------------------------------------------

const hands = new Map(); // id -> per-hand state
let handHovered = [];
let twoHand = null;      // active two-hand scale/rotate or zoom

function updateHand(id, raw, now) {
  let h = hands.get(id);
  if (!h) {
    h = { id, lm: raw, gesture: "point", since: now, fired: false, grab: null };
    hands.set(id, h);
  }
  h.lm = raw.map((p, i) => ({
    x: h.lm[i].x * SMOOTHING + p.x * (1 - SMOOTHING),
    y: h.lm[i].y * SMOOTHING + p.y * (1 - SMOOTHING),
    z: p.z,
  }));
  const wasPinching = h.gesture === "pinch";
  const { gesture, cursor, size } = classify(h.lm, wasPinching);
  h.prevGesture = h.gesture;
  if (gesture !== h.gesture) {
    h.gesture = gesture;
    h.since = now;
    h.fired = false;
  }
  h.size = h.size ? h.size * DEPTH_SMOOTHING + size * (1 - DEPTH_SMOOTHING) : size;
  h.x = cursor.x * editor.width;
  h.y = cursor.y * editor.height;
  return h;
}

function startGrab(h) {
  const obj = editor.pickAt(h.x, h.y, PICK_SLOP);
  if (obj) {
    const dist = editor.distanceFromCamera(obj.position);
    const offset = obj.position.clone().sub(editor.screenToWorld(h.x, h.y, dist));
    h.grab = { obj, dist, offset, size0: h.size };
    editor.select(obj);
  } else {
    h.grab = { orbit: true, x: h.x, y: h.y };
  }
}

function moveGrab(h) {
  const g = h.grab;
  if (g.obj) {
    // Remember where the pinch was: opening the fingers to let go shifts the
    // cursor, and the drop should count where the object was held.
    g.lastX = h.x;
    g.lastY = h.y;
    // Reaching into the scene: pushing your hand toward the camera (it looks
    // bigger) sends the object away, pulling back brings it toward you.
    const dist = Math.min(Math.max(g.dist * Math.pow(h.size / g.size0, DEPTH_GAIN), 1.5), 25);
    g.curDist = dist;
    const p = editor.screenToWorld(h.x, h.y, dist).add(g.offset);
    p.y = Math.max(p.y, 0);
    g.obj.position.copy(p);
  } else {
    editor.orbitBy(-(h.x - g.x) * 0.006, -(h.y - g.y) * 0.006);
    g.x = h.x;
    g.y = h.y;
  }
}

function handleTwoHands(a, b) {
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (!twoHand) {
    const obj = a.grab?.obj || b.grab?.obj || null;
    twoHand = obj
      ? { obj, d0: d, a0: angle, s0: obj.scale.x, r0: obj.rotation.y }
      : { zoom: true, last: d };
  }
  if (twoHand.obj) {
    editor.setScale(twoHand.obj, twoHand.s0 * (d / twoHand.d0));
    twoHand.obj.rotation.y = twoHand.r0 - (angle - twoHand.a0) * 1.5;
  } else {
    editor.zoomBy(twoHand.last / d);
    twoHand.last = d;
  }
}

function processHands(detected, now) {
  const seen = new Set();
  for (const { id, landmarks } of detected) {
    seen.add(id);
    updateHand(id, landmarks, now);
  }
  for (const id of [...hands.keys()]) if (!seen.has(id)) hands.delete(id);

  const all = [...hands.values()];
  for (const h of all) {
    if (h.gesture === "pinch" && !h.grab) startGrab(h);
    if (h.gesture !== "pinch") {
      const g = h.grab;
      if (g?.obj && !twoHand && overTrash(g.lastX ?? h.x, g.lastY ?? h.y)) editor.remove(g.obj);
      h.grab = null;
    }
  }

  const pinching = all.filter((h) => h.grab);
  if (pinching.length >= 2) {
    handleTwoHands(pinching[0], pinching[1]);
  } else {
    if (twoHand) {
      // Coming out of a two-hand move: re-anchor the remaining hand so the
      // object doesn't jump.
      twoHand = null;
      for (const h of pinching) startGrab(h);
    }
    for (const h of pinching) moveGrab(h);
  }

  handHovered = [];
  for (const h of all) {
    if (h.grab) continue;
    const target = editor.pickAt(h.x, h.y, PICK_SLOP);
    handHovered.push(target);
    const held = now - h.since;
    if (h.gesture === "peace" && !h.fired && held > ADD_HOLD_MS) {
      h.fired = true;
      const dist = editor.distanceFromCamera(editor.target);
      const p = editor.screenToWorld(h.x, h.y, dist);
      p.y = Math.max(p.y, 0.5);
      editor.addShape(editor.currentShape, p);
    }
    if (h.gesture === "fist" && !h.fired && target && held > DELETE_HOLD_MS) {
      h.fired = true;
      editor.remove(target);
    }
  }
  editor.setHovered(handHovered);
}

// ---- Drawing the "ghost hands" (no camera image) ---------------------------

// How far into the scene a hand is drawn. A hand holding an object sits at
// the object; a free hand follows the same reach-in rule as dragging.
function handDepth(h) {
  if (h.grab?.obj) return h.grab.curDist ?? h.grab.dist;
  const base = editor.distanceFromCamera(editor.target);
  return Math.min(Math.max(base * Math.pow(h.size / REF_HAND_SIZE, DEPTH_GAIN), 2), 20);
}

// The hands themselves are drawn in 3D (see hand3d.js). This flat layer only
// shows the progress ring while holding a peace sign or fist.
function drawHoldRings(now) {
  const w = (overlay.width = overlay.clientWidth);
  const hgt = (overlay.height = overlay.clientHeight);
  ctx.clearRect(0, 0, w, hgt);
  for (const h of hands.values()) {
    const holdMs = h.gesture === "peace" ? ADD_HOLD_MS : h.gesture === "fist" ? DELETE_HOLD_MS : 0;
    if (!holdMs || h.fired) continue;
    const t = Math.min((now - h.since) / holdMs, 1);
    ctx.strokeStyle = h.gesture === "fist" ? "rgba(255,107,107,0.9)" : "rgba(207,232,255,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 20, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    ctx.stroke();
  }
}

// ---- Main loop ---------------------------------------------------------------

let trackingReady = false;

function loop() {
  const now = performance.now();
  if (trackingReady) {
    const detected = tracker.detect();
    if (detected) processHands(detected, now);
    const list = [...hands.values()];
    statusEl.textContent = list.length
      ? `Hands: ${list.map((h) => `${h.id} ${h.gesture}`).join(" · ")}`
      : "Show your hands to the camera";
  }
  hands3d.update(editor, hands, handDepth);
  drawHoldRings(now);
  updateTrash();
  editor.render();
  requestAnimationFrame(loop);
}
loop();
window.studioStarted = true;

statusEl.textContent = "Starting camera…";
tracker.start()
  .then(() => { trackingReady = true; })
  .catch((err) => {
    console.error(err);
    statusEl.textContent = "No camera: using mouse and keyboard";
  });
