import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { plume } from "./kit.js";

export interface ShipSpec {
  /** Path of the compressed model under /models. */
  file: string;
  /** Length of the ship along its long axis, in scene units. */
  length: number;
  /** Rotation that brings the model's nose round to +x, in radians: [x, y, z]. */
  turn: [number, number, number];
  /** Where the ship sits relative to its hologram table. */
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

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/** Load a ship model, centre it, and scale it to the given length. The group fills in when the file arrives. */
export function loadShip(spec: ShipSpec) {
  const holder = new THREE.Group();
  holder.position.set(...spec.at);
  loader.load(spec.file, (gltf) => {
    const model = gltf.scene;
    const lamps: THREE.MeshStandardMaterial[] = [];
    model.rotation.set(...spec.turn);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    model.position.sub(centre);
    if (spec.seatTop) model.position.y -= size.y / 2;
    holder.scale.setScalar(spec.length / Math.max(size.x, size.y, size.z));
    model.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      part.castShadow = true;
      part.receiveShadow = true;
      const material = part.material as THREE.MeshStandardMaterial;
      // Lit windows and drives should be bright enough for the bloom pass to catch.
      if (material.emissiveMap) {
        material.emissiveIntensity = 3.2;
        lamps.push(material);
      }
    });
    for (const drive of spec.drives ?? []) {
      const exhaust = plume(drive.r * size.z, spec.driveColor ?? 0x8fdcff, drive.tall);
      exhaust.position.set(
        -size.x / 2 + (spec.driveInset ?? 0.01) * size.x,
        (drive.y - 0.5) * size.y - (spec.seatTop ? size.y / 2 : 0),
        (drive.z - 0.5) * size.z,
      );
      holder.add(exhaust);
    }
    holder.userData.lamps = lamps;
    holder.add(model);
  }, undefined, (error) => {
    console.error(`Ship model ${spec.file} failed to load.`, error);
  });
  return holder;
}
