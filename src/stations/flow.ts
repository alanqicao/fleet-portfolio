import * as THREE from "three";
import { block, damp, ink, lamp, seeded, type Station } from "../kit.js";
import { flock, prop } from "../props.js";

const HUB_X = -1.3;
const SOURCE_X = -6.2;
const LANES = [-3, 0, 3];
const BAYS = 9;
const BAY_X = 0.6;
const BAY_PITCH = 0.66;
const TALLEST = 5;
const BOX = 0.5;
/** A bay holding fewer containers than this is short on stock. */
const REORDER = 2;
const PARCELS = 60;
/** Turns the pod model so its nose points toward the freighter. */
const POD_TURN: [number, number, number] = [0, 0, 0];

interface Parcel { lane: number; along: number; }

/**
 * The freighter. Three feeder craft send crates to it, and each crate that arrives changes
 * how many containers one of its bays holds. A bay that runs low shows a red lamp.
 */
export function createFlow(): Station {
  const group = new THREE.Group();
  const random = seeded(11);
  const laneInk = [ink.bone, ink.water, ink.yellow];
  const laneTint = [0xffffff, 0x8fb8ff, 0xffd27a].map((shade) => new THREE.Color(shade));

  // Feeder craft, one per report source, each with a lamp in its lane's colour.
  LANES.forEach((z, index) => {
    const feeder = new THREE.Group();
    feeder.position.set(SOURCE_X, 0.2, z);
    feeder.add(prop("/models/pod.glb", 1.7, { turn: POD_TURN }));
    const marker = lamp(laneInk[index], 0.5, 3);
    marker.position.set(0.2, 0.55, 0);
    feeder.add(marker);
    group.add(feeder);
  });

  // Crates in flight between the feeders and the freighter.
  const parcels = flock("/models/crate.glb", PARCELS, 0.3);
  group.add(parcels.group);
  const moving: Parcel[] = [];

  // The bays: a rack along the freighter's spine, a stack of containers in each, and a lamp per bay.
  const containers = flock("/models/container.glb", BAYS * TALLEST, BOX);
  group.add(containers.group, block(BAYS * BAY_PITCH + 0.2, 0.08, 1.0, ink.graphite, BAY_X + (BAYS - 1) * BAY_PITCH / 2, 0, 0));
  const lamps = Array.from({ length: BAYS }, (_, bay) => {
    const x = BAY_X + bay * BAY_PITCH;
    group.add(block(0.05, TALLEST * BOX + 0.2, 0.05, ink.steel, x - BAY_PITCH / 2, 0, 0.55));
    const pair = { ok: lamp(ink.green, 0.22, 1.3), low: lamp(ink.red, 0.5, 3) };
    for (const light of Object.values(pair)) { light.position.set(x, 0.14, 0.62); group.add(light); }
    return pair;
  });
  group.add(block(0.05, TALLEST * BOX + 0.2, 0.05, ink.steel, BAY_X + (BAYS - 0.5) * BAY_PITCH, 0, 0.55));

  const level = Float32Array.from({ length: BAYS }, () => 1 + random() * 3.6);
  const shown = Float32Array.from(level);
  const spawn = [0, 0.25, 0.5];
  let burst = 0;

  const plain = new THREE.Color(0xffffff), picked = new THREE.Color(0xffffff).multiplyScalar(2.6), short = new THREE.Color(0xffb38a);
  const matrix = new THREE.Matrix4();
  const spot = new THREE.Vector3();
  const spin = new THREE.Quaternion(), axis = new THREE.Vector3(0.3, 1, 0.2).normalize(), size = new THREE.Vector3(1, 1, 1);

  function place(parcel: Parcel, out: THREE.Vector3) {
    // Each feed runs straight out, then turns in to the freighter's hold.
    const z = LANES[parcel.lane];
    const start = SOURCE_X + 1, straight = 1.4, end = HUB_X - 0.7;
    const diagonal = Math.hypot(end - start - straight, z);
    const travelled = parcel.along * (straight + diagonal);
    if (travelled < straight) return out.set(start + travelled, 0.2, z);
    const t = (travelled - straight) / diagonal;
    return out.set(start + straight + t * (end - start - straight), 0.2 + t * 0.3, z * (1 - t));
  }

  function update(dt: number, time: number, input: Parameters<Station["update"]>[2]) {
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
        // Every arriving crate changes one bay's stock.
        level[Math.floor(random() * BAYS)] = 0.6 + random() * 4.3;
      }
    }
    for (let i = 0; i < PARCELS; i++) {
      const parcel = moving[i];
      if (!parcel) { parcels.hide(i); continue; }
      // Crates tumble slowly as they cross.
      spin.setFromAxisAngle(axis, time * 0.8 + i * 1.7);
      matrix.compose(place(parcel, spot), spin, size);
      parcels.place(i, matrix, laneTint[parcel.lane]);
    }
    parcels.commit();

    const hover = input.point && Math.abs(input.point.z) < 1.2 ? Math.round((input.point.x - BAY_X) / BAY_PITCH) : -1;
    for (let bay = 0; bay < BAYS; bay++) {
      shown[bay] = damp(shown[bay], level[bay], 4, dt);
      const held = Math.min(TALLEST, Math.max(0, Math.round(shown[bay])));
      const low = held < REORDER;
      lamps[bay].ok.visible = !low;
      // A low bay's lamp pulses, as a warning should.
      lamps[bay].low.visible = low && Math.sin(time * 6) > -0.3;
      for (let tier = 0; tier < TALLEST; tier++) {
        const slot = bay * TALLEST + tier;
        if (tier >= held) { containers.hide(slot); continue; }
        matrix.makeTranslation(BAY_X + bay * BAY_PITCH, 0.08 + BOX * 0.5 + tier * BOX * 1.02, 0);
        containers.place(slot, matrix, bay === hover ? picked : low ? short : plain);
      }
    }
    containers.commit();
  }

  return { group, planeY: 0.4, update };
}
