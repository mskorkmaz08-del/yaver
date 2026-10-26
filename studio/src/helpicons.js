// Gesture icons for the help panel, drawn as hand waypoints (joints and
// bones, like the hand tracker sees them) instead of emoji. Each pose is
// built from finger curl amounts, so a new gesture is one line.

const WRIST = [50, 90];
// Finger bases (index, middle, ring, pinky), their lean from vertical in
// degrees, bone lengths, and how far each joint bends in a full curl.
const BASES = [[37, 56], [48, 52], [58, 54], [67, 60]];
const LEAN = [-12, -3, 6, 15];
const BONES_LEN = [[14, 10, 8], [16, 11, 8], [14, 10, 8], [11, 8, 7]];
const BEND = [75, 95, 70];
const THUMB = {
  open: [[41, 80], [31, 71], [24, 63], [19, 55]],
  tuck: [[41, 80], [37, 71], [43, 66], [50, 66]],
};
// Same pairs MediaPipe uses to draw a hand.
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const TIPS = new Set([4, 8, 12, 16, 20]);

const rad = (d) => (d * Math.PI) / 180;

// Returns 21 [x, y] points. `curl` is 0 (straight) to 1 (fully folded) per
// finger; `thumb` is "open", "tuck" or "pinch" (touching the index tip).
function pose(curl, thumb) {
  const pts = [WRIST];
  const fingers = BASES.map(([bx, by], f) => {
    const out = [[bx, by]];
    let x = bx, y = by, z = 0, cum = 0;
    for (let j = 0; j < 3; j++) {
      cum += rad(curl[f] * BEND[j]);
      const len = BONES_LEN[f][j];
      const up = len * Math.cos(cum);
      z += len * Math.sin(cum); // toward the viewer
      x += Math.sin(rad(LEAN[f])) * up;
      y -= Math.cos(rad(LEAN[f])) * up;
      // Slight oblique view so folded fingers don't collapse onto one line.
      out.push([x - 0.3 * z, y + 0.15 * z]);
    }
    return out;
  });
  let t = THUMB[thumb] ?? THUMB.open;
  if (thumb === "pinch") {
    const [tx, ty] = fingers[0][3];
    const mcp = [33, 71];
    t = [[41, 80], mcp, [(mcp[0] + tx) / 2 - 6, (mcp[1] + ty) / 2 + 1], [tx - 1, ty + 1.5]];
  }
  pts.push(...t);
  for (const f of fingers) pts.push(...f);
  return pts;
}

const POSES = {
  pinch: () => pose([0.42, 0.12, 0.18, 0.24], "pinch"),
  open: () => pose([0, 0, 0, 0], "open"),
  fist: () => pose([1, 1, 1, 1], "tuck"),
  peace: () => pose([0, 0, 1, 1], "tuck"),
};

function handSvg(pts, { mirror = false, dx = 0, touch = false } = {}) {
  const P = (i) => [mirror ? 100 - pts[i][0] + dx : pts[i][0] + dx, pts[i][1]];
  const f = (n) => n.toFixed(1);
  const lines = BONES.map(([a, b]) => {
    const [x1, y1] = P(a), [x2, y2] = P(b);
    return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
  }).join("");
  const dots = pts.map((_, i) => {
    const [x, y] = P(i);
    return `<circle class="${TIPS.has(i) ? "tip" : "joint"}" cx="${f(x)}" cy="${f(y)}" r="${TIPS.has(i) ? 3.4 : 2.3}"/>`;
  }).join("");
  // A soft ring where thumb and index meet.
  const [tx, ty] = P(8);
  const ring = touch ? `<circle class="touch" cx="${f(tx)}" cy="${f(ty)}" r="7"/>` : "";
  return `<g class="bones">${lines}</g>${ring}${dots}`;
}

// Small extra marks drawn next to a hand.
const GLYPHS = {
  depth: `<path class="mark" d="M86 28v40M80 34l6-6 6 6M80 62l6 6 6-6"/>`,
  orbit: `<g transform="translate(10 0)"><path class="mark" d="M72 22a16 16 0 1 1-4 22"/><path class="mark" d="M66 36l2 8 8-3"/></g>`,
  hold: `<circle class="mark faint" cx="84" cy="22" r="10"/><path class="mark" d="M84 12a10 10 0 0 1 10 10"/>`,
  shelf: `<rect class="mark" x="74" y="12" width="20" height="20" rx="3"/><path class="mark" d="M80 18l8 8M88 20v6h-6"/>`,
  bin: `<path class="mark" d="M76 26h18M81 26v-4h8v4M78 26l1.5 18h11l1.5-18"/>`,
  spread: `<path class="mark" d="M86 50h28M92 44l-6 6 6 6M108 44l6 6-6 6"/>`,
};

export function gestureIcon(name, glyph) {
  let body;
  let width = 100;
  if (name === "two-pinch") {
    width = 200;
    const pts = POSES.pinch();
    body = handSvg(pts, { mirror: true, touch: true }) + handSvg(pts, { dx: 100, touch: true });
  } else {
    body = handSvg(POSES[name](), { touch: name === "pinch" });
  }
  return `<svg class="hand-icon" viewBox="0 8 ${width} 88" aria-hidden="true">${body}${glyph ? GLYPHS[glyph] : ""}</svg>`;
}
