import * as THREE from "three";
import { block, damp, glow, housing, ink, lamp, post, tiles, type Station } from "../kit.js";

const SIZE = 16;
const PITCH = 0.42;
const HALF = (SIZE - 1) * PITCH / 2;
const BOARD_X = -1.0;

/** Blank, then the four paints. The values are the light each element gives off when lit. */
const paints = [0x05080c, 0xdfe6f0, 0xff5a1f, 0xffe04a, 0x3f8cff];
const art = [
  "................",
  "................",
  ".......b........",
  ".....wwwwww.....",
  "..o.wwwwwwwww...",
  ".yoowwwbbwwwww..",
  "yyoowwwbbwwwwww.",
  "yyoowwwwwwwwwwww",
  "yyoowwwwwwwwwww.",
  ".yoowwwwwwwwww..",
  "..o.wwwwwwwww...",
  ".....wwwwww.....",
  ".......b........",
  "................",
  "................",
  "................",
];
const letter: Record<string, number> = { ".": 0, w: 1, o: 2, y: 3, b: 4 };

/**
 * The signal carrier. A display panel is set into its flight deck, one lamp per pixel, and
 * you paint it. A well beside the panel holds each colour.
 */
export function createSprite(): Station {
  const group = new THREE.Group();
  group.add(housing(SIZE * PITCH + 0.12, SIZE * PITCH + 0.12, BOARD_X, 0));
  const pixels = tiles(SIZE * SIZE, 0.36, 0.03, 0.36, false);
  group.add(pixels);

  const cells = new Uint8Array(SIZE * SIZE);
  art.forEach((row, z) => [...row].forEach((mark, x) => { cells[z * SIZE + x] = letter[mark]; }));
  const level = new Float32Array(SIZE * SIZE).fill(1);

  // Paint wells beside the panel: a low metal ring with a lit cap in its colour. They sit at
  // deck level so a click lands where it looks like it lands. The chosen one shows a marker lamp.
  const pots = paints.map((paint, index) => {
    const pot = new THREE.Group();
    pot.position.set(3.3, 0, -2.2 + index * 1.1);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 24), glow(index === 0 ? 0x1a2230 : paint, index === 0 ? 1 : 1.3));
    cap.position.y = 0.1;
    const marker = lamp(0xffffff, 0.5, 2.4);
    marker.position.set(0.55, 0.12, 0);
    pot.add(post(0.4, 0.09, ink.steel, 0, 0, 0, 24), cap, marker);
    pot.userData.marker = marker;
    group.add(block(0.95, 0.06, 0.95, ink.graphite, 3.3, -0.05, -2.2 + index * 1.1), pot);
    return pot;
  });
  let brush = 2;
  let touched = false;

  const shades = paints.map((paint, index) => new THREE.Color(paint).multiplyScalar(index === 1 ? 0.62 : 1));
  const preview = paints.map((paint, index) => new THREE.Color(paint).multiplyScalar(index === 0 ? 4 : 0.55));
  const colour = new THREE.Color();
  const matrix = new THREE.Matrix4();

  function update(dt: number, time: number, input: Parameters<Station["update"]>[2]) {
    let hover = -1;
    if (input.point) {
      const x = Math.round((input.point.x - BOARD_X + HALF) / PITCH);
      const z = Math.round((input.point.z + HALF) / PITCH);
      if (x >= 0 && x < SIZE && z >= 0 && z < SIZE) {
        hover = z * SIZE + x;
        // A quick click or tap can start and end between two frames, so it paints as well as a held press.
        if (input.pressed || input.clicked) { cells[hover] = brush; touched = true; }
      }
      if (input.clicked) {
        const picked = pots.findIndex((pot) => Math.hypot(pot.position.x - input.point!.x, pot.position.z - input.point!.z) < 0.55);
        if (picked >= 0) brush = picked;
      }
    }
    // Until someone paints, the exhaust flickers between two frames.
    if (!touched) {
      const flick = Math.floor(time * 3) % 2 === 0;
      cells[6 * SIZE] = flick ? 3 : 0;
      cells[8 * SIZE] = flick ? 3 : 0;
      cells[7 * SIZE] = flick ? 0 : 3;
      cells[5 * SIZE + 1] = flick ? 3 : 2;
      cells[9 * SIZE + 1] = flick ? 3 : 2;
    }

    for (let i = 0; i < cells.length; i++) {
      // A freshly painted element comes up to full brightness over a moment.
      level[i] = damp(level[i], 1, 9, dt);
      matrix.makeTranslation(BOARD_X - HALF + (i % SIZE) * PITCH, 0, -HALF + Math.floor(i / SIZE) * PITCH);
      pixels.setMatrixAt(i, matrix);
      if (i === hover && !input.pressed) colour.copy(preview[brush]).lerp(shades[cells[i]], 0.35);
      else colour.copy(shades[cells[i]]).multiplyScalar(level[i]);
      pixels.setColorAt(i, colour);
    }
    if (hover >= 0 && (input.pressed || input.clicked)) level[hover] = 1.8;
    pixels.instanceMatrix.needsUpdate = true;
    pixels.instanceColor!.needsUpdate = true;
    pots.forEach((pot, index) => { (pot.userData.marker as THREE.Sprite).visible = index === brush; });
  }

  return { group, planeY: 0.05, update };
}
