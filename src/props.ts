import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

import { modelUrl } from "./models.js";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

interface Part {
  mesh: THREE.Mesh;
  /** The part's box in the model's own space. */
  box: THREE.Box3;
}

const files = new Map<string, Promise<Part[]>>();

/** Every mesh in a model file, with where it sits. Loaded once however many props use it. */
function parts(file: string) {
  let pending = files.get(file);
  if (!pending) {
    pending = loader.loadAsync(modelUrl(file)).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const found: Part[] = [];
      gltf.scene.traverse((node) => {
        if (node instanceof THREE.Mesh) found.push({ mesh: node, box: new THREE.Box3().setFromObject(node) });
      });
      return found;
    });
    pending.catch((error) => console.error(`Prop model ${file} failed to load.`, error));
    files.set(file, pending);
  }
  return pending;
}

/**
 * A pack holds several separate objects in one file. This sorts its meshes into those objects:
 * meshes whose boxes touch belong together, like a rock and the crystals growing out of it.
 */
function pieces(found: Part[]) {
  const group = found.map((_, index) => index);
  const root = (index: number): number => (group[index] === index ? index : (group[index] = root(group[index])));
  for (let a = 0; a < found.length; a++) {
    for (let b = a + 1; b < found.length; b++) {
      if (found[a].box.intersectsBox(found[b].box)) group[root(a)] = root(b);
    }
  }
  const sorted = new Map<number, Part[]>();
  found.forEach((part, index) => {
    const key = root(index);
    sorted.set(key, [...(sorted.get(key) ?? []), part]);
  });
  // Largest first, so a pick of 0 is always the most substantial piece.
  const volume = (list: Part[]) => list.reduce((box, part) => box.union(part.box), new THREE.Box3()).getSize(new THREE.Vector3()).length();
  return [...sorted.values()].sort((a, b) => volume(b) - volume(a));
}

/** The transform that centres a set of parts on the origin, turns them, and scales their longest side to `size`. */
function fit(list: Part[], size: number, turn: [number, number, number]) {
  const box = list.reduce((all, part) => all.union(part.box), new THREE.Box3());
  const centre = box.getCenter(new THREE.Vector3());
  const span = box.getSize(new THREE.Vector3());
  const scale = size / Math.max(span.x, span.y, span.z);
  return new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(...turn))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
}

export interface PropOptions {
  /** Which object of a pack to use; it wraps round. Leave out to use the whole file as one object. */
  pick?: number;
  turn?: [number, number, number];
  /** Materials whose name matches are made to shine, for crystals and lamps. */
  shine?: RegExp;
}

/** A real model standing in for a simple shape. The group is empty until the file arrives. */
export function prop(file: string, size: number, options: PropOptions = {}) {
  const holder = new THREE.Group();
  void parts(file).then((found) => {
    const sets = pieces(found);
    const list = options.pick === undefined ? found : sets[options.pick % sets.length];
    const placed = fit(list, size, options.turn ?? [0, 0, 0]);
    for (const { mesh } of list) {
      const copy = new THREE.Mesh(mesh.geometry, mesh.material);
      copy.applyMatrix4(new THREE.Matrix4().multiplyMatrices(placed, mesh.matrixWorld));
      copy.castShadow = true;
      copy.receiveShadow = true;
      const look = copy.material as THREE.MeshStandardMaterial;
      if (look.emissiveMap) look.emissiveIntensity = 3;
      if (options.shine?.test(look.name)) {
        copy.material = look.clone();
        (copy.material as THREE.MeshStandardMaterial).emissive = look.color.clone();
        (copy.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4;
      }
      holder.add(copy);
    }
  }).catch(() => undefined);
  return holder;
}

/** Many copies of one model drawn together, each with its own position and tint. */
/**
 * With `repaint`, the model's own paint is dropped so each copy takes its tint cleanly, while
 * its surface detail stays.
 */
export function flock(file: string, count: number, size: number, turn: [number, number, number] = [0, 0, 0], repaint = false) {
  const group = new THREE.Group();
  const drawn: { mesh: THREE.InstancedMesh; base: THREE.Matrix4 }[] = [];
  const where = Array.from({ length: count }, () => new THREE.Matrix4());
  const shown = new Uint8Array(count);
  const tints = Array.from({ length: count }, () => new THREE.Color(0xffffff));
  const scratch = new THREE.Matrix4();

  void parts(file).then((found) => {
    const placed = fit(found, size, turn);
    for (const { mesh } of found) {
      let look = mesh.material as THREE.MeshStandardMaterial;
      if (repaint) {
        look = look.clone();
        look.map = null;
        look.color.set(0xffffff);
      }
      const many = new THREE.InstancedMesh(mesh.geometry, look, count);
      many.castShadow = true;
      many.receiveShadow = true;
      many.frustumCulled = false;
      many.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < count; i++) many.setColorAt(i, tints[i]);
      many.count = 0;
      group.add(many);
      drawn.push({ mesh: many, base: new THREE.Matrix4().multiplyMatrices(placed, mesh.matrixWorld) });
    }
  }).catch(() => undefined);

  return {
    group,
    place(index: number, matrix: THREE.Matrix4, tint: THREE.Color) {
      where[index].copy(matrix);
      tints[index].copy(tint);
      shown[index] = 1;
    },
    hide(index: number) { shown[index] = 0; },
    /** Push this frame's positions and tints to the graphics card. */
    commit() {
      for (const { mesh, base } of drawn) {
        // Only the copies in use are sent, packed together, so hidden ones cost nothing to draw.
        let used = 0;
        for (let i = 0; i < count; i++) {
          if (!shown[i]) continue;
          mesh.setMatrixAt(used, scratch.multiplyMatrices(where[i], base));
          mesh.setColorAt(used, tints[i]);
          used++;
        }
        mesh.count = used;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
      }
    },
  };
}
