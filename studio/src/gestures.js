// Turns 21 MediaPipe hand landmarks into a gesture name plus a cursor point.
// Pure functions with no browser APIs, so they can be tested in Node.
//
// Landmark indices: 0 wrist, 4 thumb tip, 5/9/13/17 finger bases (MCP),
// 6/10/14/18 middle joints (PIP), 8/12/16/20 fingertips.

const PINCH_START = 0.32; // thumb-index gap, relative to hand size
const PINCH_END = 0.48;   // wider release threshold so a pinch doesn't flicker

const FINGERS = [
  { tip: 8, pip: 6 },   // index
  { tip: 12, pip: 10 }, // middle
  { tip: 16, pip: 14 }, // ring
  { tip: 20, pip: 18 }, // pinky
];

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Distance from wrist to middle-finger base: a stable measure of how big the
// hand looks, which also tells us roughly how close it is to the camera.
export function handSize(lm) {
  return dist(lm[0], lm[9]);
}

export function extendedFingers(lm) {
  const wrist = lm[0];
  return FINGERS.map(({ tip, pip }) => dist(wrist, lm[tip]) > dist(wrist, lm[pip]) * 1.15);
}

// `wasPinching` gives hysteresis: harder to start a pinch than to keep one.
export function classify(lm, wasPinching = false) {
  const size = handSize(lm) || 1e-6;
  const pinchRatio = dist(lm[4], lm[8]) / size;
  const [index, middle, ring, pinky] = extendedFingers(lm);
  const extendedCount = [index, middle, ring, pinky].filter(Boolean).length;

  let gesture = "point";
  const indexReach = dist(lm[8], lm[0]) / size;
  if (pinchRatio < (wasPinching ? PINCH_END : PINCH_START) && indexReach > 1.0) {
    // In a fist the index tip curls back toward the wrist, so requiring some
    // reach keeps a fist from reading as a pinch.
    gesture = "pinch";
  } else if (extendedCount === 0) {
    gesture = "fist";
  } else if (index && middle && !ring && !pinky) {
    gesture = "peace";
  } else if (extendedCount === 4) {
    gesture = "open";
  }

  // Cursor sits between thumb and index tips, where a pinch closes.
  const cursor = {
    x: (lm[4].x + lm[8].x) / 2,
    y: (lm[4].y + lm[8].y) / 2,
  };
  if (gesture === "fist") {
    cursor.x = lm[9].x;
    cursor.y = lm[9].y;
  }

  return { gesture, cursor, size, pinchRatio };
}
