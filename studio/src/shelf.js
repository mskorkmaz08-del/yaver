// The shape shelf on the left edge. Each tile shows a small 3D preview of its
// shape. Pinch a tile (or press the mouse on it) and drag the new shape out
// into the scene; letting go back over the shelf puts it away again.
import * as THREE from "three";
import { makeGeometry, makeMaterial } from "./editor.js?v=8";

const THUMB_PX = 96;

// Renders every shape once into a small offscreen canvas and returns image
// URLs, so the shelf costs nothing per frame.
function renderThumbnails(shapes, color) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(THUMB_PX, THUMB_PX);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#bfe6ff", "#10141c", 1.1));
  const sun = new THREE.DirectionalLight("#ffffff", 1.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
  camera.position.set(1.6, 1.3, 2.2);
  camera.lookAt(0, 0, 0);

  const urls = {};
  for (const shape of shapes) {
    const mesh = new THREE.Mesh(makeGeometry(shape), makeMaterial(shape, color));
    mesh.rotation.y = 0.5;
    scene.add(mesh);
    renderer.render(scene, camera);
    urls[shape] = renderer.domElement.toDataURL();
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return urls;
}

export class Shelf {
  constructor(el, shapes, color) {
    this.el = el;
    this.tiles = new Map();
    let thumbs = {};
    try { thumbs = renderThumbnails(shapes, color); } catch (err) { console.warn("No shape previews", err); }
    shapes.forEach((shape, i) => {
      const tile = document.createElement("button");
      tile.className = "tile";
      tile.dataset.shape = shape;
      tile.title = `${shape} (key ${(i + 1) % 10})`;
      if (thumbs[shape]) {
        const img = document.createElement("img");
        img.src = thumbs[shape];
        img.alt = "";
        img.draggable = false;
        tile.appendChild(img);
      }
      const label = document.createElement("span");
      label.textContent = shape;
      tile.appendChild(label);
      el.appendChild(tile);
      this.tiles.set(shape, tile);
    });
  }

  // Shape whose tile is under a screen point. `pad` widens each tile for
  // fingertips, which wobble more than a mouse.
  shapeAt(x, y, pad = 0) {
    for (const [shape, tile] of this.tiles) {
      const r = tile.getBoundingClientRect();
      if (x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad) return shape;
    }
    return null;
  }

  contains(x, y, pad = 0) {
    const r = this.el.getBoundingClientRect();
    return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
  }

  setActive(shape) {
    for (const [s, tile] of this.tiles) tile.classList.toggle("active", s === shape);
  }

  // Tiles a hand is pointing at light up.
  setHot(shapes) {
    for (const [s, tile] of this.tiles) tile.classList.toggle("hot", shapes.includes(s));
  }

  // While something is being dragged, the shelf shows it can take it back.
  setReturning(on) {
    this.el.classList.toggle("returning", on);
  }
}
