import * as THREE from "three";

/** Every ship in the fleet is drawn from these few colours. */
export const ink = {
  void: 0x02040a,
  bone: 0xaab0bb,
  graphite: 0x1a1e26,
  slate: 0x323947,
  steel: 0x646d7c,
  orange: 0xe06a26,
  yellow: 0xe2a13a,
  water: 0x3f6fae,
  red: 0xff3b30,
  cyan: 0x8fdcff,
} as const;

export interface StationInput {
  /** Pointer position in the ship's own coordinates, on its working plane. */
  point: THREE.Vector3 | null;
  pressed: boolean;
  clicked: boolean;
  keys: ReadonlySet<string>;
}

export interface Station {
  group: THREE.Group;
  /** Height of the plane the pointer is projected onto. Deck level is y = 0. */
  planeY: number;
  /** The real ship this display belongs to, set by the stage. Its parts arrive when the model loads. */
  ship?: THREE.Group;
  update(dt: number, time: number, input: StationInput): void;
}

const materials = new Map<number, THREE.MeshStandardMaterial>();

/** Plating seams and slightly uneven panels, tiled across every hull. */
function platingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const pen = canvas.getContext("2d")!;
  const random = seeded(3);
  pen.fillStyle = "#fff";
  pen.fillRect(0, 0, 512, 512);
  // Panels of slightly different wear, then the seams between them.
  for (let y = 0; y < 512; y += 64) {
    for (let x = 0; x < 512;) {
      const wide = 64 * (1 + Math.floor(random() * 3));
      const wear = 205 + Math.floor(random() * 50);
      pen.fillStyle = `rgb(${wear}, ${wear}, ${wear})`;
      pen.fillRect(x, y, wide, 64);
      pen.fillStyle = "rgba(20, 24, 32, .85)";
      pen.fillRect(x, y, 2, 64);
      if (random() < 0.3) { pen.fillStyle = "rgba(20, 24, 32, .5)"; pen.fillRect(x + 10, y + 12, wide - 20, 2); }
      x += wide;
    }
    pen.fillStyle = "rgba(20, 24, 32, .85)";
    pen.fillRect(0, y, 512, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.anisotropy = 8;
  return texture;
}
let plating: THREE.Texture | undefined;

/** Solid things that share space with the ships: worn metal that picks up the sky. */
export function matte(color: number) {
  let material = materials.get(color);
  if (!material) {
    plating ??= platingTexture();
    material = new THREE.MeshStandardMaterial({ color, map: plating, roughness: 0.5, metalness: 0.65, flatShading: true });
    materials.set(color, material);
  }
  return material;
}

const lights = new Map<number, THREE.MeshStandardMaterial>();

/** What a ship's projected displays are made of: light, not metal. Shaded so forms still read. */
export function holo(color: number) {
  let material = lights.get(color);
  if (!material) {
    const tint = new THREE.Color(color).lerp(new THREE.Color(ink.cyan), 0.3);
    material = new THREE.MeshStandardMaterial({
      color: tint, emissive: tint, emissiveIntensity: 0.3, roughness: 0.5, metalness: 0,
      transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, flatShading: true,
    });
    lights.set(color, material);
  }
  return material;
}

/** Turn a part that was built solid into projected light. */
export function projected<T extends THREE.Object3D>(part: T) {
  part.traverse((piece) => {
    if (piece instanceof THREE.Mesh && piece.material instanceof THREE.MeshStandardMaterial) {
      piece.material = holo(piece.material.color.getHex());
      piece.castShadow = false;
      piece.receiveShadow = false;
    }
  });
  return part;
}

/** A colour brighter than white, so the bloom pass makes it shine. */
export function glow(color: number, strength = 3) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength) });
}

function solid<T extends THREE.BufferGeometry>(geometry: T, color: number) {
  const mesh = new THREE.Mesh(geometry, matte(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A box that sits on the plane y of its parent, centred at x, z. */
export function block(width: number, height: number, depth: number, color: number, x = 0, y = 0, z = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(0, height / 2, 0);
  const mesh = solid(geometry, color);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * A hull section: a box whose bow end (+x) narrows. `beam` and `rise` are how much of the
 * width and height survive at the bow, and the top face stays level so it can carry a deck.
 */
export function hull(length: number, height: number, width: number, color: number, nose = length * 0.3, beam = 0.35, rise = 0.5) {
  const geometry = new THREE.BoxGeometry(length, height, width, 2, 1, 1);
  const spot = geometry.attributes.position;
  for (let i = 0; i < spot.count; i++) {
    // The middle ring of vertices marks where the nose begins.
    if (Math.abs(spot.getX(i)) < 0.001) spot.setX(i, length / 2 - nose);
    else if (spot.getX(i) > 0) {
      spot.setZ(i, spot.getZ(i) * beam);
      if (spot.getY(i) < 0) spot.setY(i, height / 2 - height * rise);
    }
  }
  geometry.translate(0, -height / 2, 0);
  geometry.computeVertexNormals();
  return solid(geometry, color);
}

/** An upright cylinder that sits on y of its parent. */
export function post(radius: number, height: number, color: number, x = 0, y = 0, z = 0, segments = 24) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, segments);
  geometry.translate(0, height / 2, 0);
  const mesh = solid(geometry, color);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A tube lying along the ship's length, for fuselages and pods. */
export function spar(length: number, sternRadius: number, bowRadius: number, color: number, sides = 8) {
  const geometry = new THREE.CylinderGeometry(bowRadius, sternRadius, length, sides);
  geometry.rotateZ(-Math.PI / 2);
  return solid(geometry, color);
}

export function ball(radius: number, color: number) {
  return solid(new THREE.SphereGeometry(radius, 20, 12), color);
}

/** Many identical boxes drawn in one call, each standing on y = 0. Colours may exceed white to shine. */
export function tiles(count: number, width: number, height: number, depth: number, look: boolean | "holo" = true, shape?: THREE.BufferGeometry) {
  const geometry = shape ?? new THREE.BoxGeometry(width, height, depth);
  if (!shape) geometry.translate(0, height / 2, 0);
  // true: solid and lit. false: self-lit. "holo": projected light.
  const material = look === "holo"
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x1c3247, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
    : look
      ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.55 })
      : new THREE.MeshBasicMaterial({ color: 0xffffff });
  if (shape) material.side = THREE.DoubleSide;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = look === true;
  mesh.receiveShadow = look === true;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const white = new THREE.Color(0xffffff);
  for (let i = 0; i < count; i++) mesh.setColorAt(i, white);
  return mesh;
}

export interface Section {
  /** Position along the ship. */
  x: number;
  /** Half the width at this station. */
  w: number;
  top: number;
  bottom: number;
  /** How much the four long edges are cut back. */
  chamfer?: number;
}

const skins = new Map<number, THREE.MeshStandardMaterial>();

/**
 * A hull skinned over a row of cross-sections, stern to bow. Each section is a rectangle
 * with its edges cut back, so the hull reads as plated rather than as a box.
 */
export function loft(sections: Section[], color: number) {
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  for (const section of sections) {
    const cut = Math.min(section.chamfer ?? 0.25, section.w * 0.9, (section.top - section.bottom) * 0.45);
    const { w, top, bottom } = section;
    const ring = [[-w + cut, top], [w - cut, top], [w, top - cut], [w, bottom + cut], [w - cut, bottom], [-w + cut, bottom], [-w, bottom + cut], [-w, top - cut]];
    ring.forEach(([z, y], corner) => { positions.push(section.x, y, z); uvs.push(section.x / 5, corner / 3); });
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let corner = 0; corner < 8; corner++) {
      const a = i * 8 + corner, b = i * 8 + (corner + 1) % 8, c = a + 8, d = b + 8;
      index.push(a, c, b, b, c, d);
    }
  }
  // Close the stern and the bow.
  for (const end of [0, sections.length - 1]) {
    const centre = positions.length / 3;
    const section = sections[end];
    positions.push(section.x, (section.top + section.bottom) / 2, 0);
    uvs.push(section.x / 5, 0.5);
    for (let corner = 0; corner < 8; corner++) index.push(centre, end * 8 + corner, end * 8 + (corner + 1) % 8);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  let skin = skins.get(color);
  if (!skin) {
    skin = matte(color).clone();
    skin.side = THREE.DoubleSide;
    skins.set(color, skin);
  }
  const mesh = new THREE.Mesh(geometry, skin);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A flat plate cut to an outline, for wings and fins. A wing's outline is given as [x, z]
 * and lies level; a fin's is [x, y] and stands upright.
 */
export function plate(outline: [number, number][], thickness: number, color: number, upright = false) {
  const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, upright ? b : -b)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.translate(0, 0, -thickness / 2);
  if (!upright) geometry.rotateX(-Math.PI / 2);
  return solid(geometry, color);
}

let panes: THREE.Texture | undefined;
function paneTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 16;
  const pen = canvas.getContext("2d")!;
  const random = seeded(17);
  for (let x = 0; x < 256; x += 16) {
    if (random() < 0.28) continue;
    pen.fillStyle = random() < 0.2 ? "#9fd8ff" : "#ffd9a6";
    pen.fillRect(x + 3, 3, 10, 10);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/** A row of lit cabin windows, which is what tells the eye how big a ship is. */
export function windowRow(length: number, height: number, x: number, y: number, z: number, facing: "side" | "front" = "side") {
  panes ??= paneTexture();
  const map = panes.clone();
  map.repeat.x = Math.max(0.25, length / 5);
  map.offset.x = (x * 0.37 + z * 0.11) % 1;
  const material = new THREE.MeshBasicMaterial({
    map, color: new THREE.Color(0xffffff).multiplyScalar(2.6), transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, height), material);
  mesh.position.set(x, y, z);
  if (facing === "front") mesh.rotation.y = Math.PI / 2;
  return mesh;
}

/** Small deck fittings scattered over a rectangle: vents, lockers, junction boxes. */
export function greeble(x0: number, x1: number, z0: number, z1: number, y: number, count: number, seed: number) {
  const random = seeded(seed);
  const mesh = tiles(count, 1, 1, 1);
  const matrix = new THREE.Matrix4();
  const shades = [ink.slate, ink.graphite, ink.steel].map((shade) => new THREE.Color(shade));
  for (let i = 0; i < count; i++) {
    matrix.makeScale(0.14 + random() * 0.4, 0.05 + random() * 0.2, 0.14 + random() * 0.36);
    matrix.setPosition(x0 + random() * (x1 - x0), y, z0 + random() * (z1 - z0));
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, shades[Math.floor(random() * shades.length)]);
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  return mesh;
}

/** A thin antenna mast with a lit tip. */
export function mast(height: number, x: number, y: number, z: number) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), glow(0xff3b30, 4));
  tip.position.y = height;
  group.add(post(0.025, height, ink.steel, 0, 0, 0, 6), tip);
  return group;
}

const flames: THREE.Mesh[] = [];
const flameShape = new THREE.ConeGeometry(1, 1, 16, 1, true);
flameShape.rotateZ(Math.PI / 2);
flameShape.translate(-0.5, 0, 0);
const flameLook = new THREE.MeshBasicMaterial({
  color: new THREE.Color(ink.cyan).multiplyScalar(1.1), transparent: true, opacity: 0.26,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
const coreLook = glow(ink.cyan, 2.6);

function streakTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 64;
  const pen = canvas.getContext("2d")!;
  const across = pen.createLinearGradient(0, 0, 512, 0);
  across.addColorStop(0, "rgba(255,255,255,0)");
  across.addColorStop(0.5, "rgba(255,255,255,1)");
  across.addColorStop(1, "rgba(255,255,255,0)");
  pen.fillStyle = across;
  pen.fillRect(0, 0, 512, 64);
  const down = pen.createLinearGradient(0, 0, 0, 64);
  down.addColorStop(0, "rgba(0,0,0,1)");
  down.addColorStop(0.5, "rgba(0,0,0,0)");
  down.addColorStop(1, "rgba(0,0,0,1)");
  pen.globalCompositeOperation = "destination-out";
  pen.fillStyle = down;
  pen.fillRect(0, 0, 512, 64);
  return new THREE.CanvasTexture(canvas);
}
let streak: THREE.SpriteMaterial | undefined;

/** The wide horizontal flare a bright light leaves in a camera lens. */
function lensStreak(width: number, color: number, strength: number) {
  streak ??= new THREE.SpriteMaterial({ map: streakTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const material = streak.clone();
  material.color = new THREE.Color(color).multiplyScalar(strength);
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, width * 0.035, 1);
  return sprite;
}

const beacons: { lamp: THREE.Object3D; rate: number; phase: number; duty: number }[] = [];

/** Running lights: red to port, green to starboard, and a white strobe aft. */
export function navLights(target: THREE.Object3D, bow: number, stern: number, halfBeam: number, y = 0.1) {
  const lamp = (color: number, x: number, z: number, rate: number, duty: number) => {
    const light = new THREE.Group();
    light.position.set(x, y, z);
    light.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glow(color, 5)), lensStreak(1.6, color, 0.9));
    target.add(light);
    beacons.push({ lamp: light, rate, phase: beacons.length * 0.37, duty });
  };
  lamp(0xff2a1f, (bow + stern) / 2, -halfBeam, 0.9, 0.55);
  lamp(0x35ff6a, (bow + stern) / 2, halfBeam, 0.9, 0.55);
  lamp(0xffffff, stern, 0, 0.55, 0.08);
}

/** A drive nozzle at the stern, pointing aft (-x), with its exhaust plume. */
export function engine(radius: number, x: number, y: number, z: number) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const nozzle = spar(radius * 1.3, radius * 1.15, radius * 0.9, ink.graphite, 12);
  const collar = spar(radius * 0.3, radius * 1.3, radius * 1.3, ink.steel, 12);
  collar.position.x = radius * 0.6;
  group.add(collar);
  const core = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.8, 16), coreLook);
  core.rotation.y = -Math.PI / 2;
  core.position.x = -radius * 0.66;
  const flame = new THREE.Mesh(flameShape, flameLook);
  flame.position.x = -radius * 0.6;
  flame.userData.radius = radius;
  flame.userData.phase = flames.length * 1.3;
  flames.push(flame);
  const flare = lensStreak(radius * 9, ink.cyan, 0.9);
  flare.position.x = -radius * 0.7;
  group.add(nozzle, core, flame, flare);
  return group;
}

const driveClock = { value: 0 };
const plumeShape = new THREE.ConeGeometry(1, 1, 24, 12, true);
plumeShape.rotateZ(Math.PI / 2);
plumeShape.translate(-0.5, 0, 0);
const plumeLooks = new Map<number, THREE.ShaderMaterial>();
let halo: THREE.Texture | undefined;

function haloTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const pen = canvas.getContext("2d")!;
  const fade = pen.createRadialGradient(64, 64, 0, 64, 64, 64);
  fade.addColorStop(0, "rgba(255,255,255,1)");
  fade.addColorStop(0.25, "rgba(255,255,255,.55)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  pen.fillStyle = fade;
  pen.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Drive exhaust for a real ship: a hot core inside a longer, fainter sheath, with a glow and
 * a lens streak at the nozzle. It points aft (-x) from the origin of the group it returns.
 */
export function plume(radius: number, color: number, tall = 1) {
  let look = plumeLooks.get(color);
  if (!look) {
    look = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: driveClock, tint: { value: new THREE.Color(color) }, power: { value: 1 } },
      vertexShader: "varying vec2 at; void main() { at = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
      fragmentShader: `
        uniform float time; uniform vec3 tint; uniform float power; varying vec2 at;
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        float noise(float x) { float i = floor(x), f = fract(x); f = f * f * (3. - 2. * f); return mix(hash(i), hash(i + 1.), f); }
        void main() {
          float along = clamp(at.y, 0., 1.);
          // Brightest at the nozzle, shock diamonds a little way out, then fading to nothing.
          float fade = pow(max(1. - along, 0.), 1.7);
          float diamonds = .75 + .25 * sin(along * 26. - time * 14.);
          float flutter = .8 + .2 * noise(along * 9. - time * 7. + at.x * 12.);
          vec3 color = mix(vec3(1.), tint, smoothstep(0., .3, along)) * (1.2 + 1.6 * fade);
          gl_FragColor = vec4(color, fade * diamonds * flutter * power);
        }`,
    });
    plumeLooks.set(color, look);
  }
  const core = look.clone();
  core.uniforms.time = driveClock;
  core.uniforms.power.value = 0.8;
  const sheath = look.clone();
  sheath.uniforms.time = driveClock;
  sheath.uniforms.power.value = 0.22;

  const group = new THREE.Group();
  const inner = new THREE.Mesh(plumeShape, core);
  inner.scale.set(radius * 5, radius * 0.55 * tall, radius * 0.55);
  const outer = new THREE.Mesh(plumeShape, sheath);
  outer.scale.set(radius * 11, radius * 1.05 * tall, radius * 1.05);
  halo ??= haloTexture();
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: halo, color: new THREE.Color(color).multiplyScalar(0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  glare.scale.set(radius * 3, radius * 3 * tall, 1);
  const flare = lensStreak(radius * 12, color, 0.45);
  group.add(outer, inner, glare, flare);
  return group;
}

/** Let every exhaust plume breathe and every running light blink. */
export function flicker(time: number) {
  driveClock.value = time;
  for (const { lamp, rate, phase, duty } of beacons) lamp.visible = (time * rate + phase) % 1 < duty;
  for (const flame of flames) {
    const radius = flame.userData.radius as number;
    const pulse = 0.85 + Math.sin(time * 9 + flame.userData.phase) * 0.08 + Math.sin(time * 23 + flame.userData.phase) * 0.05;
    flame.scale.set(radius * 5 * pulse, radius * 0.8, radius * 0.8);
  }
}

export const damp = THREE.MathUtils.damp;
export const clamp = THREE.MathUtils.clamp;

export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A small flat tag with text, always facing the camera. */
export function tag(text: string, background: string, foreground: string) {
  const canvas = document.createElement("canvas");
  const pen = canvas.getContext("2d")!;
  const font = '600 44px "Barlow Condensed", sans-serif';
  pen.font = font;
  canvas.width = Math.ceil(pen.measureText(text).width) + 28;
  canvas.height = 58;
  pen.fillStyle = background;
  pen.fillRect(0, 0, canvas.width, canvas.height);
  pen.font = font;
  pen.fillStyle = foreground;
  pen.textBaseline = "middle";
  pen.fillText(text, 14, 31);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  const height = 0.36;
  sprite.scale.set(height * canvas.width / canvas.height, height, 1);
  sprite.center.set(0, 0);
  sprite.renderOrder = 5;
  return sprite;
}

/**
 * The light a ship throws to draw a display: rays from an emitter on the hull to the corners
 * of what it projects, and a faint sheet between them.
 */
export function projection(emitter: THREE.Vector3, corners: THREE.Vector3[]) {
  const rays: number[] = [], sheet: number[] = [];
  corners.forEach((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    rays.push(...emitter.toArray(), ...corner.toArray(), ...corner.toArray(), ...next.toArray());
    sheet.push(...emitter.toArray(), ...corner.toArray(), ...next.toArray());
  });
  const lines = new THREE.BufferGeometry();
  lines.setAttribute("position", new THREE.Float32BufferAttribute(rays, 3));
  const faces = new THREE.BufferGeometry();
  faces.setAttribute("position", new THREE.Float32BufferAttribute(sheet, 3));
  const group = new THREE.Group();
  group.add(
    new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: ink.cyan, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })),
    new THREE.Mesh(faces, new THREE.MeshBasicMaterial({ color: ink.cyan, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
  );
  return group;
}
