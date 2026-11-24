import * as THREE from "three";
import { block, clamp, damp, engine, glow, ink, loft, mast, matte, navLights, plate, windowRow, seeded, spar, tag, type Station } from "../kit.js";

const HALF_X = 3.8;
const HALF_Z = 3.2;
const FIELD_X = 2.8;
const DISH = new THREE.Vector3(-2.0, 0.2, 0);

interface Body {
  mesh: THREE.Mesh;
  frame: THREE.LineSegments;
  seen: THREE.Sprite;
  bite: THREE.Sprite;
  ore: boolean;
  x: number; z: number; vx: number; vz: number; size: number; spin: number; missed: number; phase: number; reel: number;
}

/**
 * The survey ship. Its detector boxes and names everything drifting ahead of it, and its
 * line calls a bite when ore drifts onto the lure.
 */
export function createScan(): Station {
  const group = new THREE.Group();
  const random = seeded(21);


  const frameShape = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const frameSeen = new THREE.LineBasicMaterial({ color: new THREE.Color(ink.yellow).multiplyScalar(2) });
  const frameBite = new THREE.LineBasicMaterial({ color: new THREE.Color(ink.orange).multiplyScalar(3) });
  const rockShape = new THREE.IcosahedronGeometry(0.5, 0);
  const oreShape = new THREE.OctahedronGeometry(0.5, 0);
  const oreLook = new THREE.MeshStandardMaterial({
    color: ink.orange, emissive: ink.orange, emissiveIntensity: 1.6, roughness: 0.4, flatShading: true,
  });

  const bodies: Body[] = [false, true, false, true, false, true, false].map((ore, index) => {
    const mesh = new THREE.Mesh(ore ? oreShape : rockShape, ore ? oreLook : matte(index % 2 ? ink.steel : ink.slate));
    const size = ore ? 0.55 + random() * 0.2 : 0.7 + random() * 0.7;
    mesh.scale.set(size, size * (0.7 + random() * 0.4), size * (0.8 + random() * 0.3));
    mesh.castShadow = true;
    const frame = new THREE.LineSegments(frameShape, frameSeen);
    const seen = tag(ore ? "ore" : "rock", "#ffb23e", "#0d1428");
    const bite = tag("bite", "#ff7a2b", "#0d1428");
    group.add(mesh, frame, seen, bite);
    return {
      mesh, frame, seen, bite, ore, size,
      x: FIELD_X + (random() - 0.5) * HALF_X * 1.7, z: (random() - 0.5) * HALF_Z * 1.7,
      vx: -(0.15 + random() * 0.3), vz: (random() - 0.5) * 0.25, spin: 0.2 + random() * 0.6,
      missed: 0, phase: index * 1.7, reel: 0,
    };
  });

  // The line: from the dish out to a lure that follows the pointer.
  const lure = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), glow(ink.cyan, 5));
  const linePoints = new Float32Array(6);
  const lineShape = new THREE.BufferGeometry();
  lineShape.setAttribute("position", new THREE.BufferAttribute(linePoints, 3));
  const line = new THREE.Line(lineShape, new THREE.LineBasicMaterial({ color: new THREE.Color(ink.cyan).multiplyScalar(2.5) }));
  line.frustumCulled = false;
  group.add(lure, line);
  const spot = new THREE.Vector2(2, 0.5);

  function update(dt: number, time: number, input: Parameters<Station["update"]>[2]) {
    if (input.point) spot.set(clamp(input.point.x, FIELD_X - HALF_X, FIELD_X + HALF_X), clamp(input.point.z, -HALF_Z, HALF_Z));
    else spot.set(FIELD_X + Math.sin(time * 0.31) * 3, Math.sin(time * 0.47 + 1) * 2);
    lure.position.x = damp(lure.position.x, spot.x, 10, dt);
    lure.position.z = damp(lure.position.z, spot.y, 10, dt);
    lure.position.y = 0.2;
    linePoints.set([DISH.x, DISH.y, DISH.z, lure.position.x, lure.position.y, lure.position.z]);
    lineShape.attributes.position.needsUpdate = true;

    for (const body of bodies) {
      const gap = Math.hypot(lure.position.x - body.x, lure.position.z - body.z);
      const hooked = body.ore && gap < 0.75;
      if (hooked && input.clicked) body.reel = 0.001;
      if (body.reel > 0) {
        // Reeled in along the line, then a new piece drifts in from ahead.
        body.reel += dt * 1.4;
        body.x += (DISH.x - body.x) * Math.min(1, dt * 5);
        body.z += (DISH.z - body.z) * Math.min(1, dt * 5);
        if (body.reel > 1) { body.reel = 0; body.x = FIELD_X + HALF_X; body.z = (random() - 0.5) * HALF_Z * 1.8; }
      } else {
        const pull = body.ore && gap < 2.2 && gap > 0.2 ? 0.9 : 0;
        body.x += (body.vx + (lure.position.x - body.x) / (gap + 0.01) * pull) * dt;
        body.z += (body.vz + (lure.position.z - body.z) / (gap + 0.01) * pull) * dt;
        if (body.x < FIELD_X - HALF_X) { body.x = FIELD_X + HALF_X; body.z = (random() - 0.5) * HALF_Z * 1.8; }
        if (Math.abs(body.z) > HALF_Z) body.vz *= -1;
      }
      body.mesh.position.set(body.x, 0.2, body.z);
      body.mesh.rotation.x += body.spin * dt;
      body.mesh.rotation.y += body.spin * 0.7 * dt;

      // The detector is good, not perfect: now and then it drops a frame.
      body.missed -= dt;
      if (body.missed < -2.5 - body.phase) body.missed = 0.16;
      const visible = body.missed <= 0 && body.reel === 0;
      const span = body.size * 1.25;
      body.frame.visible = visible;
      body.frame.material = hooked ? frameBite : frameSeen;
      body.frame.position.copy(body.mesh.position);
      body.frame.scale.setScalar(span);
      body.seen.visible = visible && !hooked;
      body.bite.visible = visible && hooked;
      body.seen.position.set(body.x - span / 2, 0.2 + span / 2, body.z - span / 2);
      body.bite.position.copy(body.seen.position);
    }
  }

  return { group, planeY: 0.2, update };
}
