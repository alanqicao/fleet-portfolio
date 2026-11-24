import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { lamp, plume, puff } from "./kit.js";
import { modelUrl } from "./models.js";

export interface ShipSpec {
  /** Path of the compressed model under /models. */
  file: string;
  /** Length of the ship along its longest side, in scene units. */
  length: number;
  /** Rotation that brings the model's nose round to +x, in radians: [x, y, z]. */
  turn: [number, number, number];
  /** Where the ship sits relative to its station. */
  at: [number, number, number];
  /** Put the top of the hull at `at`, for ships that carry something on their back. */
  seatTop?: boolean;
  /**
   * Drive nozzles as seen from astern: `z` across the beam from port (0) to starboard (1),
   * `y` from keel (0) to top (1), `r` the nozzle radius as a share of the beam.
   */
  drives?: { z: number; y: number; r: number; tall?: number }[];
  driveColor?: number;
  /** How far forward of the very stern the nozzles sit, as a share of the length. */
  driveInset?: number;
}

export type Jet = "port" | "starboard" | "yawLeft" | "yawRight";

/** What a loaded ship can be told to do. Safe to call before the model has arrived. */
export interface ShipLive {
  /** Throttle the drives: about 0.6 cruising, up to 2 for a burn. */
  thrust(level: number): void;
  /** Fire a pair of attitude jets. */
  jet(kind: Jet): void;
  /** Cut or restore the ship's power: lights, drives and jets. */
  power(on: boolean): void;
  tick(time: number, dt: number): void;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
let fleetSize = 0;

/** Load a ship model, centre it, scale it, and fit it with drives, attitude jets and running lights. */
export function loadShip(spec: ShipSpec) {
  const holder = new THREE.Group();
  holder.position.set(...spec.at);
  const phase = fleetSize++ * 0.37;

  const plumes: ReturnType<typeof plume>[] = [];
  const jets: Record<string, ReturnType<typeof puff>> = {};
  const windows: THREE.MeshStandardMaterial[] = [];
  const driveGlow: THREE.MeshStandardMaterial[] = [];
  const strobeGlow: THREE.MeshStandardMaterial[] = [];
  const beaconGlow: THREE.MeshStandardMaterial[] = [];
  const steady: THREE.Sprite[] = [];
  let strobe: THREE.Sprite | undefined;
  let powered = true;
  let level = 0.7;

  const live: ShipLive = {
    thrust(value) {
      level = value;
      const push = powered ? value : 0.05;
      for (const drive of plumes) drive.thrust(push);
      for (const look of driveGlow) look.emissiveIntensity = powered ? 1.2 + value * 2.6 : 0;
    },
    jet(kind) {
      if (!powered) return;
      const pair = { port: ["bowPort", "sternPort"], starboard: ["bowStar", "sternStar"], yawLeft: ["bowStar", "sternPort"], yawRight: ["bowPort", "sternStar"] }[kind];
      for (const name of pair) jets[name]?.fire();
    },
    power(on) {
      if (on === powered) return;
      powered = on;
      for (const look of windows) look.emissiveIntensity = on ? 3.2 : 0;
      for (const light of steady) light.visible = on;
      live.thrust(level);
    },
    tick(time, dt) {
      for (const jet of Object.values(jets)) jet.tick(dt);
      // Anti-collision strobe: a double flash, then dark. The beacon turns over more slowly.
      const beat = (time * 0.75 + phase) % 1;
      const flash = powered && (beat < 0.045 || (beat > 0.13 && beat < 0.175));
      if (strobe) strobe.visible = flash;
      for (const look of strobeGlow) look.emissiveIntensity = flash ? 9 : 0.2;
      const turnOver = powered && (time * 0.5 + phase) % 1 < 0.45;
      for (const look of beaconGlow) look.emissiveIntensity = turnOver ? 5 : 0.4;
    },
  };
  holder.userData.live = live;

  loader.load(modelUrl(spec.file), (gltf) => {
    const model = gltf.scene;
    model.rotation.set(...spec.turn);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    model.position.sub(centre);
    if (spec.seatTop) model.position.y -= size.y / 2;
    model.updateMatrixWorld(true);
    // One scene unit, measured in the model's own units.
    const unit = Math.max(size.x, size.y, size.z) / spec.length;
    holder.scale.setScalar(1 / unit);

    // Walk the hull once to find where its lights and jets belong: the wingtips, the highest
    // point, and the outermost point of each quarter.
    const tips = {
      port: new THREE.Vector3(0, 0, Infinity), star: new THREE.Vector3(0, 0, -Infinity), top: new THREE.Vector3(0, -Infinity, 0),
      bowPort: new THREE.Vector3(0, 0, Infinity), bowStar: new THREE.Vector3(0, 0, -Infinity),
      sternPort: new THREE.Vector3(0, 0, Infinity), sternStar: new THREE.Vector3(0, 0, -Infinity),
    };
    const spot = new THREE.Vector3();
    model.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      part.castShadow = true;
      part.receiveShadow = true;
      const look = part.material as THREE.MeshStandardMaterial;
      // Some models name their lamps; those can blink on their own. The rest light as one.
      if (/engine.*glow/i.test(look.name)) driveGlow.push(look);
      else if (/white.?light/i.test(look.name)) strobeGlow.push(look);
      else if (/red.?light/i.test(look.name)) beaconGlow.push(look);
      else if (look.emissiveMap) { look.emissiveIntensity = 3.2; windows.push(look); }

      const points = part.geometry.attributes.position;
      const stride = Math.max(1, Math.floor(points.count / 5000));
      for (let i = 0; i < points.count; i += stride) {
        spot.fromBufferAttribute(points, i).applyMatrix4(part.matrixWorld);
        if (spot.z < tips.port.z) tips.port.copy(spot);
        if (spot.z > tips.star.z) tips.star.copy(spot);
        if (spot.y > tips.top.y) tips.top.copy(spot);
        if (spot.x > size.x * 0.22) {
          if (spot.z < tips.bowPort.z) tips.bowPort.copy(spot);
          if (spot.z > tips.bowStar.z) tips.bowStar.copy(spot);
        } else if (spot.x < -size.x * 0.22) {
          if (spot.z < tips.sternPort.z) tips.sternPort.copy(spot);
          if (spot.z > tips.sternStar.z) tips.sternStar.copy(spot);
        }
      }
    });
    holder.add(model);

    // Running lights: red to port, green to starboard, steady, as on any vessel.
    const light = (color: number, at: THREE.Vector3, scale: number, strength: number) => {
      const sprite = lamp(color, scale * unit, strength);
      sprite.position.copy(at);
      holder.add(sprite);
      return sprite;
    };
    steady.push(light(0xff2a1f, tips.port, 0.5, 2.2), light(0x35ff6a, tips.star, 0.5, 2.2));
    strobe = light(0xffffff, tips.top, 1.3, 5);

    for (const [name, aim] of [["bowPort", -1], ["bowStar", 1], ["sternPort", -1], ["sternStar", 1]] as const) {
      const jet = puff(1.3 * unit, new THREE.Vector3(0, 0.25, aim));
      jet.mesh.position.copy(tips[name]);
      holder.add(jet.mesh);
      jets[name] = jet;
    }

    for (const drive of spec.drives ?? []) {
      const exhaust = plume(drive.r * size.z, spec.driveColor ?? 0x8fdcff, drive.tall);
      exhaust.group.position.set(
        -size.x / 2 + (spec.driveInset ?? 0.01) * size.x,
        (drive.y - 0.5) * size.y - (spec.seatTop ? size.y / 2 : 0),
        (drive.z - 0.5) * size.z,
      );
      holder.add(exhaust.group);
      plumes.push(exhaust);
    }
    live.thrust(level);
    if (!powered) { powered = true; live.power(false); }
  }, undefined, (error) => {
    console.error(`Ship model ${spec.file} failed to load.`, error);
  });
  return holder;
}
