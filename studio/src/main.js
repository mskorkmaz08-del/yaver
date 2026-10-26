// The ?v= number defeats browser caching after an update (GitHub Pages lets
// browsers keep files for 10 minutes). Bump it here and in index.html together.
import { Editor, SHAPES, COLORS } from "./editor.js?v=9";
import { HandTracker } from "./hands.js?v=9";
import { classify } from "./gestures.js?v=9";
import { Hands3D } from "./hand3d.js?v=9";
import { Shelf } from "./shelf.js?v=9";
import { gestureIcon } from "./helpicons.js?v=9";
import { OneEuro } from "./filters.js?v=9";

const STUDIO_VERSION = new URL(import.meta.url).searchParams.get("v") ?? "dev";
document.getElementById("version").textContent = `v${STUDIO_VERSION}`;

const PICK_SLOP = 90;      // px: how close a finger must be to an object to grab it
const SHELF_PAD = 12;      // px: extra reach around each shelf tile
const ADD_HOLD_MS = 700;   // hold a peace sign this long to add a shape
const DELETE_HOLD_MS = 900; // hold a fist this long to delete
const SMOOTHING = 0.35;    // landmark smoothing for reading gestures (the pointer has its own filter)
const RELEASE_GRACE_MS = 140; // a pinch must stay open this long to let go, so a flicker doesn't drop things
const LOST_HAND_MS = 300;  // keep a hand (and what it holds) through brief tracking dropouts
const DEPTH_GAIN = 2.2;    // how strongly pushing your hand toward the camera sends objects away
const REF_HAND_SIZE = 0.2; // typical hand size on camera at a comfortable reach
// Pointer and depth filters (see filters.js): steady at rest, quick when moving.
const POINTER_FILTER = [1.0, 0.007];
const SIZE_FILTER = [0.5, 3];

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

// ---- Shape shelf and colours ---------------------------------------------

const shelf = new Shelf(document.getElementById("shelf"), SHAPES, COLORS[0]);
function setShape(shape) {
  editor.currentShape = shape;
  shelf.setActive(shape);
}
setShape("cube");

// A new shape pulled off the shelf starts under the pointer, at the depth of
// the scene's centre, and is held right away.
function addFromShelf(shape, x, y) {
  setShape(shape);
  const dist = editor.distanceFromCamera(editor.target);
  const p = editor.screenToWorld(x, y, dist);
  p.y = Math.max(p.y, 0);
  return { obj: editor.addShape(shape, p), dist };
}

const colorsEl = document.getElementById("colors");
COLORS.forEach((c) => {
  const b = document.createElement("button");
  b.className = "swatch";
  b.style.background = c;
  b.title = c;
  b.onclick = () => editor.setColor(c);
  colorsEl.appendChild(b);
});
// ---- Help --------------------------------------------------------------------

// Hidden behind the "?" button: hovering it peeks, clicking (or H) pins it.
const GESTURES = [
  ["pinch", null, "Pinch", "grab an object"],
  ["open", null, "Open hand", "let go"],
  ["pinch", "shelf", "Pinch a shelf shape", "drag it into the scene to add it"],
  ["pinch", "depth", "Push or pull", "toward the camera sends it away, back brings it closer"],
  ["two-pinch", "spread", "Both hands pinch", "spread to scale, twist to rotate"],
  ["pinch", "orbit", "Pinch empty space", "orbit the view (both hands: zoom)"],
  ["pinch", "bin", "Drop in the bin", "delete (drop on the shelf to put it back)"],
  ["fist", "hold", "Fist on an object, hold", "delete"],
  ["peace", "hold", "Peace sign, hold", "add the last shape again"],
];
document.getElementById("gesture-list").innerHTML = GESTURES
  .map(([pose, glyph, title, text]) => `<li>${gestureIcon(pose, glyph)}<span><b>${title}</b><br>${text}</span></li>`)
  .join("");

const helpEl = document.getElementById("help");
const helpButton = document.getElementById("help-button");
let helpMousePeek = false;
function setHelpOpen(open) {
  helpEl.classList.toggle("open", open);
  helpButton.setAttribute("aria-expanded", String(open));
}
helpButton.onclick = () => setHelpOpen(!helpEl.classList.contains("open"));
helpEl.addEventListener("mouseenter", () => { helpMousePeek = true; });
helpEl.addEventListener("mouseleave", () => { helpMousePeek = false; });

// A hand pointer resting on the button peeks the help too, and it stays up
// while the pointer is over the panel.
function updateHelpPeek() {
  const rects = [helpButton.getBoundingClientRect()];
  if (helpEl.classList.contains("peek")) rects.push(document.getElementById("help-panel").getBoundingClientRect());
  let handOver = false;
  for (const h of hands.values()) {
    if (rects.some((r) => h.x > r.left && h.x < r.right && h.y > r.top && h.y < r.bottom)) handOver = true;
  }
  helpEl.classList.toggle("peek", helpMousePeek || handOver);
}

// ---- Trash bin ---------------------------------------------------------------

const trashEl = document.getElementById("trash");
trashEl.onclick = () => editor.remove();

function overTrash(x, y) {
  const r = trashEl.getBoundingClientRect();
  const pad = 28; // generous, since a fingertip wobbles more than a mouse
  return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
}

// The bin lights up while something is being dragged, and turns red when the
// dragged object is over it. The shelf shows it can take a shape back, and
// its tiles light up under a free hand.
function updateDropTargets() {
  const dragging = [];
  if (mouse?.obj && mouse.pos) dragging.push(mouse.pos);
  if (!twoHand) for (const h of hands.values()) if (h.grab?.obj) dragging.push({ x: h.x, y: h.y });
  trashEl.classList.toggle("armed", dragging.length > 0);
  trashEl.classList.toggle("hot", dragging.some((p) => overTrash(p.x, p.y)));
  shelf.setReturning(dragging.some((p) => shelf.contains(p.x, p.y)));
  const hot = [];
  for (const h of hands.values()) if (!h.grab) hot.push(shelf.shapeAt(h.x, h.y, SHELF_PAD));
  shelf.setHot(hot);
}

// Letting go of a dragged object over the bin deletes it; over the shelf it
// goes back (the shape is still on the shelf to pull out again).
function dropAt(obj, x, y) {
  if (overTrash(x, y) || shelf.contains(x, y)) editor.remove(obj);
}

window.addEventListener("keydown", (e) => {
  if (e.key >= "0" && e.key <= "9" && SHAPES[(Number(e.key) + 9) % 10]) {
    const shape = SHAPES[(Number(e.key) + 9) % 10]; // 1 is the first shape, 0 the tenth
    setShape(shape);
    editor.addShape(shape);
  } else if (e.key === "Delete" || e.key === "Backspace") {
    editor.remove();
  } else if (e.key.toLowerCase() === "c") {
    video.classList.toggle("preview");
  } else if (e.key.toLowerCase() === "h") {
    setHelpOpen(!helpEl.classList.contains("open"));
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
// Press on a shelf tile and drag: the new shape follows the mouse. A plain
// click drops it in the middle of the scene instead.
shelf.el.addEventListener("pointerdown", (e) => {
  const shape = shelf.shapeAt(e.clientX, e.clientY);
  if (!shape) return;
  e.preventDefault();
  const { obj, dist } = addFromShelf(shape, e.clientX, e.clientY);
  mouse = { obj, dist, offset: obj.position.clone().sub(editor.screenToWorld(e.clientX, e.clientY, dist)), fromShelf: { x: e.clientX, y: e.clientY } };
  shelf.el.setPointerCapture(e.pointerId);
});
shelf.el.addEventListener("pointermove", (e) => mouseDrag(e));
shelf.el.addEventListener("pointerup", (e) => {
  if (!mouse?.obj) return;
  const start = mouse.fromShelf;
  if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) {
    mouse.obj.position.copy(editor.target).add({ x: 0, y: 0.5, z: 0 });
  } else {
    dropAt(mouse.obj, e.clientX, e.clientY);
  }
  mouse = null;
});

canvas.addEventListener("pointermove", (e) => {
  if (!mouse) {
    editor.setHovered([editor.pickAt(e.clientX, e.clientY), ...handHovered]);
    return;
  }
  mouseDrag(e);
});
function mouseDrag(e) {
  if (!mouse) return;
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
}
canvas.addEventListener("pointerup", (e) => {
  if (mouse?.obj) dropAt(mouse.obj, e.clientX, e.clientY);
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
    h = {
      id, lm: raw, gesture: "point", since: now, fired: false, grab: null,
      fx: new OneEuro(...POINTER_FILTER), fy: new OneEuro(...POINTER_FILTER), fsize: new OneEuro(...SIZE_FILTER),
    };
    hands.set(id, h);
  }
  h.lastSeen = now;
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
  h.size = h.fsize.filter(size, now);
  h.x = h.fx.filter(cursor.x * editor.width, now);
  h.y = h.fy.filter(cursor.y * editor.height, now);
  return h;
}

function startGrab(h) {
  const shape = shelf.shapeAt(h.x, h.y, SHELF_PAD);
  if (shape) {
    const { obj, dist } = addFromShelf(shape, h.x, h.y);
    h.grab = { obj, dist, offset: obj.position.clone().sub(editor.screenToWorld(h.x, h.y, dist)), size0: h.size };
    return;
  }
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
  // A hand that vanishes for a moment (motion blur, edge of the frame) keeps
  // its state and whatever it holds; only a longer absence lets go.
  for (const [id, h] of hands) {
    if (now - h.lastSeen > LOST_HAND_MS) {
      if (h.grab?.obj && !twoHand) dropAt(h.grab.obj, h.grab.lastX ?? h.x, h.grab.lastY ?? h.y);
      hands.delete(id);
    }
  }

  const all = [...hands.values()];
  for (const h of all) {
    if (!seen.has(h.id)) continue;
    if (h.gesture === "pinch") {
      h.openSince = null;
      if (!h.grab) startGrab(h);
    } else if (h.grab) {
      h.openSince ??= now;
      if (now - h.openSince >= RELEASE_GRACE_MS) {
        const g = h.grab;
        if (g.obj && !twoHand) dropAt(g.obj, g.lastX ?? h.x, g.lastY ?? h.y);
        h.grab = null;
      }
    }
  }

  // Hands that are letting go (or briefly lost) hold still instead of
  // dragging the object along as the fingers open.
  const steady = (h) => seen.has(h.id) && h.gesture === "pinch";
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
    for (const h of pinching) if (steady(h)) moveGrab(h);
  }

  handHovered = [];
  for (const h of all) {
    if (h.grab || shelf.contains(h.x, h.y, SHELF_PAD)) continue;
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
  updateDropTargets();
  updateHelpPeek();
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
