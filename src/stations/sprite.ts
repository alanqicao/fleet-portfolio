import * as THREE from "three";
import { block, damp, engine, greeble, ink, loft, mast, post, projected, projection, tiles, type Station } from "../kit.js";

const SIZE = 16;
const PITCH = 0.42;
const HALF = (SIZE - 1) * PITCH / 2;
const BOARD_X = -1.0;

const paints = [ink.slate, ink.bone, ink.orange, ink.yellow, ink.water];
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

/** The signal carrier. Its flight deck is a pixel board you can paint, with a tank for each colour. */
export function createSprite(): Station {
  const group = new THREE.Group();

  const pixels = tiles(SIZE * SIZE, 0.38, 0.14, 0.38, "holo");
  // The carrier throws the board up from its deck.
  const edge = HALF + 0.3;
  group.add(projection(new THREE.Vector3(BOARD_X, -0.35, 0), [
    new THREE.Vector3(BOARD_X - edge, 0, -edge), new THREE.Vector3(BOARD_X + edge, 0, -edge), new THREE.Vector3(BOARD_X + edge, 0, edge), new THREE.Vector3(BOARD_X - edge, 0, edge),
  ]));
  pixels.position.y = 0.02;
  group.add(pixels);

  const cells = new Uint8Array(SIZE * SIZE);
  art.forEach((row, z) => [...row].forEach((mark, x) => { cells[z * SIZE + x] = letter[mark]; }));
  const rise = new Float32Array(SIZE * SIZE).fill(1);

  const pots = paints.map((paint, index) => {
    const pot = new THREE.Group();
    pot.position.set(3.3, 0, -2.2 + index * 1.1);
    pot.add(post(0.42, 0.45, ink.slate, 0, 0, 0, 20), post(0.34, 0.08, paint, 0, 0.45, 0, 20));
    group.add(projected(pot));
    return pot;
  });
  let brush = 2;
  let touched = false;

  // Painted pixels shine; bare deck stays dull.
  const shades = paints.map((paint, index) => new THREE.Color(paint).multiplyScalar(index === 0 ? 0.5 : index === 1 ? 0.8 : 1.5));
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
      const goal = (cells[i] ? 2.2 : 1) + (i === hover ? 2 : 0);
      rise[i] = damp(rise[i], goal, 14, dt);
      matrix.makeScale(1, rise[i], 1);
      matrix.setPosition(BOARD_X - HALF + (i % SIZE) * PITCH, 0, -HALF + Math.floor(i / SIZE) * PITCH);
      pixels.setMatrixAt(i, matrix);
      pixels.setColorAt(i, i === hover && !input.pressed ? shades[brush] : shades[cells[i]]);
    }
    pixels.instanceMatrix.needsUpdate = true;
    pixels.instanceColor!.needsUpdate = true;
    pots.forEach((pot, index) => { pot.position.y = damp(pot.position.y, index === brush ? 0.3 : 0, 12, dt); });
  }

  return { group, planeY: 0.2, update };
}
