// The 3D editor: scene, camera, objects and the commands that change them.
// Hand gestures, the mouse and (later) Yaver's voice all drive the editor
// through these same methods.
import * as THREE from "three";

export const SHAPES = ["cube", "sphere", "cylinder", "cone", "torus", "pyramid", "capsule", "gem", "diamond", "knot"];
export const COLORS = ["#4cc9ff", "#ff6b6b", "#ffd166", "#06d6a0", "#c77dff", "#f1f1f1"];

const MIN_SCALE = 0.15;
const MAX_SCALE = 8;

// Faceted shapes look best with flat shading.
const FLAT = new Set(["pyramid", "gem", "diamond"]);

export function makeGeometry(type) {
  switch (type) {
    case "sphere": return new THREE.SphereGeometry(0.5, 48, 32);
    case "cylinder": return new THREE.CylinderGeometry(0.4, 0.4, 1, 48);
    case "cone": return new THREE.ConeGeometry(0.5, 1, 48);
    case "torus": return new THREE.TorusGeometry(0.4, 0.15, 24, 64);
    case "pyramid": return new THREE.ConeGeometry(0.6, 1, 4);
    case "capsule": return new THREE.CapsuleGeometry(0.3, 0.5, 8, 32);
    case "gem": return new THREE.IcosahedronGeometry(0.55);
    case "diamond": return new THREE.OctahedronGeometry(0.6);
    case "knot": return new THREE.TorusKnotGeometry(0.32, 0.11, 128, 16);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function makeMaterial(type, color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15, flatShading: FLAT.has(type) });
}

export class Editor extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.objects = [];
    this.selected = null;
    this.hovered = new Set();
    this.currentShape = "cube";
    this.currentColor = COLORS[0];

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#07090f");
    this.scene.fog = new THREE.Fog("#07090f", 14, 30);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.target = new THREE.Vector3(0, 0.5, 0);
    this.orbit = { theta: 0.6, phi: 1.1, radius: 7 };
    this.updateCamera();

    this.scene.add(new THREE.HemisphereLight("#bfe6ff", "#10141c", 0.9));
    const sun = new THREE.DirectionalLight("#ffffff", 1.4);
    sun.position.set(4, 8, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);

    const grid = new THREE.GridHelper(20, 40, "#1f6f99", "#16263a");
    this.scene.add(grid);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.35 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.raycaster = new THREE.Raycaster();

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get width() { return this.renderer.domElement.clientWidth; }
  get height() { return this.renderer.domElement.clientHeight; }

  // ---- View -------------------------------------------------------------

  updateCamera() {
    const { theta, phi, radius } = this.orbit;
    this.camera.position.set(
      this.target.x + radius * Math.sin(phi) * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(this.target);
  }

  orbitBy(dTheta, dPhi) {
    this.orbit.theta += dTheta;
    this.orbit.phi = THREE.MathUtils.clamp(this.orbit.phi + dPhi, 0.15, Math.PI / 2 - 0.02);
    this.updateCamera();
  }

  zoomBy(factor) {
    this.orbit.radius = THREE.MathUtils.clamp(this.orbit.radius * factor, 2.5, 20);
    this.updateCamera();
  }

  // ---- Objects ----------------------------------------------------------

  addShape(type = this.currentShape, position = null, color = this.currentColor) {
    const mesh = new THREE.Mesh(makeGeometry(type), makeMaterial(type, color));
    mesh.castShadow = true;
    mesh.userData.shape = type;
    mesh.position.copy(position ?? this.target.clone().add(new THREE.Vector3(0, 0.5, 0)));
    this.scene.add(mesh);
    this.objects.push(mesh);
    this.select(mesh);
    this.emit("change");
    return mesh;
  }

  remove(obj = this.selected) {
    if (!obj) return;
    this.scene.remove(obj);
    obj.geometry.dispose();
    obj.material.dispose();
    this.objects = this.objects.filter((o) => o !== obj);
    this.hovered.delete(obj);
    if (this.selected === obj) this.selected = null;
    this.refreshHighlights();
    this.emit("change");
  }

  select(obj) {
    this.selected = obj;
    this.refreshHighlights();
    this.emit("select");
  }

  setColor(color, obj = this.selected) {
    this.currentColor = color;
    if (obj) obj.material.color.set(color);
  }

  setScale(obj, s) {
    obj.scale.setScalar(THREE.MathUtils.clamp(s, MIN_SCALE, MAX_SCALE));
  }

  setHovered(objs) {
    this.hovered = new Set(objs.filter(Boolean));
    this.refreshHighlights();
  }

  refreshHighlights() {
    for (const o of this.objects) {
      const level = o === this.selected ? 0.35 : this.hovered.has(o) ? 0.18 : 0;
      o.material.emissive.set(o.material.color);
      o.material.emissiveIntensity = level;
    }
  }

  // ---- Screen <-> world -------------------------------------------------

  ndc(sx, sy) {
    return new THREE.Vector2((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1);
  }

  // Object under a screen point. Falls back to the closest object whose
  // projected centre is within `slop` pixels, since fingers are less precise
  // than a mouse.
  pickAt(sx, sy, slop = 0) {
    this.raycaster.setFromCamera(this.ndc(sx, sy), this.camera);
    const hit = this.raycaster.intersectObjects(this.objects, false)[0];
    if (hit) return hit.object;
    if (!slop) return null;
    let best = null;
    let bestD = slop;
    for (const o of this.objects) {
      const p = this.toScreen(o.position);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.width, y: (1 - p.y) / 2 * this.height };
  }

  // Point along the ray through a screen point, `dist` units from the camera.
  screenToWorld(sx, sy, dist) {
    this.raycaster.setFromCamera(this.ndc(sx, sy), this.camera);
    return this.raycaster.ray.at(dist, new THREE.Vector3());
  }

  distanceFromCamera(v) {
    return this.camera.position.distanceTo(v);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  emit(name) {
    this.dispatchEvent(new Event(name));
  }
}
