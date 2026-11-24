import * as THREE from "three";
import { block, clamp, damp, housing, ink, lamp, probeShape, seeded, tiles, type Station } from "../kit.js";
import type { ShipLive } from "../ship.js";

const COLS = 16;
const ROWS = 8;
const PITCH = 0.5;
const ORIGIN_X = -2.9;
const PROBES = 40;

interface Probe { cell: number; from: THREE.Vector3; hit: THREE.Vector3; along: number; }
interface Spark { hit: THREE.Vector3; age: number; }

const cellX = (cell: number) => ORIGIN_X + (cell % COLS) * PITCH;
const cellZ = (cell: number) => (Math.floor(cell / COLS) - (ROWS - 1) / 2) * PITCH;

/**
 * The cruiser under test, and the monitor that flies beside it showing its memory. Probes
 * strike the hull and overwrite cells until the ship faults, loses power, and restarts from
 * its saved state.
 */
export function createFuzz(): Station {
  const group = new THREE.Group();
  const random = seeded(7);
  const count = COLS * ROWS;
  const midX = ORIGIN_X + (COLS - 1) * PITCH / 2;

  // The monitor: a display panel in a metal housing, kept on station by a thruster pod at each corner.
  group.add(housing(COLS * PITCH + 0.2, ROWS * PITCH + 0.2, midX, 0));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const cx = midX + sx * (COLS * PITCH / 2 + 0.45), cz = sz * (ROWS * PITCH / 2 + 0.45);
    group.add(block(0.36, 0.3, 0.36, ink.slate, cx, -0.4, cz));
    const marker = lamp(sx > 0 ? ink.green : ink.red, 0.3, 1.6);
    marker.position.set(cx, -0.05, cz);
    group.add(marker);
  }
  const cells = tiles(count, 0.44, 0.03, 0.44, false);
  group.add(cells);

  // Probes: small guided rounds, each with a lit motor.
  const rounds = tiles(PROBES, 1, 1, 1, true, probeShape());
  const motors = tiles(PROBES, 0.1, 0.06, 0.06, false);
  const flashes = tiles(PROBES, 0.42, 0.42, 0.42, false, new THREE.IcosahedronGeometry(0.5, 1));
  group.add(rounds, motors, flashes);
  const flying: Probe[] = [];
  const sparks: Spark[] = [];

  // The saved state is orderly; overwrites are what disturb it.
  const saved = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const col = i % COLS, row = Math.floor(i / COLS);
    saved[i] = 0.3 + 0.22 * Math.sin(col * 0.8) * Math.cos(row * 0.9) + (col % 4 === 0 ? 0.25 : 0);
  }
  const value = Float32Array.from(saved);
  const shown = Float32Array.from(saved);
  const heat = new Float32Array(count);

  const dim = new THREE.Color(0x06121c), lit = new THREE.Color(0x2f9bd6).multiplyScalar(1.5);
  const hot = new THREE.Color(ink.orange).multiplyScalar(4), fault = new THREE.Color(ink.red).multiplyScalar(3);
  const casing = new THREE.Color(0xb9c0cc), burn = new THREE.Color(0xffa24a).multiplyScalar(5);
  const colour = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const turn = new THREE.Quaternion(), ahead = new THREE.Vector3(1, 0, 0), way = new THREE.Vector3();
  const spot = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), grow = new THREE.Vector3();
  let autoTimer = 0;
  let stress = 0;
  let failing = 0;

  function launch(cell: number) {
    if (flying.length >= PROBES) return;
    // Aimed at the hull itself, somewhere along its length.
    const hit = new THREE.Vector3(0.8 + (random() - 0.5) * 11, 1.0 + (random() - 0.5) * 1.1, -4.7 + (random() - 0.5) * 0.6);
    flying.push({ cell, hit, along: 0, from: new THREE.Vector3(hit.x + (random() - 0.5) * 10, 4 + random() * 4, 14 + random() * 6) });
  }

  function update(dt: number, time: number, input: Parameters<Station["update"]>[2]) {
    if (failing > 0) {
      failing -= dt;
      flying.length = 0;
      if (failing <= 0) { value.set(saved); heat.fill(0); stress = 0; }
    } else {
      autoTimer -= dt;
      if (autoTimer <= 0) { autoTimer = 0.16; launch(Math.floor(random() * count)); }
      if (input.point) {
        for (let i = 0; i < count; i++) {
          const dx = cellX(i) - input.point.x, dz = cellZ(i) - input.point.z;
          const near = dx * dx + dz * dz;
          if (near < 0.8 && random() < dt * 5) launch(i);
          if (input.clicked && near < 3.2 && random() < 0.45) launch(i);
        }
        if (input.clicked) stress += 0.2;
      }
      for (let i = flying.length - 1; i >= 0; i--) {
        const probe = flying[i];
        probe.along += dt * 1.9;
        if (probe.along >= 1) {
          value[probe.cell] = random();
          heat[probe.cell] = 1;
          stress += 0.006;
          sparks.push({ hit: probe.hit, age: 0 });
          flying.splice(i, 1);
        }
      }
      if (stress > 1 && random() < dt * 1.5) failing = 1.8;
    }

    flying.forEach((probe, index) => {
      way.subVectors(probe.hit, probe.from).normalize();
      turn.setFromUnitVectors(ahead, way);
      spot.lerpVectors(probe.from, probe.hit, probe.along);
      matrix.compose(spot, turn, one);
      rounds.setMatrixAt(index, matrix);
      rounds.setColorAt(index, casing);
      spot.addScaledVector(way, -0.24);
      matrix.compose(spot, turn, one);
      motors.setMatrixAt(index, matrix);
      motors.setColorAt(index, burn);
    });
    for (let i = flying.length; i < PROBES; i++) { rounds.setMatrixAt(i, hidden); motors.setMatrixAt(i, hidden); }
    for (const mesh of [rounds, motors]) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true; }

    // Where a probe strikes, a brief flash on the hull.
    for (let i = sparks.length - 1; i >= 0; i--) {
      sparks[i].age += dt;
      if (sparks[i].age > 0.3) sparks.splice(i, 1);
    }
    sparks.slice(0, PROBES).forEach((spark, index) => {
      const fade = 1 - spark.age / 0.3;
      matrix.compose(spark.hit, turn.identity(), grow.setScalar(0.35 + (1 - fade) * 0.9));
      flashes.setMatrixAt(index, matrix);
      flashes.setColorAt(index, colour.copy(burn).multiplyScalar(fade));
    });
    for (let i = Math.min(sparks.length, PROBES); i < PROBES; i++) flashes.setMatrixAt(i, hidden);
    flashes.instanceMatrix.needsUpdate = true;
    flashes.instanceColor!.needsUpdate = true;

    // On a fault the cruiser itself loses power, flickers, and comes back.
    const blink = failing > 0 && Math.sin(time * 30) > 0;
    (station.ship?.userData.live as ShipLive | undefined)?.power(failing <= 0 || blink);

    for (let i = 0; i < count; i++) {
      heat[i] = Math.max(0, heat[i] - dt * 0.8);
      shown[i] = damp(shown[i], value[i], 12, dt);
      matrix.makeTranslation(cellX(i), 0, cellZ(i));
      cells.setMatrixAt(i, matrix);
      // Each element shows its cell's value as brightness; a fresh overwrite shows hot.
      if (failing > 0) colour.copy(blink ? fault : dim);
      else colour.copy(dim).lerp(lit, clamp(shown[i], 0, 1)).lerp(hot, heat[i] * heat[i]);
      cells.setColorAt(i, colour);
    }
    cells.instanceMatrix.needsUpdate = true;
    cells.instanceColor!.needsUpdate = true;
  }

  const station: Station = { group, planeY: 0.1, update };
  return station;
}
