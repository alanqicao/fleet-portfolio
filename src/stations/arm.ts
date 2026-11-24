import * as THREE from "three";
import { block, clamp, engine, greeble, ink, loft, mast, matte, navLights, post, windowRow, type Station } from "../kit.js";

const UPPER = 3.0;
const FORE = 2.6;
const HAND = 0.95;
const SHOULDER_Y = 1.15;

function hinge(color: number) {
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 20), matte(color));
  disc.rotation.x = Math.PI / 2;
  disc.castShadow = true;
  return disc;
}

/** Turn an angle toward a goal at a limited speed, the way a hobby servo does. */
function servo(angle: number, goal: number, dt: number, speed = 3.2) {
  const gap = Math.atan2(Math.sin(goal - angle), Math.cos(goal - angle));
  return angle + clamp(gap, -speed * dt, speed * dt);
}

/** The tug. A four-joint arm on its back reaches for the pointer and handles drifting cargo. */
export function createArm(): Station {
  const group = new THREE.Group();

  group.add(block(0.8, 0.5, 1.9, ink.slate, -1.5, 0, 0));

  group.add(post(1.05, 0.3, ink.graphite));
  const turntable = new THREE.Group();
  turntable.position.y = 0.3;
  turntable.add(post(0.8, 0.28, ink.orange), block(0.3, 0.8, 0.9, ink.graphite, 0, 0.28, 0));
  group.add(turntable);

  const shoulder = new THREE.Group();
  shoulder.position.y = SHOULDER_Y - 0.3;
  shoulder.add(hinge(ink.orange), block(0.46, UPPER, 0.42, ink.steel));
  turntable.add(shoulder);

  const elbow = new THREE.Group();
  elbow.position.y = UPPER;
  elbow.add(hinge(ink.orange), block(0.38, FORE, 0.36, ink.steel));
  shoulder.add(elbow);

  const wrist = new THREE.Group();
  wrist.position.y = FORE;
  const wristHinge = hinge(ink.graphite);
  wristHinge.scale.setScalar(0.75);
  wrist.add(wristHinge, block(0.7, 0.3, 0.5, ink.graphite, 0, 0.25, 0));
  elbow.add(wrist);
  const fingers = [block(0.12, 0.55, 0.4, ink.orange, -0.3, 0.5, 0), block(0.12, 0.55, 0.4, ink.orange, 0.3, 0.5, 0)];
  wrist.add(...fingers);
  const tip = new THREE.Object3D();
  tip.position.y = HAND;
  wrist.add(tip);

  // One knob per joint on the aft console, as on the real build.
  const knobs = [0, 1, 2, 3].map((index) => {
    const knob = new THREE.Group();
    knob.position.set(-1.5, 0.5, -0.66 + index * 0.44);
    knob.add(post(0.17, 0.2, ink.orange, 0, 0, 0, 16), block(0.05, 0.04, 0.18, ink.bone, 0, 0.2, -0.07));
    group.add(knob);
    return knob;
  });

  const crate = (color: number, x: number, z: number) => {
    const box = block(0.6, 0.6, 0.6, color, x, -0.1, z);
    box.userData.spin = 0.2 + Math.abs(x) * 0.05;
    return box;
  };
  const cubes = [crate(ink.yellow, 3.2, 2.6), crate(ink.water, 1.4, -3.0), crate(ink.orange, -1.8, -2.9)];
  group.add(...cubes);
  let held: THREE.Mesh | null = null;

  const angles = { yaw: 0.4, shoulder: -0.5, elbow: -1.4, wrist: -1.2 };
  const goal = new THREE.Vector3(3, 1, 0);
  const reach = new THREE.Vector3();
  let grip = 0;

  function update(dt: number, time: number, input: Parameters<Station["update"]>[2]) {
    if (input.point) goal.set(input.point.x, held ? 1.0 : 0.2, input.point.z);
    else goal.set(Math.cos(time * 0.45) * 3.4, 1.3 + Math.sin(time * 0.9) * 0.5, Math.sin(time * 0.45) * 2.8);

    // Keep the goal where the arm can actually get to.
    const radius = clamp(Math.hypot(goal.x, goal.z), 1.9, UPPER + FORE - 0.9);
    const bearing = Math.atan2(-goal.z, goal.x);
    const dy = goal.y + HAND - SHOULDER_Y;
    const span = clamp(Math.hypot(radius, dy), Math.abs(UPPER - FORE) + 0.2, UPPER + FORE - 0.05);
    const upperLift = Math.atan2(dy, radius) + Math.acos((UPPER * UPPER + span * span - FORE * FORE) / (2 * UPPER * span));
    const bend = Math.acos((UPPER * UPPER + FORE * FORE - span * span) / (2 * UPPER * FORE));
    const foreLift = upperLift - (Math.PI - bend);

    angles.yaw = servo(angles.yaw, bearing, dt);
    angles.shoulder = servo(angles.shoulder, upperLift - Math.PI / 2, dt);
    angles.elbow = servo(angles.elbow, -(Math.PI - bend), dt);
    angles.wrist = servo(angles.wrist, -Math.PI / 2 - foreLift, dt, 5);
    turntable.rotation.y = angles.yaw;
    shoulder.rotation.z = angles.shoulder;
    elbow.rotation.z = angles.elbow;
    wrist.rotation.z = angles.wrist;

    knobs[0].rotation.y = angles.yaw;
    knobs[1].rotation.y = angles.shoulder * 2;
    knobs[2].rotation.y = angles.elbow * 2;
    knobs[3].rotation.y = grip * 2.4;

    group.updateWorldMatrix(true, true);
    group.worldToLocal(tip.getWorldPosition(reach));
    if (input.clicked) {
      if (held) {
        held.position.set(reach.x, -0.1, reach.z);
        held = null;
      } else {
        held = cubes.find((cube) => Math.hypot(cube.position.x - reach.x, cube.position.z - reach.z) < 0.6 && reach.y < 0.9) ?? null;
      }
    }
    for (const cube of cubes) {
      if (cube === held) { cube.position.set(reach.x, reach.y - 0.6, reach.z); cube.rotation.y = angles.yaw; }
      else cube.rotation.y += cube.userData.spin * dt;
    }
    grip += clamp((held ? 1 : 0) - grip, -dt * 6, dt * 6);
    fingers[0].position.x = -0.42 + grip * 0.1;
    fingers[1].position.x = 0.42 - grip * 0.1;
  }

  return { group, planeY: 0.2, update };
}
