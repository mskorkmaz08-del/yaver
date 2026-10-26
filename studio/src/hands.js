// Webcam + MediaPipe hand tracking. The video element stays hidden; we only
// read landmarks from it.
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastTime = -1;
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();

    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, options("GPU"));
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(vision, options("CPU"));
    }
  }

  // Returns [{ id: "Left" | "Right", landmarks: [{x, y, z}...21] }].
  // Coordinates are mirrored so moving your right hand right moves the cursor right.
  detect() {
    if (!this.landmarker || this.video.readyState < 2) return [];
    const now = performance.now();
    if (now <= this.lastTime) return null;
    this.lastTime = now;
    const result = this.landmarker.detectForVideo(this.video, now);
    const used = new Set();
    return result.landmarks.map((lm, i) => {
      let id = result.handedness[i]?.[0]?.categoryName ?? `hand${i}`;
      if (used.has(id)) id = `${id}${i}`;
      used.add(id);
      return { id, landmarks: lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })) };
    });
  }
}
