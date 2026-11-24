import * as THREE from "three";
import { block, clamp, damp, engine, greeble, ink, loft, projection, seeded, tiles, windowRow, type Station } from "../kit.js";

const COLS = 16;
const ROWS = 8;
const PITCH = 0.5;
const ORIGIN_X = -2.9;
const PROBES = 40;

interface Probe { cell: number; from: THREE.Vector3; hit: THREE.Vector3; along: number; }
interface Spark { cell: number; hit: THREE.Vector3; age: number; }

const cellX = (cell: number) => ORIGIN_X + (cell % COLS) * PITCH;
const cellZ = (cell: number) => (Math.floor(cell / COLS) - (ROWS - 1) / 2) * PITCH;

/**
 * The test ship. Its deck is a field of memory cells; probes fly in and overwrite them
 * until the ship faults, goes dark, and restarts from its saved state.
 */
export function createFuzz(): Station {
  const group = new THREE.Group();
  const random = seeded(7);
  const count = COLS * ROWS;


  const cells = tiles(count, 0.42, 1, 0.42, "holo");
  cells.position.y = 0.04;
  group.add(cells);
  const darts = tiles(PROBES, 0.5, 0.07, 0.07, false);
  group.add(darts);
  const flying: Probe[] = [];

  // The cruiser projects its own memory map in front of it.
  const far = cellX(COLS - 1) + 0.3, near = cellX(0) - 0.3, half = ROWS * PITCH / 2 + 0.1;
  group.add(projection(new THREE.Vector3(0.8, 0.4, -4.3), [
    new THREE.Vector3(near, 0, -half), new THREE.Vector3(far, 0, -half), new THREE.Vector3(far, 0, half), new THREE.Vector3(near, 0, half),
  ]));
  // Where a probe strikes the hull, a flash, and a trace down to the cell it changed.
  const flashes = tiles(PROBES, 0.5, 0.5, 0.5, false);
  const sparks: Spark[] = [];
  const traceSpots = new Float32Array(PROBES * 6);
  const traceShape = new THREE.BufferGeometry();
  traceShape.setAttribute("position", new THREE.BufferAttribute(traceSpots, 3));
  const traces = new THREE.LineSegments(traceShape, new THREE.LineBasicMaterial({ color: new THREE.Color(ink.orange).multiplyScalar(3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  traces.frustumCulled = false;
  group.add(flashes, traces);

  // The saved state is orderly; overwrites are what disturb it.
  const saved = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const col = i % COLS, row = Math.floor(i / COLS);
    saved[i] = 0.16 + 0.14 * Math.sin(col * 0.8) * Math.cos(row * 0.9) + (col % 4 === 0 ? 0.2 : 0);
  }
  const value = Float32Array.from(saved);
  const shown = Float32Array.from(saved);
  const heat = new Float32Array(count);

  const cool = new THREE.Color(ink.steel), hot = new THREE.Color(ink.orange).multiplyScalar(4);
  const fault = new THREE.Color(ink.red).multiplyScalar(3), dart = new THREE.Color(ink.orange).multiplyScalar(5);
  const colour = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const turn = new THREE.Quaternion(), ahead = new THREE.Vector3(1, 0, 0), way = new THREE.Vector3(), spot = new THREE.Vector3();
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
          sparks.push({ cell: probe.cell, hit: probe.hit, age: 0 });
          flying.splice(i, 1);
        }
      }
      if (stress > 1 && random() < dt * 1.5) failing = 1.8;
    }

    flying.forEach((probe, index) => {
      spot.copy(probe.hit);
      way.subVectors(spot, probe.from).normalize();
      turn.setFromUnitVectors(ahead, way);
      spot.lerpVectors(probe.from, spot, probe.along);
      matrix.compose(spot, turn, way.set(1, 1, 1));
      darts.setMatrixAt(index, matrix);
      darts.setColorAt(index, dart);
    });
    for (let i = flying.length; i < PROBES; i++) darts.setMatrixAt(i, hidden);
    darts.instanceMatrix.needsUpdate = true;
    darts.instanceColor!.needsUpdate = true;

    traceSpots.fill(0);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      spark.age += dt;
      if (spark.age > 0.35) { sparks.splice(i, 1); continue; }
    }
    sparks.slice(0, PROBES).forEach((spark, index) => {
      const fade = 1 - spark.age / 0.35;
      matrix.makeScale(fade, fade, fade);
      matrix.setPosition(spark.hit.x, spark.hit.y - 0.25 * fade, spark.hit.z);
      flashes.setMatrixAt(index, matrix);
      flashes.setColorAt(index, dart);
      traceSpots.set([spark.hit.x, spark.hit.y, spark.hit.z, cellX(spark.cell), 0.4, cellZ(spark.cell)], index * 6);
    });
    for (let i = Math.min(sparks.length, PROBES); i < PROBES; i++) flashes.setMatrixAt(i, hidden);
    flashes.instanceMatrix.needsUpdate = true;
    flashes.instanceColor!.needsUpdate = true;
    traceShape.attributes.position.needsUpdate = true;

    const blink = failing > 0 && Math.sin(time * 30) > 0;
    // On a fault the cruiser itself loses power, then comes back.
    for (const lamp of (station.ship?.userData.lamps ?? []) as THREE.MeshStandardMaterial[]) lamp.emissiveIntensity = failing > 0 && !blink ? 0 : 3.2;
    for (let i = 0; i < count; i++) {
      heat[i] = Math.max(0, heat[i] - dt * 0.8);
      shown[i] = damp(shown[i], value[i], 12, dt);
      matrix.makeScale(1, 0.06 + clamp(shown[i], 0, 1) * 0.8, 1);
      matrix.setPosition(cellX(i), 0, cellZ(i));
      cells.setMatrixAt(i, matrix);
      if (failing > 0) colour.copy(blink ? fault : cool);
      else colour.copy(cool).lerp(hot, heat[i] * heat[i]);
      cells.setColorAt(i, colour);
    }
    cells.instanceMatrix.needsUpdate = true;
    cells.instanceColor!.needsUpdate = true;
  }

  const station: Station = { group, planeY: 0.4, update };
  return station;
}
