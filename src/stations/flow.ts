import * as THREE from "three";
import { block, damp, engine, glow, ink, loft, mast, plate, projection, seeded, spar, tiles, type Station } from "../kit.js";

const HUB_X = -1.3;
const SOURCE_X = -6.2;
const LANES = [-3, 0, 3];
const BARS = 9;
const BAR_X = 0.6;
const BAR_PITCH = 0.62;
const REORDER = 0.9;
const PARCELS = 60;

interface Parcel { lane: number; along: number; }

/**
 * The freighter. Three feeder craft send cargo to one hold, and the hold drives the stacks
 * along the spine. A stack under the yellow rail is short on stock.
 */
export function createFlow(): Station {
  const group = new THREE.Group();
  const random = seeded(11);
  const laneInk = [ink.bone, ink.water, ink.yellow];
  const laneShades = laneInk.map((shade) => new THREE.Color(shade).multiplyScalar(2.2));


  // Feeder craft, one per report source.
  LANES.forEach((z, index) => {
    const feeder = new THREE.Group();
    feeder.position.set(SOURCE_X, 0.2, z);
    feeder.add(loft([
      { x: -0.8, w: 0.2, top: 0.2, bottom: -0.2, chamfer: 0.08 },
      { x: -0.4, w: 0.34, top: 0.3, bottom: -0.3, chamfer: 0.12 },
      { x: 0.4, w: 0.34, top: 0.3, bottom: -0.3, chamfer: 0.12 },
      { x: 0.95, w: 0.12, top: 0.1, bottom: -0.16, chamfer: 0.05 },
    ], laneInk[index]));
    feeder.add(plate([[-0.7, 0.3], [0.1, 0.3], [-0.3, 0.8], [-0.8, 0.8]], 0.05, ink.slate), plate([[-0.7, -0.3], [0.1, -0.3], [-0.3, -0.8], [-0.8, -0.8]], 0.05, ink.slate));
    group.add(feeder);
  });


  const parcels = tiles(PARCELS, 0.22, 0.22, 0.22, false);
  group.add(parcels);
  const moving: Parcel[] = [];

  const stacks = tiles(BARS, 0.46, 1, 1.5, "holo");
  // The freighter projects its stock levels above its own cargo.
  const left = BAR_X - 0.4, right = BAR_X + (BARS - 1) * BAR_PITCH + 0.4;
  group.add(projection(new THREE.Vector3((left + right) / 2, -0.15, 0), [
    new THREE.Vector3(left, 0, -0.9), new THREE.Vector3(right, 0, -0.9), new THREE.Vector3(right, 0, 0.9), new THREE.Vector3(left, 0, 0.9),
  ]));
  stacks.position.set(BAR_X, 0.02, 0);
  group.add(stacks);
  const railLength = BARS * BAR_PITCH + 0.2;
  const rail = (z: number) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(railLength, 0.04, 0.05), glow(ink.yellow, 2.4));
    bar.position.set(BAR_X + (BARS - 1) * BAR_PITCH / 2, REORDER, z);
    return bar;
  };
  group.add(rail(0.8), rail(-0.8));

  const level = Float32Array.from({ length: BARS }, () => 0.5 + random() * 1.6);
  const shown = Float32Array.from(level);
  const spawn = [0, 0.25, 0.5];
  let burst = 0;

  const stocked = new THREE.Color(ink.bone), short = new THREE.Color(ink.orange).multiplyScalar(2.6), lifted = new THREE.Color(0xffffff).multiplyScalar(3.4);
  const matrix = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const spot = new THREE.Vector3();

  function place(parcel: Parcel, out: THREE.Vector3) {
    // Each feed runs straight out, then turns in to the hold.
    const z = LANES[parcel.lane];
    const start = SOURCE_X + 1, straight = 1.4, end = HUB_X - 0.7;
    const diagonal = Math.hypot(end - start - straight, z);
    const travelled = parcel.along * (straight + diagonal);
    if (travelled < straight) return out.set(start + travelled, 0.2, z);
    const t = (travelled - straight) / diagonal;
    return out.set(start + straight + t * (end - start - straight), 0.2 + t * 0.3, z * (1 - t));
  }

  function update(dt: number, _time: number, input: Parameters<Station["update"]>[2]) {
    if (input.clicked) burst = 14;
    spawn.forEach((wait, lane) => {
      spawn[lane] = wait - dt * (burst > 0 ? 6 : 1);
      if (spawn[lane] <= 0 && moving.length < PARCELS) {
        spawn[lane] = 0.55 + random() * 0.5;
        moving.push({ lane, along: 0 });
        if (burst > 0) burst--;
      }
    });

    for (let i = moving.length - 1; i >= 0; i--) {
      moving[i].along += dt * 0.42;
      if (moving[i].along >= 1) {
        moving.splice(i, 1);
        // Every arriving row nudges one product's stock.
        level[Math.floor(random() * BARS)] = 0.25 + random() * 2.0;
      }
    }
    moving.forEach((parcel, index) => {
      matrix.makeScale(1, 1, 1);
      matrix.setPosition(place(parcel, spot));
      parcels.setMatrixAt(index, matrix);
      parcels.setColorAt(index, laneShades[parcel.lane]);
    });
    for (let i = moving.length; i < PARCELS; i++) parcels.setMatrixAt(i, hidden);
    parcels.instanceMatrix.needsUpdate = true;
    parcels.instanceColor!.needsUpdate = true;


    const hover = input.point && Math.abs(input.point.z) < 1.2 ? Math.round((input.point.x - BAR_X) / BAR_PITCH) : -1;
    for (let i = 0; i < BARS; i++) {
      shown[i] = damp(shown[i], level[i], 5, dt);
      matrix.makeScale(1, shown[i], 1);
      matrix.setPosition(i * BAR_PITCH, 0, 0);
      stacks.setMatrixAt(i, matrix);
      stacks.setColorAt(i, i === hover ? lifted : shown[i] < REORDER ? short : stocked);
    }
    stacks.instanceMatrix.needsUpdate = true;
    stacks.instanceColor!.needsUpdate = true;
  }

  return { group, planeY: 0.4, update };
}
