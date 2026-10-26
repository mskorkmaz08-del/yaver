// One pointer per tracked hand, drawn inside the scene at the depth you're
// reaching to, so it passes in front of and behind objects. A small ring on
// the floor under it, with a faint drop line, helps judge position. The hand
// itself isn't drawn: the pointer is all you need while working.
import * as THREE from "three";

const COLORS = { pinch: "#4cc9ff", fist: "#ff6b6b", other: "#cfe8ff" };
const REF_DISTANCE = 7; // sizes below are for 7 units from the camera and scale with distance

class Pointer {
  constructor(scene) {
    this.scene = scene;
    const mat = (opacity) => new THREE.MeshBasicMaterial({ color: COLORS.other, transparent: true, opacity, side: THREE.DoubleSide });

    // A dot with a ring around it, facing the camera. Pinching fills the ring.
    this.group = new THREE.Group();
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), mat(0.95));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 36), mat(0.85));
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(0.07, 36), mat(0.25));
    this.group.add(this.fill, this.ring, this.dot);

    this.floorRing = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 40), mat(0.3));
    this.floorRing.rotation.x = -Math.PI / 2;
    this.dropPositions = new Float32Array(6);
    const dropGeo = new THREE.BufferGeometry();
    dropGeo.setAttribute("position", new THREE.BufferAttribute(this.dropPositions, 3));
    this.drop = new THREE.Line(dropGeo, new THREE.LineDashedMaterial({ color: COLORS.other, transparent: true, opacity: 0.25, dashSize: 0.08, gapSize: 0.06 }));
    this.drop.frustumCulled = false;

    this.parts = [this.dot, this.ring, this.fill, this.floorRing, this.drop];
    scene.add(this.group, this.floorRing, this.drop);
  }

  update(editor, h, depth) {
    const color = COLORS[h.gesture] ?? COLORS.other;
    for (const p of this.parts) p.material.color.set(color);

    const point = editor.screenToWorld(h.x, h.y, depth);
    const pinching = h.gesture === "pinch";
    this.group.position.copy(point);
    this.group.quaternion.copy(editor.camera.quaternion);
    this.group.scale.setScalar((depth / REF_DISTANCE) * (pinching ? 0.8 : 1));
    this.fill.visible = pinching;

    this.floorRing.position.set(point.x, 0.005, point.z);
    this.floorRing.visible = this.drop.visible = point.y > 0;
    point.toArray(this.dropPositions, 0);
    this.dropPositions.set([point.x, 0, point.z], 3);
    this.drop.geometry.attributes.position.needsUpdate = true;
    this.drop.computeLineDistances();
  }

  dispose() {
    this.scene.remove(this.group, this.floorRing, this.drop);
    for (const p of this.parts) { p.geometry.dispose(); p.material.dispose(); }
  }
}

export class Hands3D {
  constructor(scene) {
    this.scene = scene;
    this.pointers = new Map();
  }

  // `hands` is the Map of tracked hands; `depthOf(h)` gives each hand's
  // distance from the camera.
  update(editor, hands, depthOf) {
    for (const [id, pointer] of this.pointers) {
      if (!hands.has(id)) { pointer.dispose(); this.pointers.delete(id); }
    }
    for (const [id, h] of hands) {
      let pointer = this.pointers.get(id);
      if (!pointer) this.pointers.set(id, (pointer = new Pointer(this.scene)));
      pointer.update(editor, h, depthOf(h));
    }
  }
}
