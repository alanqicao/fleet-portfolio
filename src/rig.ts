import * as THREE from "three";

import { loadModel } from "./models.js";

export interface ArmParts {
  file: string;
  /** The fixed base. The whole arm turns about an upright axis through it. */
  base: string;
  /** Names of the parts that hinge, from the base out to the hand. */
  shoulder: string;
  elbow: string;
  wrist: string;
  /** The part at the end of the hand, where things are held. */
  tip: string;
  fingers: string[];
  /** Top-level parts that are scenery in the original file, not the arm. */
  hide: string[];
  /** How far the arm should reach from shoulder to wrist, in scene units. */
  reach: number;
}

interface Hinge {
  part: THREE.Object3D;
  rest: THREE.Quaternion;
  /** The hinge's axis in the frame of the part it hangs from. It stays fixed however the arm moves. */
  axis: THREE.Vector3;
}

/**
 * A real arm model driven joint by joint. The model's rest pose is measured once: where each
 * hinge is, how long each link is, and which way each link points. Poses are then given as the
 * angles the links should make with the horizon, and each hinge turns by the difference.
 */
export function loadArm(spec: ArmParts) {
  const holder = new THREE.Group();
  // `back` is how far the shoulder sits behind the upright axis the arm turns about.
  const dims = { ready: false, shoulderY: 1.15, upper: 3.0, fore: 2.6, hand: 0.95, back: 0 };
  const turntable = new THREE.Group();
  holder.add(turntable);
  let shoulder: Hinge, elbow: Hinge, wrist: Hinge;
  let fingers: { part: THREE.Object3D; rest: THREE.Quaternion }[] = [];
  let tip: THREE.Object3D | undefined;
  const rest = { bearing: 0, upper: 0, fore: 0, hand: 0 };
  const turn = new THREE.Quaternion();

  loadModel(spec.file, 1).then((gltf) => {
    const model = gltf.scene;
    const find = (name: string) => {
      const part = model.getObjectByName(name);
      if (!part) throw new Error(`The arm model has no part named ${name}.`);
      return part;
    };
    for (const name of spec.hide) find(name).visible = false;
    model.updateMatrixWorld(true);

    const at = (name: string) => find(name).getWorldPosition(new THREE.Vector3());
    const base = at(spec.base), s = at(spec.shoulder), e = at(spec.elbow), w = at(spec.wrist), t = at(spec.tip);
    const up = new THREE.Vector3(0, 1, 0);
    // The arm lies in an upright plane through the base; `out` is the level direction it reaches in.
    const out = new THREE.Vector3(e.x - s.x, 0, e.z - s.z).normalize();
    const hingeAxis = new THREE.Vector3().crossVectors(out, up);
    const lift = (from: THREE.Vector3, to: THREE.Vector3) => {
      const link = new THREE.Vector3().subVectors(to, from);
      return Math.atan2(link.y, link.dot(out));
    };
    const span = (from: THREE.Vector3, to: THREE.Vector3) => {
      const link = new THREE.Vector3().subVectors(to, from);
      return Math.hypot(link.y, link.dot(out));
    };
    rest.bearing = Math.atan2(-out.z, out.x);
    rest.upper = lift(s, e);
    rest.fore = lift(e, w);
    rest.hand = lift(w, t);

    const hinge = (name: string, worldAxis: THREE.Vector3): Hinge => {
      const part = find(name);
      const parentTurn = part.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      return { part, rest: part.quaternion.clone(), axis: worldAxis.clone().applyQuaternion(parentTurn).normalize() };
    };
    shoulder = hinge(spec.shoulder, hingeAxis);
    elbow = hinge(spec.elbow, hingeAxis);
    wrist = hinge(spec.wrist, hingeAxis);
    fingers = spec.fingers.map((name) => ({ part: find(name), rest: find(name).quaternion.clone() }));
    tip = find(spec.tip);

    // Size the model to the wanted reach, and stand its base on the deck at the origin.
    const scale = spec.reach / (span(s, e) + span(e, w));
    const box = new THREE.Box3();
    model.traverse((part) => {
      if (part instanceof THREE.Mesh && part.visible) {
        let shown = true;
        part.traverseAncestors((above) => { shown &&= above.visible; });
        if (shown) box.expandByObject(part);
        part.castShadow = true;
        part.receiveShadow = true;
      }
    });
    model.position.set(-base.x, -box.min.y, -base.z);
    holder.scale.setScalar(scale);
    turntable.add(model);
    dims.back = -new THREE.Vector3().subVectors(s, base).dot(out) * scale;
    dims.shoulderY = (s.y - box.min.y) * scale;
    dims.upper = span(s, e) * scale;
    dims.fore = span(e, w) * scale;
    dims.hand = span(w, t) * scale;
    dims.ready = true;
  }).catch((error) => console.error(`Arm model ${spec.file} failed to load.`, error));

  const swing = (joint: Hinge, angle: number) => {
    joint.part.quaternion.copy(turn.setFromAxisAngle(joint.axis, angle)).multiply(joint.rest);
  };

  return {
    group: holder,
    dims,
    /**
     * `bearing` is the compass direction the arm faces. `upper` and `fore` are the angles the two
     * links make with the horizon. The hand is kept pointing straight down. `grip` is 0 open to 1 closed.
     */
    pose(bearing: number, upper: number, fore: number, grip: number) {
      if (!dims.ready) return;
      turntable.rotation.y = bearing - rest.bearing;
      swing(shoulder, upper - rest.upper);
      swing(elbow, (fore - upper) - (rest.fore - rest.upper));
      swing(wrist, (-Math.PI / 2 - fore) - (rest.hand - rest.fore));
      fingers.forEach(({ part, rest: open }, index) => {
        part.quaternion.copy(open).multiply(turn.setFromAxisAngle(FINGER_AXIS, (index % 2 ? 1 : -1) * grip * 0.2));
      });
    },
    /** Where the end of the hand is, in world space. */
    tip(out: THREE.Vector3) {
      return tip ? tip.getWorldPosition(out) : out.set(0, 0, 0);
    },
  };
}

const FINGER_AXIS = new THREE.Vector3(0, 0, 1);
