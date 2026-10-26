// Draws each tracked hand as a thin 3D skeleton inside the scene, at the depth
// you're reaching to, so you can see where your hand is relative to objects
// (it passes in front of and behind them). A ring on the floor under the
// pinch point helps judge position.
import * as THREE from "three";

export const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const TIPS = new Set([4, 8, 12, 16, 20]);

const COLORS = { pinch: "#4cc9ff", fist: "#ff6b6b", other: "#cfe8ff" };
const JOINT_RADIUS = 0.012; // world units at 7 units from the camera; scaled with distance
const TIP_RADIUS = 0.018;
const REF_DISTANCE = 7;

class HandModel {
  constructor(scene) {
    this.group = new THREE.Group();
    this.material = new THREE.MeshBasicMaterial({ color: COLORS.other, transparent: true, opacity: 0.9 });
    this.boneMaterial = new THREE.LineBasicMaterial({ color: COLORS.other, transparent: true, opacity: 0.45 });

    const sphere = new THREE.SphereGeometry(1, 10, 8);
    this.joints = Array.from({ length: 21 }, (_, i) => {
      const m = new THREE.Mesh(sphere, this.material);
      m.userData.radius = TIPS.has(i) ? TIP_RADIUS : JOINT_RADIUS;
      this.group.add(m);
      return m;
    });

    this.bonePositions = new Float32Array(BONES.length * 6);
    const boneGeo = new THREE.BufferGeometry();
    boneGeo.setAttribute("position", new THREE.BufferAttribute(this.bonePositions, 3));
    this.bones = new THREE.LineSegments(boneGeo, this.boneMaterial);
    this.bones.frustumCulled = false;
    this.group.add(this.bones);

    // Pinch point: a small ring that faces the camera.
    this.pinch = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.065, 32),
      new THREE.MeshBasicMaterial({ color: COLORS.other, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    this.group.add(this.pinch);

    // Floor marker under the pinch point, with a faint drop line.
    this.floorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.1, 40),
      new THREE.MeshBasicMaterial({ color: COLORS.other, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    this.floorRing.rotation.x = -Math.PI / 2;
    this.dropPositions = new Float32Array(6);
    const dropGeo = new THREE.BufferGeometry();
    dropGeo.setAttribute("position", new THREE.BufferAttribute(this.dropPositions, 3));
    this.drop = new THREE.Line(dropGeo, new THREE.LineDashedMaterial({ color: COLORS.other, transparent: true, opacity: 0.3, dashSize: 0.08, gapSize: 0.06 }));
    this.drop.frustumCulled = false;
    scene.add(this.floorRing, this.drop);
    this.scene = scene;
    scene.add(this.group);
  }

  update(editor, h, depth) {
    const color = COLORS[h.gesture] ?? COLORS.other;
    for (const mat of [this.material, this.boneMaterial, this.pinch.material, this.floorRing.material, this.drop.material]) mat.color.set(color);

    // Each landmark sits on the ray through its screen position, at the hand's
    // depth plus MediaPipe's per-joint depth (negative z = nearer the camera).
    const viewWidth = 2 * depth * Math.tan(THREE.MathUtils.degToRad(editor.camera.fov / 2)) * editor.camera.aspect;
    const pts = h.lm.map((p) => editor.screenToWorld(p.x * editor.width, p.y * editor.height, depth + p.z * viewWidth));

    const scale = depth / REF_DISTANCE;
    pts.forEach((p, i) => {
      this.joints[i].position.copy(p);
      this.joints[i].scale.setScalar(this.joints[i].userData.radius * scale);
    });
    BONES.forEach(([a, b], k) => {
      pts[a].toArray(this.bonePositions, k * 6);
      pts[b].toArray(this.bonePositions, k * 6 + 3);
    });
    this.bones.geometry.attributes.position.needsUpdate = true;

    const pinchPoint = editor.screenToWorld(h.x, h.y, depth);
    this.pinch.position.copy(pinchPoint);
    this.pinch.quaternion.copy(editor.camera.quaternion);
    this.pinch.scale.setScalar(scale * (h.gesture === "pinch" ? 0.7 : 1));

    this.floorRing.position.set(pinchPoint.x, 0.005, pinchPoint.z);
    this.floorRing.visible = this.drop.visible = pinchPoint.y > 0;
    pinchPoint.toArray(this.dropPositions, 0);
    this.dropPositions.set([pinchPoint.x, 0, pinchPoint.z], 3);
    this.drop.geometry.attributes.position.needsUpdate = true;
    this.drop.computeLineDistances();
  }

  dispose() {
    this.scene.remove(this.group, this.floorRing, this.drop);
    this.group.traverse((o) => o.geometry?.dispose());
    for (const o of [this.floorRing, this.drop]) { o.geometry.dispose(); o.material.dispose(); }
    for (const m of [this.material, this.boneMaterial, this.pinch.material]) m.dispose();
  }
}

export class Hands3D {
  constructor(scene) {
    this.scene = scene;
    this.models = new Map();
  }

  // `hands` is the Map of tracked hands; `depthOf(h)` gives each hand's
  // distance from the camera.
  update(editor, hands, depthOf) {
    for (const [id, model] of this.models) {
      if (!hands.has(id)) { model.dispose(); this.models.delete(id); }
    }
    for (const [id, h] of hands) {
      let model = this.models.get(id);
      if (!model) this.models.set(id, (model = new HandModel(this.scene)));
      model.update(editor, h, depthOf(h));
    }
  }
}
