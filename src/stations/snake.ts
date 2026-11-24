import * as THREE from "three";
import { clamp, glow, ink, seeded, tiles, type Station } from "../kit.js";
import { flock } from "../props.js";

const HALF_X = 6;
const HALF_Z = 4;
const GAP = 0.62;
const LONGEST = 22;
const SPEED = 3.4;
/** Turns the container model so its long side runs along the direction of travel. */
const CAR_TURN: [number, number, number] = [0, 0, 0];

interface Convoy {
  x: number; z: number; heading: number;
  length: number;
  /** Where the lead ship has been, newest first, sampled every GAP of travel. */
  wake: { x: number; z: number; heading: number }[];
  travelled: number;
  shade: THREE.Color;
  lead: THREE.Color;
}

/**
 * Three linked convoys sharing one patch of space. The orange one is yours: it follows the
 * pointer, or the W A S D keys. Each grows a car for every beacon it collects.
 */
export function createSnake(): Station {
  const group = new THREE.Group();
  const random = seeded(5);

  // Each car is a cargo container, with a running light at its tail.
  const cars = flock("/models/container.glb", LONGEST * 3, 0.56, CAR_TURN, true);
  const tails = tiles(LONGEST * 3, 0.06, 0.06, 0.12, false);
  group.add(cars.group, tails);

  const convoys: Convoy[] = [ink.orange, ink.bone, ink.water].map((shade, index) => ({
    x: -3 + index * 3, z: -2 + index * 2, heading: index * 2.1, length: 6, wake: [], travelled: 0,
    shade: new THREE.Color(shade), lead: new THREE.Color(shade).multiplyScalar(4),
  }));

  const beaconLook = glow(ink.yellow, 4);
  const beacons = [0, 1, 2, 3].map(() => {
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), beaconLook);
    beacon.position.set((random() - 0.5) * HALF_X * 1.7, 0.15, (random() - 0.5) * HALF_Z * 1.7);
    group.add(beacon);
    return beacon;
  });

  // The patch of space they share, marked by four corner lights.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), glow(ink.cyan, 2));
    light.position.set(sx * HALF_X, 0, sz * HALF_Z);
    group.add(light);
  }

  let keyTurn = 0;
  let keyHold = 0;
  const matrix = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const turn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), place = new THREE.Vector3(), size = new THREE.Vector3();

  function update(dt: number, time: number, input: Parameters<Station["update"]>[2]) {
    if (input.keys.has("a")) { keyTurn = 1; keyHold = 0.35; }
    if (input.keys.has("d")) { keyTurn = -1; keyHold = 0.35; }
    keyHold -= dt;

    let slot = 0;
    convoys.forEach((convoy, index) => {
      // Aim at the pointer (yours) or the nearest beacon, and turn back at the edge.
      let aimX = 0, aimZ = 0, best = Infinity;
      for (const beacon of beacons) {
        const far = Math.hypot(beacon.position.x - convoy.x, beacon.position.z - convoy.z);
        if (far < best) { best = far; aimX = beacon.position.x; aimZ = beacon.position.z; }
      }
      if (index === 0 && input.point) { aimX = input.point.x; aimZ = input.point.z; }
      if (Math.abs(convoy.x) > HALF_X || Math.abs(convoy.z) > HALF_Z) { aimX = 0; aimZ = 0; }
      const wish = Math.atan2(aimZ - convoy.z, aimX - convoy.x);
      let steer = clamp(Math.atan2(Math.sin(wish - convoy.heading), Math.cos(wish - convoy.heading)), -1, 1);
      if (index === 0 && keyHold > 0) steer = -keyTurn;
      convoy.heading += steer * dt * 5;
      convoy.x += Math.cos(convoy.heading) * SPEED * dt;
      convoy.z += Math.sin(convoy.heading) * SPEED * dt;
      convoy.travelled += SPEED * dt;
      while (convoy.travelled >= GAP) {
        convoy.travelled -= GAP;
        convoy.wake.unshift({ x: convoy.x, z: convoy.z, heading: convoy.heading });
        if (convoy.wake.length > LONGEST) convoy.wake.pop();
      }

      for (const beacon of beacons) {
        if (Math.hypot(beacon.position.x - convoy.x, beacon.position.z - convoy.z) < 0.75) {
          beacon.position.set((random() - 0.5) * HALF_X * 1.7, 0.15, (random() - 0.5) * HALF_Z * 1.7);
          convoy.length = convoy.length >= LONGEST ? 6 : convoy.length + 1;
        }
      }

      for (let car = 0; car < convoy.length; car++) {
        const at = car === 0 ? convoy : convoy.wake[car - 1];
        if (!at) break;
        place.set(at.x, 0, at.z);
        turn.setFromAxisAngle(up, -at.heading);
        place.y = 0.2;
        size.setScalar(car === 0 ? 1.25 : 1);
        matrix.compose(place, turn, size);
        cars.place(slot, matrix, convoy.shade);
        place.set(at.x - Math.cos(at.heading) * 0.34, 0.2, at.z - Math.sin(at.heading) * 0.34);
        matrix.compose(place, turn, size.set(1.4, 1.4, 1.4));
        tails.setMatrixAt(slot, matrix);
        tails.setColorAt(slot, convoy.lead);
        slot++;
      }
    });
    for (; slot < LONGEST * 3; slot++) { cars.hide(slot); tails.setMatrixAt(slot, hidden); }
    tails.instanceMatrix.needsUpdate = true;
    tails.instanceColor!.needsUpdate = true;
    cars.commit();
    beacons.forEach((beacon, index) => { beacon.rotation.y = time * 1.5 + index; });
  }

  return { group, planeY: 0.15, update };
}
