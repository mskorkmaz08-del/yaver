import { Editor, SHAPES, COLORS } from "./editor.js";
import { HandTracker } from "./hands.js";
import { classify } from "./gestures.js";

const PICK_SLOP = 70;      // px: how close a finger must be to an object to grab it
const ADD_HOLD_MS = 700;   // hold a peace sign this long to add a shape
const DELETE_HOLD_MS = 900; // hold a fist this long to delete
const SMOOTHING = 0.5;     // 0 = no smoothing, closer to 1 = smoother but laggier
const DEPTH_GAIN = 1.6;    // how strongly moving your hand toward the camera pulls objects

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const editor = new Editor(document.getElementById("stage"));
const overlay = document.getElementById("hands-overlay");
const ctx = overlay.getContext("2d");
const video = document.getElementById("camera");
const statusEl = document.getElementById("status");
const tracker = new HandTracker(video);

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
document.getElementById("delete-btn").onclick = () => editor.remove();

window.addEventListener("keydown", (e) => {
  if (e.key >= "1" && e.key <= String(SHAPES.length)) {
    const shape = SHAPES[Number(e.key) - 1];
    setShape(shape);
    editor.addShape(shape);
  } else if (e.key === "Delete" || e.key === "Backspace") {
    editor.remove();
  } else if (e.key.toLowerCase() === "c") {
    video.classList.toggle("preview");
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
    const p = editor.screenToWorld(e.clientX, e.clientY, mouse.dist).add(mouse.offset);
    p.y = Math.max(p.y, 0);
    mouse.obj.position.copy(p);
  } else {
    editor.orbitBy(-(e.clientX - mouse.x) * 0.006, -(e.clientY - mouse.y) * 0.006);
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }
});
canvas.addEventListener("pointerup", () => { mouse = null; });
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
  h.size = size;
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
    const dist = g.dist * Math.pow(g.size0 / h.size, DEPTH_GAIN);
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
    if (h.gesture !== "pinch") h.grab = null;
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

function drawHands(now) {
  const w = (overlay.width = overlay.clientWidth);
  const hgt = (overlay.height = overlay.clientHeight);
  ctx.clearRect(0, 0, w, hgt);
  for (const h of hands.values()) {
    const pts = h.lm.map((p) => [p.x * w, p.y * hgt]);
    const color = h.gesture === "pinch" ? "#4cc9ff" : h.gesture === "fist" ? "#ff6b6b" : "rgba(200,230,255,0.75)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (const [i, j] of BONES) {
      ctx.moveTo(...pts[i]);
      ctx.lineTo(...pts[j]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cursor, plus a progress ring while holding a peace sign or fist.
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.gesture === "pinch" ? 8 : 12, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.stroke();
    const holdMs = h.gesture === "peace" ? ADD_HOLD_MS : h.gesture === "fist" ? DELETE_HOLD_MS : 0;
    if (holdMs && !h.fired) {
      const t = Math.min((now - h.since) / holdMs, 1);
      ctx.beginPath();
      ctx.arc(h.x, h.y, 20, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.stroke();
    }
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
  drawHands(now);
  editor.render();
  requestAnimationFrame(loop);
}
loop();

statusEl.textContent = "Starting camera…";
tracker.start()
  .then(() => { trackingReady = true; })
  .catch((err) => {
    console.error(err);
    statusEl.textContent = "No camera: using mouse and keyboard";
  });
