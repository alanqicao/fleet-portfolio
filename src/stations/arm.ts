import * as THREE from "three";
import { block, clamp, ink, post, type Station } from "../kit.js";
import { prop } from "../props.js";
import { loadArm } from "../rig.js";

const CRATE_Y = 0.26;

/** Turn an angle toward a goal at a limited speed, the way a servo does. */
function servo(angle: number, goal: number, dt: number, speed = 2.6) {
  const gap = Math.atan2(Math.sin(goal - angle), Math.cos(goal - angle));
  return angle + clamp(gap, -speed * dt, speed * dt);
}

/** The tug. An industrial arm on its back reaches for the pointer and handles drifting cargo. */
export function createArm(): Station {
  const group = new THREE.Group();

  const arm = loadArm({
    file: "/models/arm.glb",
    base: "Cylinder002", shoulder: "Cylinder003", elbow: "Circle006", wrist: "Circle009", tip: "Circle011",
    fingers: ["Line013", "Line012"],
    hide: ["Rectangle002", "Line020", "Line024"],
    reach: 4.6,
  });
  group.add(arm.group);

  // One knob per joint on a small console beside the arm, as on the real build.
  group.add(block(0.7, 0.4, 1.7, ink.slate, -1.7, 0, 0));
  const knobs = [0, 1, 2, 3].map((index) => {
    const knob = new THREE.Group();
    knob.position.set(-1.7, 0.4, -0.6 + index * 0.4);
    knob.add(post(0.14, 0.16, ink.orange, 0, 0, 0, 16), block(0.04, 0.03, 0.15, ink.bone, 0, 0.16, -0.06));
    group.add(knob);
    return knob;
  });

  // Cargo crates adrift round the tug. Each is centred on its own position.
  const crate = (x: number, z: number) => {
    const box = prop("/models/crate.glb", 0.72);
    box.position.set(x, CRATE_Y, z);
    box.userData.spin = 0.2 + Math.abs(x) * 0.05;
    return box;
  };
  const cubes = [crate(2.5, 1.7), crate(1.2, -2.7), crate(-1.7, -2.4)];
  group.add(...cubes);
  let held: THREE.Object3D | null = null;

  const pose = { bearing: 0.4, upper: 1.0, fore: -0.4 };
  const goal = new THREE.Vector3(3, 1, 0);
  const reach = new THREE.Vector3();
  let grip = 0;

  function update(dt: number, time: number, input: Parameters<Station["update"]>[2]) {
    const { shoulderY, upper, fore, hand, back } = arm.dims;
    if (input.point) goal.set(input.point.x, held ? 1.1 : 0.45, input.point.z);
    else goal.set(Math.cos(time * 0.45) * 3.2, 1.4 + Math.sin(time * 0.9) * 0.5, Math.sin(time * 0.45) * 2.6);

    // Keep the goal where the arm can actually get to, then solve the two links for it.
    // The shoulder sits behind the axis the arm turns about, so its reach is measured from there.
    const radius = clamp(Math.hypot(goal.x, goal.z), 1.6, upper + fore - back - 0.4) + back;
    const bearing = Math.atan2(-goal.z, goal.x);
    const rise = goal.y + hand - shoulderY;
    const span = clamp(Math.hypot(radius, rise), Math.abs(upper - fore) + 0.2, upper + fore - 0.05);
    const upperLift = Math.atan2(rise, radius) + Math.acos((upper * upper + span * span - fore * fore) / (2 * upper * span));
    const bend = Math.acos((upper * upper + fore * fore - span * span) / (2 * upper * fore));
    const foreLift = upperLift - (Math.PI - bend);

    pose.bearing = servo(pose.bearing, bearing, dt);
    pose.upper = servo(pose.upper, upperLift, dt);
    pose.fore = servo(pose.fore, foreLift, dt);
    arm.pose(pose.bearing, pose.upper, pose.fore, grip);

    knobs[0].rotation.y = pose.bearing;
    knobs[1].rotation.y = pose.upper * 2;
    knobs[2].rotation.y = pose.fore * 2;
    knobs[3].rotation.y = grip * 2.4;

    group.updateWorldMatrix(true, true);
    group.worldToLocal(arm.tip(reach));
    if (input.clicked) {
      if (held) {
        held.position.set(reach.x, CRATE_Y, reach.z);
        held = null;
      } else {
        held = cubes.find((cube) => Math.hypot(cube.position.x - reach.x, cube.position.z - reach.z) < 0.7 && reach.y < 1.3) ?? null;
      }
    }
    for (const cube of cubes) {
      if (cube === held) { cube.position.set(reach.x, reach.y - 0.45, reach.z); cube.rotation.y = pose.bearing; }
      else cube.rotation.y += cube.userData.spin * dt;
    }
    grip += clamp((held ? 1 : 0) - grip, -dt * 6, dt * 6);
  }

  return { group, planeY: 0.3, update };
}
